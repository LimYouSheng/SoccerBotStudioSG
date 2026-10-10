import { z } from "zod";
import { authenticate } from "./access";
import { ApiError, digest } from "./policy";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const challengeInput = z.strictObject({
  email: emailSchema,
  botToken: z.string().min(1).max(2048),
});
const verifyInput = z.strictObject({
  challengeId: z.string().uuid(),
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/),
});
const purpose = "verify-email";
// Server-owned dependencies, never derived from a request's mode/URL/flags.
// Production composition remains unavailable until sender/bot scope is approved.
export type IdentityDelivery = {
  pepper: string;
  source: string;
  hostname: string;
  verifyBot(
    token: string,
    signal: AbortSignal,
  ): Promise<{
    success: boolean;
    hostname: string;
    action: string;
    challengeAtMs: number;
  }>;
  send(
    input: { email: string; code: string; idempotencyKey: string },
    signal: AbortSignal,
  ): Promise<{ accepted: boolean }>;
  now?: () => number;
};
function denied() {
  return new ApiError(400, "verification_unavailable");
}
async function keyedHash(pepper: string, parts: string[]) {
  if (pepper.length < 32 || pepper.length > 512)
    throw new ApiError(503, "identity_unavailable");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify(parts)),
  );
  return Array.from(new Uint8Array(signature), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function randomCode() {
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= 4294000000);
  return String(value[0] % 1000000).padStart(6, "0");
}
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("identity_transport_unknown"));
        }, 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function requestIdentityChallenge(
  request: Request,
  env: Env,
  raw: unknown,
  delivery: IdentityDelivery,
) {
  const input = challengeInput.safeParse(raw);
  if (!input.success) throw denied();
  const clock = delivery.now ?? Date.now;
  const access = await authenticate(request, env, clock());
  if (!delivery.source || delivery.source.length > 128 || !delivery.hostname)
    throw new ApiError(503, "identity_unavailable");
  const proof = await bounded((signal) =>
    delivery.verifyBot(input.data.botToken, signal),
  );
  const now = clock();
  if (
    !proof.success ||
    proof.hostname !== delivery.hostname ||
    proof.action !== purpose ||
    !Number.isSafeInteger(proof.challengeAtMs) ||
    proof.challengeAtMs > now ||
    now - proof.challengeAtMs >= 300000
  )
    throw denied();
  const id = crypto.randomUUID(),
    code = randomCode();
  const expires = Math.min(now + 600000, access.expires_ms);
  if (expires <= now) throw denied();
  const emailHash = await keyedHash(delivery.pepper, [
    "email",
    input.data.email,
  ]);
  const codeHash = await keyedHash(delivery.pepper, [
    purpose,
    id,
    access.capability_hash,
    input.data.email,
    code,
  ]);
  const sourceHash = await keyedHash(delivery.pepper, [
    "source",
    delivery.source,
  ]);
  let inserted: D1Result[];
  try {
    inserted = await env.STATE.batch([
      env.STATE.prepare("INSERT INTO identity_bot_tokens VALUES(?,?)").bind(
        await digest(input.data.botToken),
        now,
      ),
      env.STATE.prepare(
        "INSERT INTO identity_challenges(id,owner_id,access_hash,email,email_hash,source_hash,code_hash,created_ms,expires_ms,state) SELECT ?,?,?,?,?,?,?,?,?,'reserved' WHERE EXISTS(SELECT 1 FROM guest_access WHERE capability_hash=? AND owner_id=? AND revoked_ms IS NULL AND issued_ms<=? AND expires_ms>?)",
      ).bind(
        id,
        access.owner_id,
        access.capability_hash,
        input.data.email,
        emailHash,
        sourceHash,
        codeHash,
        now,
        expires,
        access.capability_hash,
        access.owner_id,
        now,
        now,
      ),
      env.STATE.prepare(
        "UPDATE identity_challenges SET state='superseded' WHERE access_hash=? AND id<>? AND state IN ('reserved','sent','unknown') AND EXISTS(SELECT 1 FROM identity_challenges WHERE id=?)",
      ).bind(access.capability_hash, id, id),
      env.STATE.prepare(
        "UPDATE verified_identity SET revoked_ms=? WHERE access_hash=? AND EXISTS(SELECT 1 FROM identity_challenges WHERE id=?)",
      ).bind(now, access.capability_hash, id),
    ]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (
      reason.includes("identity_request_limited") ||
      reason.includes("identity_bot_tokens.token_hash")
    )
      throw new ApiError(429, "verification_request_limited");
    throw new ApiError(503, "identity_unavailable");
  }
  if (inserted[1].meta.changes !== 1) throw denied();
  // Unknown mail delivery is retained under this challenge; no retry or replay.
  let accepted = false;
  try {
    await authenticate(request, env, clock());
    if (clock() < expires)
      accepted =
        (
          await bounded((signal) =>
            delivery.send(
              {
                email: input.data.email,
                code,
                idempotencyKey: `verification/${id}`,
              },
              signal,
            ),
          )
        ).accepted === true;
  } catch {
    /* The durable reservation remains authoritative. */
  }
  await env.STATE.prepare(
    "UPDATE identity_challenges SET state=? WHERE id=? AND state='reserved'",
  )
    .bind(accepted ? "sent" : "unknown", id)
    .run();
  // Same envelope for unknown/existing/shared addresses and uncertain delivery.
  return { challengeId: id, expiresAt: expires, resendAfter: now + 60000 };
}

export async function verifyIdentityChallenge(
  request: Request,
  env: Env,
  raw: unknown,
  pepper: string,
  clock: () => number = Date.now,
) {
  const input = verifyInput.safeParse(raw);
  if (!input.success) throw denied();
  const access = await authenticate(request, env, clock());
  const { challengeId, email, code } = input.data;
  const hash = await keyedHash(pepper, [
    purpose,
    challengeId,
    access.capability_hash,
    email,
    code,
  ]);
  const now = clock();
  // Wrong codes consume attempts atomically. Only the single matching transition
  // can establish a session; replay/concurrent followers cannot renew expiry.
  const result = await env.STATE.batch([
    env.STATE.prepare(
      "UPDATE identity_challenges SET attempts=attempts+1,state=CASE WHEN code_hash=? THEN 'consumed' ELSE state END WHERE id=? AND access_hash=? AND email=? AND state='sent' AND attempts<5 AND created_ms<=? AND expires_ms>? AND EXISTS(SELECT 1 FROM guest_access WHERE capability_hash=? AND revoked_ms IS NULL AND issued_ms<=? AND expires_ms>?) RETURNING state",
    ).bind(
      hash,
      challengeId,
      access.capability_hash,
      email,
      now,
      now,
      access.capability_hash,
      now,
      now,
    ),
    env.STATE.prepare(
      "INSERT INTO verified_identity(access_hash,owner_id,email,verified_ms,expires_ms,revoked_ms) SELECT access_hash,owner_id,email,?,MIN(?,?),NULL FROM identity_challenges WHERE id=? AND code_hash=? AND state='consumed' AND changes()=1 ON CONFLICT(access_hash) DO UPDATE SET email=excluded.email,verified_ms=excluded.verified_ms,expires_ms=excluded.expires_ms,revoked_ms=NULL",
    ).bind(now, now + 1800000, access.expires_ms, challengeId, hash),
  ]);
  if (result[1].meta.changes !== 1) throw denied();
  return readVerifiedIdentity(request, env, clock());
}

export async function readVerifiedIdentity(
  request: Request,
  env: Env,
  now: number,
) {
  const access = await authenticate(request, env, now);
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT email,expires_ms AS expiresAt FROM verified_identity WHERE access_hash=? AND owner_id=? AND revoked_ms IS NULL AND verified_ms<=? AND expires_ms>?",
    )
    .bind(access.capability_hash, access.owner_id, now, now)
    .first<{ email: string; expiresAt: number }>();
  return row;
}

// An authenticated email never authorizes a directory listing. Missing/shared
// matches return no prefill. A future provider mapper supplies only exact matches.
export function verifiedContact(email: string, matches: unknown) {
  const parsed = z
    .array(
      z.strictObject({
        email: emailSchema,
        name: z.string().min(1).max(200),
        phone: z.string().max(40),
      }),
    )
    .max(2)
    .safeParse(matches);
  if (
    !parsed.success ||
    parsed.data.length !== 1 ||
    parsed.data[0].email !== emailSchema.parse(email)
  )
    return null;
  return { name: parsed.data[0].name, phone: parsed.data[0].phone };
}
