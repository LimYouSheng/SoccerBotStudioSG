import type { Access } from "./access";
import type { Grant } from "./customer-authority";
import { ApiError } from "./policy";

// One transaction claims the first provider write. Result gates also
// appear in SQL: a failed predicate cannot authorize a later statement.
export async function claimNativeDispatch(
  db: D1Database,
  id: string,
  version: number,
  access: Access,
  grant: Grant,
  availability: string,
  firstStep = "session:0",
  preparation: D1PreparedStatement[] = [],
) {
  const now = Date.now();
  const all = await db.batch([
    ...preparation,
    db
      .prepare(
        "INSERT INTO checkout_payment_routes(attempt_id,route) SELECT a.id,'hitpay' FROM attempts a JOIN native_checkout_grants g ON g.attempt_id=a.id WHERE a.id=? AND a.owner_id=? AND a.intent_hash=? AND a.state='prepared' AND a.version=? AND g.capability_hash=? AND g.state='granted' AND g.contract_json=? AND g.intent_hash=a.intent_hash ON CONFLICT(attempt_id) DO NOTHING",
      )
      .bind(
        id,
        access.owner_id,
        grant.intent_hash,
        version,
        access.capability_hash,
        grant.contract_json,
      ),
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
        "INSERT INTO session_effects(attempt_id,step,outcome) SELECT id,?,'unknown' FROM attempts WHERE id=? AND version=? AND state='dispatching' AND changes()=1",
      )
      .bind(firstStep, id, version + 1),
  ]);
  const results = all.slice(preparation.length);
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

// Every later batch effect combines fresh authority and one durable reservation.
// Unknown effects cannot be inserted twice, including after process loss.
export async function claimNativeEffect(
  db: D1Database,
  id: string,
  version: number,
  access: Access,
  grant: Grant,
  step: string,
) {
  const now = Date.now();
  const result = await db
    .prepare(
      "INSERT INTO session_effects(attempt_id,step,outcome) SELECT a.id,?,'unknown' FROM attempts a JOIN native_checkout_grants g ON g.attempt_id=a.id JOIN guest_access c ON c.capability_hash=g.capability_hash WHERE a.id=? AND a.version=? AND a.state='dispatching' AND a.association_json IS NULL AND a.deadline_ms>? AND g.state='running' AND g.source_revision=? AND g.intent_hash=a.intent_hash AND g.intent_hash=? AND g.contract_json=? AND g.expires_ms>? AND c.capability_hash=? AND c.owner_id=a.owner_id AND c.owner_id=? AND c.revoked_ms IS NULL AND c.issued_ms<=? AND c.expires_ms>?",
    )
    .bind(
      step,
      id,
      version,
      now + 15000,
      grant.source_revision,
      grant.intent_hash,
      grant.contract_json,
      now + 15000,
      access.capability_hash,
      access.owner_id,
      now,
      now,
    )
    .run();
  if (result.meta.changes !== 1) throw new ApiError(409, "effect_not_claimed");
}
