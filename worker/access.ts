import { ApiError, capability, digest, policy } from "./policy";
const cookieName = "__Host-soccerbot-access";
export type Access = {
  owner_id: string;
  capability_hash: string;
  issued_ms: number;
  expires_ms: number;
};
export async function authenticate(
  request: Request,
  env: Env,
  now: number,
): Promise<Access> {
  const cookies = (request.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith(cookieName + "="));
  if (cookies.length !== 1) throw new ApiError(401, "access_denied");
  const token = cookies[0].slice(cookieName.length + 1);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, "access_denied");
  const hash = await digest(token);
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT owner_id, capability_hash, issued_ms, expires_ms FROM guest_access WHERE capability_hash = ? AND revoked_ms IS NULL AND issued_ms <= ? AND expires_ms > ?",
    )
    .bind(hash, now, now)
    .first<Access>();
  if (!row) throw new ApiError(401, "access_denied");
  return row;
}
export async function createAccess(env: Env, now: number) {
  const token = capability(),
    owner = crypto.randomUUID(),
    duration = policy(env).ACCESS_LIFETIME_MS;
  await env.STATE.prepare(
    "INSERT INTO guest_access(capability_hash,owner_id,issued_ms,expires_ms) VALUES(?,?,?,?)",
  )
    .bind(await digest(token), owner, now, now + duration)
    .run();
  return `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(duration / 1000)}`;
}
export async function revokeAccess(env: Env, access: Access, now: number) {
  await env.STATE.prepare(
    "UPDATE guest_access SET revoked_ms=? WHERE capability_hash=? AND revoked_ms IS NULL",
  )
    .bind(now, access.capability_hash)
    .run();
  return clearAccessCookie();
}

export function clearAccessCookie() {
  return `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}
