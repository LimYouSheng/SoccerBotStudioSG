import { liveCustomerAccess, policy } from "./policy";

export function ongoingReadbackEnabled(env: Env) {
  const enabled: unknown = Reflect.get(env, "LIVE_READBACK");
  return (
    enabled === "enabled" &&
    liveCustomerAccess(env) &&
    policy(env).PROVIDER_ACCESS === "trusted-reads"
  );
}

// Checkout's persisted grant supplies provenance; no browser session is renewed.
// Existing deadlines and five-try recovery ownership remain authoritative.
export async function ongoingReadbackDue(
  env: Env,
  now: number,
  attemptId?: string,
) {
  if (!ongoingReadbackEnabled(env)) return null;
  return env.STATE.withSession("first-primary")
    .prepare(
      "SELECT a.id FROM native_checkout_grants g INDEXED BY native_checkout_ongoing_expiry CROSS JOIN attempts a ON a.id=g.attempt_id CROSS JOIN recovery_work r ON r.attempt_id=a.id WHERE g.ongoing=1 AND g.expires_ms>? AND r.state IN ('due','claimed') AND r.ready_ms<=? AND r.tries<5 AND (r.tries=0 OR r.updated_ms<=?) AND a.state IN ('dispatching','observed','recovery_required') AND a.association_json IS NOT NULL AND a.deadline_ms>? AND g.intent_hash=a.intent_hash AND (? IS NULL OR a.id=?) ORDER BY r.ready_ms,r.attempt_id LIMIT 1",
    )
    .bind(
      now,
      now,
      now - 90000,
      now + 90000,
      attemptId ?? null,
      attemptId ?? null,
    )
    .first<{ id: string }>();
}
