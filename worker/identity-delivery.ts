import { z } from "zod";
import { authenticate } from "./access";
import { verifyBindings } from "./bindings";
import { ApiError } from "./policy";
import {
  keyedHash,
  requestIdentityChallenge,
  verifyIdentityChallenge,
} from "./identity";
import { identityRequest } from "./provider-transport";

const unavailable = () => new ApiError(503, "identity_unavailable");
const windowSchema = z.object({
  source_revision: z.string().regex(/^[a-f0-9]{40}$/),
  origin: z.url(),
  sender: z.literal("SoccerBotStudioSG Dev <noreply@auth.app404.ai>"),
  recipient: z.literal("sheng@app404.ai"),
  opened_ms: z.number().int().safe().nonnegative(),
  expires_ms: z.number().int().safe().positive(),
  state: z.literal("open"),
});
function secret(env: Env, name: string) {
  const value: unknown = Reflect.get(env, name);
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 512 ||
    /\s/.test(value)
  )
    throw unavailable();
  return value;
}
async function windowFor(env: Env, now: number, reserve = false) {
  const mode: unknown = Reflect.get(env, "IDENTITY_DELIVERY");
  if (mode !== "finite-test") throw unavailable();
  const parsed = windowSchema.safeParse(
    await env.STATE.withSession("first-primary")
      .prepare(
        "SELECT * FROM identity_delivery_window ORDER BY singleton DESC LIMIT 1",
      )
      .first(),
  );
  if (!parsed.success) throw unavailable();
  const window = parsed.data;
  if (
    window.source_revision !== env.SOURCE_REVISION ||
    window.origin !== env.APP_ORIGIN ||
    window.opened_ms > now ||
    window.expires_ms <= now + (reserve ? 5000 : 0) ||
    window.expires_ms - window.opened_ms > 1200000
  )
    throw unavailable();
  return window;
}
// Bounded before parsing, and never includes request bodies or provider errors in logs.
async function inputBody(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json" ||
    !request.body
  )
    throw new ApiError(400, "verification_unavailable");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let size = 0,
    text = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 4096) throw new ApiError(413, "verification_unavailable");
          text += decoder.decode(part.value, { stream: true });
        }
        return JSON.parse(text + decoder.decode()) as unknown;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ApiError(408, "verification_unavailable")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
export async function identityDelivery(request: Request, env: Env) {
  if (request.method !== "POST")
    throw new ApiError(405, "operation_unavailable");
  await verifyBindings(env);
  const access = await authenticate(request, env, Date.now());
  const window = await windowFor(env, Date.now());
  const pepper = secret(env, "IDENTITY_PEPPER");
  const raw = await inputBody(request);
  const email = z
    .object({ email: z.string().trim().toLowerCase().pipe(z.email()) })
    .safeParse(raw);
  if (!email.success || email.data.email !== window.recipient)
    throw new ApiError(400, "verification_unavailable");
  if (new URL(request.url).pathname === "/api/identity/verify")
    return verifyIdentityChallenge(request, env, raw, pepper);
  // CF-Connecting-IP is supplied by the Worker edge, never X-Forwarded-For or JSON.
  const source = request.headers.get("CF-Connecting-IP");
  if (!source || source.length > 64 || !/^[a-fA-F0-9:.]+$/.test(source))
    throw unavailable();
  const sourceHash = await keyedHash(pepper, ["delivery-source", source]);
  const resendKey = secret(env, "RESEND_API_KEY");
  const botKey = secret(env, "TURNSTILE_SECRET");
  async function dispatch(
    kind: "bot" | "email",
    id: string,
    payload: Record<string, string>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    await authenticate(request, env, Date.now());
    await windowFor(env, Date.now(), true);
    try {
      await env.STATE.prepare(
        "INSERT INTO identity_delivery_dispatches(id,kind,access_hash,source_hash,created_ms,state) VALUES(?,?,?,?,?,'reserved')",
      )
        .bind(id, kind, access.capability_hash, sourceHash, Date.now())
        .run();
    } catch {
      throw new ApiError(429, "verification_request_limited");
    }
    let state = "unknown";
    try {
      // Re-sample time and access after durable reservation; an unknown slot is never refunded.
      await authenticate(request, env, Date.now());
      await windowFor(env, Date.now(), true);
      signal.throwIfAborted();
      const result = await identityRequest(
        kind,
        kind === "bot" ? botKey : resendKey,
        payload,
        signal,
      );
      state = "responded";
      return result;
    } finally {
      await env.STATE.prepare(
        "UPDATE identity_delivery_dispatches SET state=? WHERE id=? AND state='reserved'",
      )
        .bind(state, id)
        .run();
    }
  }
  return requestIdentityChallenge(request, env, raw, {
    pepper,
    source,
    hostname: new URL(window.origin).hostname,
    verifyBot: async (token, signal) => {
      const id = await keyedHash(pepper, ["bot-dispatch", token]);
      const body = await dispatch("bot", id, { token }, signal);
      const proof = z
        .object({
          success: z.literal(true),
          hostname: z.string(),
          action: z.string(),
          challenge_ts: z.string(),
        })
        .safeParse(body);
      if (!proof.success) throw new ApiError(400, "verification_unavailable");
      return {
        success: true,
        hostname: proof.data.hostname,
        action: proof.data.action,
        challengeAtMs: Date.parse(proof.data.challenge_ts),
      };
    },
    send: async (message, signal) => {
      if (message.email !== window.recipient) throw unavailable();
      const body = await dispatch(
        "email",
        message.idempotencyKey,
        {
          recipient: window.recipient,
          sender: window.sender,
          code: message.code,
          idempotencyKey: message.idempotencyKey,
        },
        signal,
      );
      return {
        accepted: z.object({ id: z.string().uuid() }).safeParse(body).success,
      };
    },
  });
}
