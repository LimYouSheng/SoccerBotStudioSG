import { z } from "zod";
import { ApiError, digest } from "./policy";
// Internal server-approved intent only. No HTTP endpoint accepts this envelope.
export const intentSchema = z
  .strictObject({
    accountId: z.string().min(1).max(128),
    environmentId: z.literal("developer"),
    customerId: z.string().min(1).max(128),
    currency: z.literal("SGD"),
    totalMinor: z.number().int().nonnegative().safe(),
    taxMinor: z.number().int().nonnegative().safe(),
    sessions: z
      .array(
        z.strictObject({
          serviceId: z.string().min(1).max(128),
          instructorId: z.string().min(1).max(128),
          startMs: z.number().int().positive().safe(),
          players: z.number().int().min(1).max(4),
          totalMinor: z.number().int().nonnegative().safe(),
          taxMinor: z.number().int().nonnegative().safe(),
        }),
      )
      .min(1)
      .max(12),
  })
  .superRefine((v, ctx) => {
    if (
      v.taxMinor > v.totalMinor ||
      v.sessions.some((s) => s.taxMinor > s.totalMinor) ||
      v.sessions.reduce((n, s) => n + s.totalMinor, 0) !== v.totalMinor ||
      v.sessions.reduce((n, s) => n + s.taxMinor, 0) !== v.taxMinor
    )
      ctx.addIssue({ code: "custom", message: "money" });
    const starts = v.sessions.map((s) => s.startMs).sort((a, b) => a - b);
    if (starts.some((s, i) => i > 0 && s - starts[i - 1] < 50 * 60000))
      ctx.addIssue({ code: "custom", message: "overlap" });
  });
export async function prepareAttempt(
  db: D1Database,
  owner: string,
  key: string,
  intent: unknown,
  now: number,
  deadlineMs: number,
) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key))
    throw new ApiError(400, "invalid_idempotency_key");
  const parsed = intentSchema.parse(intent);
  if (parsed.sessions.some((s) => s.startMs <= now))
    throw new ApiError(409, "elapsed_selection");
  const json = JSON.stringify(parsed),
    hash = await digest(json),
    id = crypto.randomUUID();
  const session = db.withSession("first-primary");
  await session
    .prepare(
      "INSERT INTO attempts(id,owner_id,idempotency_key,intent_json,intent_hash,created_ms,deadline_ms,state) VALUES(?,?,?,?,?,?,?,'prepared') ON CONFLICT(owner_id,idempotency_key) DO NOTHING",
    )
    .bind(id, owner, key, json, hash, now, now + deadlineMs)
    .run();
  const row = await session
    .prepare(
      "SELECT id,intent_hash,version,state FROM attempts WHERE owner_id=? AND idempotency_key=?",
    )
    .bind(owner, key)
    .first<{
      id: string;
      intent_hash: string;
      version: number;
      state: string;
    }>();
  if (!row || row.intent_hash !== hash)
    throw new ApiError(409, "idempotency_conflict");
  return row;
}
export async function claimDispatch(
  db: D1Database,
  id: string,
  version: number,
  now: number,
) {
  const dispatchId = crypto.randomUUID();
  const result = await db.batch([
    db
      .prepare(
        "UPDATE attempts SET state='dispatching',version=version+1 WHERE id=? AND version=? AND state='prepared' AND deadline_ms>?",
      )
      .bind(id, version, now),
    db
      .prepare(
        "INSERT INTO dispatches(id,attempt_id,operation,fence,started_ms,outcome) SELECT ?,id,'booking.create',version,?,'unknown' FROM attempts WHERE id=? AND changes()=1",
      )
      .bind(dispatchId, now, id),
  ]);
  if (result[0].meta.changes !== 1)
    throw new ApiError(409, "dispatch_not_claimed");
  return { dispatchId, fence: version + 1 };
}
export async function recordObservation(
  db: D1Database,
  id: string,
  fence: number,
  observation: unknown,
  observedMs: number,
) {
  // A stale completion cannot overwrite a later observation or a recovery fence.
  const result = await db
    .prepare(
      "UPDATE attempts SET observation_json=?,observation_ms=?,version=version+1,state='observed' WHERE id=? AND version=? AND association_json IS NOT NULL AND state IN ('dispatching','observed','recovery_required') AND (observation_ms IS NULL OR observation_ms<?)",
    )
    .bind(JSON.stringify(observation), observedMs, id, fence, observedMs)
    .run();
  if (result.meta.changes !== 1) throw new ApiError(409, "stale_completion");
}
export async function requireRecovery(
  db: D1Database,
  id: string,
  fence: number,
) {
  const r = await db
    .prepare(
      "UPDATE attempts SET state='recovery_required',version=version+1 WHERE id=? AND version=? AND state='dispatching'",
    )
    .bind(id, fence)
    .run();
  return r.meta.changes === 1;
}

export const associationSchema = z
  .strictObject({
    invoiceId: z.string().min(1).max(128),
    bookingIds: z.array(z.string().min(1).max(128)).min(1).max(12),
  })
  .refine((v) => new Set(v.bookingIds).size === v.bookingIds.length);
export async function bindAssociation(
  db: D1Database,
  id: string,
  fence: number,
  references: unknown,
) {
  const refs = associationSchema.parse(references);
  const row = await db
    .withSession("first-primary")
    .prepare(
      "SELECT intent_json FROM attempts WHERE id=? AND version=? AND state='dispatching'",
    )
    .bind(id, fence)
    .first<{ intent_json: string }>();
  if (
    !row ||
    intentSchema.parse(JSON.parse(row.intent_json)).sessions.length !==
      refs.bookingIds.length
  )
    throw new ApiError(409, "association_conflict");
  const result = await db.batch([
    db
      .prepare(
        "UPDATE attempts SET association_json=?,version=version+1 WHERE id=? AND version=? AND state='dispatching' AND association_json IS NULL",
      )
      .bind(JSON.stringify(refs), id, fence),
    db
      .prepare(
        "UPDATE dispatches SET outcome='observed' WHERE attempt_id=? AND fence=? AND outcome='unknown' AND changes()=1",
      )
      .bind(id, fence),
  ]);
  if (result[0].meta.changes !== 1)
    throw new ApiError(409, "association_conflict");
  return fence + 1;
}
