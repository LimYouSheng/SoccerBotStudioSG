import { z } from "zod";
import { authenticate } from "./access";
import { ApiError } from "./policy";
import { rememberedConsentSql } from "./remembered-identity";

const inputSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  name: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s()-]{8,24}$/)
    .refine((value) => {
      const digits = value.replace(/\D/g, "").length;
      return digits >= 8 && digits <= 15;
    }),
});
// Browser email is a correlation constraint, never the source of authority.
// Each statement rechecks both credentials at the actual read/write boundary.
const authority = `v.access_hash=? AND v.owner_id=? AND v.revoked_ms IS NULL
  AND v.verified_ms<=? AND v.expires_ms>?
  AND EXISTS(SELECT 1 FROM guest_access g WHERE g.capability_hash=v.access_hash
    AND g.owner_id=v.owner_id AND g.revoked_ms IS NULL AND g.issued_ms<=? AND g.expires_ms>?)
  AND (NOT EXISTS(SELECT 1 FROM identity_delivery_window WHERE singleton=3)
    OR EXISTS(SELECT 1 FROM identity_delivery_window WHERE singleton=3 AND state='open'
      AND source_revision=? AND origin=? AND opened_ms<=? AND expires_ms>? AND ?='finite-test'))`;
export async function readContactProfile(
  request: Request,
  env: Env,
  now: number,
) {
  const access = await authenticate(request, env, now);
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      `SELECT v.email,p.name,p.phone FROM verified_identity v
      LEFT JOIN contact_profiles p ON p.email=v.email AND p.account_id=? AND p.origin=?
      WHERE ${authority}`,
    )
    .bind(
      env.DEPLOYMENT_ACCOUNT_ID,
      env.APP_ORIGIN,
      access.capability_hash,
      access.owner_id,
      now,
      now,
      now,
      now,
      env.SOURCE_REVISION,
      env.APP_ORIGIN,
      now,
      now,
      env.IDENTITY_DELIVERY,
    )
    .first<{ email: string; name: string | null; phone: string | null }>();
  if (!row) throw new ApiError(401, "identity_unavailable");
  return {
    email: row.email,
    contact: row.name === null ? null : { name: row.name, phone: row.phone },
  };
}
export async function saveContactProfile(
  request: Request,
  env: Env,
  raw: unknown,
  now: number,
) {
  const input = inputSchema.safeParse(raw);
  if (!input.success) throw new ApiError(400, "invalid_contact");
  const access = await authenticate(request, env, now);
  const result = await env.STATE.prepare(
    `INSERT INTO contact_profiles(account_id,origin,email,name,phone,updated_ms)
      SELECT ?,?,v.email,?,?,? FROM verified_identity v WHERE ${authority} AND v.email=? AND ${rememberedConsentSql}
      ON CONFLICT(account_id,origin,email) DO UPDATE SET name=excluded.name,
        phone=excluded.phone,updated_ms=MAX(contact_profiles.updated_ms,excluded.updated_ms)`,
  )
    .bind(
      env.DEPLOYMENT_ACCOUNT_ID,
      env.APP_ORIGIN,
      input.data.name,
      input.data.phone,
      now,
      access.capability_hash,
      access.owner_id,
      now,
      now,
      now,
      now,
      env.SOURCE_REVISION,
      env.APP_ORIGIN,
      now,
      now,
      env.IDENTITY_DELIVERY,
      input.data.email,
      env.APP_ORIGIN,
      env.DEPLOYMENT_ACCOUNT_ID,
      now,
      now,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new ApiError(401, "identity_unavailable");
  return { email: input.data.email, saved: true };
}
