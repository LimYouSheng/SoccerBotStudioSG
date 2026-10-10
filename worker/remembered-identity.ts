import { authenticate, type Access } from "./access";
import { ApiError, capability, digest, keyedHash } from "./policy";
const name = "__Host-soccerbot-remember";
const lifetime = 90 * 86400000;
const grace = 30000;
type Family = {
  id: string;
  email: string;
  verified_ms: number;
  expires_ms: number;
  current_hash: string;
  previous_hash: string | null;
  rotated_ms: number;
  revoked_ms: number | null;
};
function tokenFrom(request: Request) {
  const cookies = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + "="));
  if (!cookies.length) return null;
  if (cookies.length !== 1) throw new ApiError(401, "identity_unavailable");
  const token = cookies[0].slice(name.length + 1);
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new ApiError(401, "identity_unavailable");
  return token;
}
function cookie(token: string, expires: number) {
  return `${name}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Expires=${new Date(expires).toUTCString()}`;
}
export function clearRememberedCookie() {
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}
export async function revokePresentedRemembered(
  request: Request,
  env: Env,
  now: number,
) {
  const token = tokenFrom(request);
  if (!token) return;
  const hash = await digest(token);
  await env.STATE.prepare(
    "UPDATE remembered_identity SET revoked_ms=? WHERE (current_hash=? OR previous_hash=?) AND origin=? AND account_id=? AND revoked_ms IS NULL",
  )
    .bind(now, hash, hash, env.APP_ORIGIN, env.DEPLOYMENT_ACCOUNT_ID)
    .run();
}
// Revoke a previously remembered browser identity only after fresh verification succeeds.
export async function replaceRememberedIdentity(
  request: Request,
  env: Env,
  now: number,
  id: string,
) {
  const token = tokenFrom(request);
  const hash = token ? await digest(token) : "";
  return env.STATE.prepare(
    "UPDATE remembered_identity SET revoked_ms=? WHERE id<>? AND origin=? AND account_id=? AND (current_hash=? OR previous_hash=?) AND revoked_ms IS NULL AND changes()=1",
  ).bind(now, id, env.APP_ORIGIN, env.DEPLOYMENT_ACCOUNT_ID, hash, hash);
}
// Append immediately after the successful single-use verified_identity write.
export async function rememberedIssuance(
  env: Env,
  access: Access,
  email: string,
  now: number,
  id: string,
) {
  const token = capability();
  const expires = now + lifetime;
  return {
    cookie: cookie(token, expires),
    statements: [
      env.STATE.prepare(
        "INSERT INTO remembered_identity(id,origin,account_id,email,origin_access_hash,verified_ms,expires_ms,current_hash,rotated_ms) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1",
      ).bind(
        id,
        env.APP_ORIGIN,
        env.DEPLOYMENT_ACCOUNT_ID,
        email,
        access.capability_hash,
        now,
        expires,
        await digest(token),
        now,
      ),
      env.STATE.prepare(
        "INSERT INTO remembered_access(access_hash,family_id,restored) SELECT ?,?,0 WHERE changes()=1 ON CONFLICT(access_hash) DO UPDATE SET family_id=excluded.family_id,restored=0",
      ).bind(access.capability_hash, id),
    ],
  };
}
export async function restoreRememberedIdentity(
  request: Request,
  env: Env,
  pepper: string,
  cookies: string[],
  clock: () => number = Date.now,
) {
  const access = await authenticate(request, env, clock());
  const token = tokenFrom(request);
  if (!token) return null;
  const hash = await digest(token);
  const family = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT id,email,verified_ms,expires_ms,current_hash,previous_hash,rotated_ms,revoked_ms FROM remembered_identity WHERE (current_hash=? OR previous_hash=?) AND origin=? AND account_id=?",
    )
    .bind(hash, hash, env.APP_ORIGIN, env.DEPLOYMENT_ACCOUNT_ID)
    .first<Family>();
  const now = clock();
  if (
    !family ||
    family.revoked_ms !== null ||
    family.verified_ms > now ||
    family.expires_ms <= now
  )
    throw new ApiError(401, "identity_unavailable");
  if (hash === family.previous_hash && now >= family.rotated_ms + grace) {
    await env.STATE.prepare(
      "UPDATE remembered_identity SET revoked_ms=? WHERE id=? AND previous_hash=? AND rotated_ms<=? AND revoked_ms IS NULL",
    )
      .bind(now, family.id, hash, now - grace)
      .run();
    throw new ApiError(401, "identity_unavailable");
  }
  const rotate =
    hash === family.current_hash && now >= family.rotated_ms + grace;
  const successor =
    rotate || hash === family.previous_hash
      ? await keyedHash(pepper, ["remembered-rotation", family.id, token])
      : token;
  const nextHash = await digest(successor);
  const at = clock();
  const expiry = Math.min(access.expires_ms, family.expires_ms, at + 1800000);
  const results = await env.STATE.batch([
    env.STATE.prepare(
      "UPDATE remembered_identity SET previous_hash=current_hash,current_hash=?,rotated_ms=? WHERE id=? AND current_hash=? AND rotated_ms<=? AND revoked_ms IS NULL AND verified_ms<=? AND expires_ms>? AND EXISTS(SELECT 1 FROM guest_access WHERE capability_hash=? AND revoked_ms IS NULL AND issued_ms<=? AND expires_ms>?)",
    ).bind(
      nextHash,
      at,
      family.id,
      hash,
      rotate ? at - grace : -1,
      at,
      at,
      access.capability_hash,
      at,
      at,
    ),
    env.STATE.prepare(
      "INSERT INTO verified_identity(access_hash,owner_id,email,verified_ms,expires_ms,revoked_ms) SELECT ?,?,email,verified_ms,?,NULL FROM remembered_identity WHERE id=? AND current_hash=? AND revoked_ms IS NULL AND verified_ms<=? AND expires_ms>? AND (current_hash=? OR (previous_hash=? AND rotated_ms>?)) AND EXISTS(SELECT 1 FROM guest_access WHERE capability_hash=? AND revoked_ms IS NULL AND issued_ms<=? AND expires_ms>?) AND NOT EXISTS(SELECT 1 FROM identity_challenges WHERE access_hash=? AND state IN ('reserved','sent','unknown')) AND NOT EXISTS(SELECT 1 FROM verified_identity WHERE access_hash=? AND email<>remembered_identity.email AND revoked_ms IS NULL AND expires_ms>?) ON CONFLICT(access_hash) DO UPDATE SET email=excluded.email,verified_ms=excluded.verified_ms,expires_ms=excluded.expires_ms,revoked_ms=NULL",
    ).bind(
      access.capability_hash,
      access.owner_id,
      expiry,
      family.id,
      nextHash,
      at,
      at,
      hash,
      hash,
      at - grace,
      access.capability_hash,
      at,
      at,
      access.capability_hash,
      access.capability_hash,
      at,
    ),
    env.STATE.prepare(
      "INSERT INTO remembered_access(access_hash,family_id,restored) SELECT ?,?,1 WHERE changes()=1 ON CONFLICT(access_hash) DO UPDATE SET family_id=excluded.family_id,restored=1",
    ).bind(access.capability_hash, family.id),
  ]);
  if (results[1].meta.changes !== 1 || results[2].meta.changes !== 1)
    throw new ApiError(401, "identity_unavailable");
  cookies.push(cookie(successor, family.expires_ms));
  return { email: family.email, expiresAt: expiry };
}
export async function revokeAllIdentities(
  request: Request,
  env: Env,
  now: number,
) {
  const access = await authenticate(request, env, now);
  const operation = crypto.randomUUID();
  // Authority is rechecked in the first write, not merely in a preceding read.
  const results = await env.STATE.batch([
    env.STATE.prepare(
      "INSERT INTO identity_revocations(email,cutoff_ms,operation_id) SELECT email,?,? FROM verified_identity WHERE access_hash=? AND revoked_ms IS NULL AND verified_ms<=? AND verified_ms>? AND expires_ms>? AND NOT EXISTS(SELECT 1 FROM remembered_access WHERE access_hash=? AND restored=1) AND EXISTS(SELECT 1 FROM guest_access WHERE capability_hash=? AND revoked_ms IS NULL AND expires_ms>?) ON CONFLICT(email) DO UPDATE SET cutoff_ms=MAX(cutoff_ms,excluded.cutoff_ms),operation_id=excluded.operation_id RETURNING email",
    ).bind(
      now,
      operation,
      access.capability_hash,
      now,
      now - 300000,
      now,
      access.capability_hash,
      access.capability_hash,
      now,
    ),
    env.STATE.prepare(
      "UPDATE remembered_identity SET revoked_ms=? WHERE revoked_ms IS NULL AND email IN (SELECT email FROM identity_revocations WHERE operation_id=? AND email=(SELECT email FROM verified_identity WHERE access_hash=?)) AND changes()=1",
    ).bind(now, operation, access.capability_hash),
    env.STATE.prepare(
      "UPDATE guest_access SET revoked_ms=? WHERE revoked_ms IS NULL AND capability_hash IN (SELECT access_hash FROM verified_identity WHERE email IN (SELECT email FROM identity_revocations WHERE operation_id=? AND email=(SELECT email FROM verified_identity WHERE access_hash=?)))",
    ).bind(now, operation, access.capability_hash),
    env.STATE.prepare(
      "UPDATE verified_identity SET revoked_ms=? WHERE revoked_ms IS NULL AND email IN (SELECT email FROM identity_revocations WHERE operation_id=? AND email=(SELECT email FROM verified_identity WHERE access_hash=?))",
    ).bind(now, operation, access.capability_hash),
  ]);
  if (results[0].meta.changes !== 1)
    throw new ApiError(401, "fresh_verification_required");
}
