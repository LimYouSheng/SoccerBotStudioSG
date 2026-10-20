import type { Access } from "./access";
import type { Grant } from "./customer-authority";
import { ApiError } from "./policy";

// One transaction claims the first single-booking write. Result gates also
// appear in SQL: a failed predicate cannot authorize a later statement.
export async function claimSingleDispatch(
  db: D1Database,
  id: string,
  version: number,
  access: Access,
  grant: Grant,
  availability: string,
) {
  const now = Date.now();
  const results = await db.batch([
    db
      .prepare(
        "INSERT INTO checkout_payment_routes VALUES(?,'hitpay') ON CONFLICT(attempt_id) DO NOTHING",
      )
      .bind(id),
    db
      .prepare("SELECT route FROM checkout_payment_routes WHERE attempt_id=?")
      .bind(id),
    db
      .prepare(
        "UPDATE native_checkout_grants SET state='running',availability_json=? WHERE attempt_id=? AND capability_hash=? AND state='granted' AND source_revision=? AND intent_hash=? AND contract_json=? AND expires_ms>? AND EXISTS(SELECT 1 FROM attempts a JOIN guest_access c ON c.owner_id=a.owner_id WHERE a.id=? AND a.version=? AND a.state='prepared' AND a.intent_hash=native_checkout_grants.intent_hash AND a.deadline_ms>? AND c.capability_hash=? AND c.revoked_ms IS NULL AND c.issued_ms<=? AND c.expires_ms>?) AND EXISTS(SELECT 1 FROM checkout_payment_routes WHERE attempt_id=? AND route='hitpay')",
      )
      .bind(
        availability,
        id,
        access.capability_hash,
        grant.source_revision,
        grant.intent_hash,
        grant.contract_json,
        now + 180000,
        id,
        version,
        now + 15000,
        access.capability_hash,
        now,
        now,
        id,
      ),
    db
      .prepare(
        "UPDATE attempts SET state='dispatching',version=version+1 WHERE id=? AND version=? AND state='prepared' AND deadline_ms>? AND changes()=1",
      )
      .bind(id, version, now),
    db
      .prepare(
        "INSERT INTO dispatches(id,attempt_id,operation,fence,started_ms,outcome) SELECT ?,id,'booking.create',version,?,'unknown' FROM attempts WHERE id=? AND changes()=1",
      )
      .bind(crypto.randomUUID(), now, id),
    db
      .prepare(
        "INSERT INTO session_effects(attempt_id,step,outcome) SELECT id,'session:0','unknown' FROM attempts WHERE id=? AND version=? AND state='dispatching' AND changes()=1",
      )
      .bind(id, version + 1),
  ]);
  if (
    (results[1].results[0] as { route?: string } | undefined)?.route !==
    "hitpay"
  )
    throw new ApiError(409, "payment_route_changed");
  if (
    results[2].meta.changes !== 1 ||
    results[3].meta.changes !== 1 ||
    results[5].meta.changes !== 1
  )
    throw new ApiError(409, "dispatch_not_claimed");
  return version + 1;
}
