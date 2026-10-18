import { authenticate } from "./access";
import { checkoutContext } from "./confirmation";
import { ApiError } from "./policy";

// Called in the account's foreground queue. Only explicit confirmed-page exit
// releases the current grant; ownership, payment and receipt evidence stay put.
export async function dismissCompletedCheckout(
  request: Request,
  env: Env,
  id: string,
) {
  const access = await authenticate(request, env, Date.now());
  const proof = await checkoutContext(request, env, id, Date.now());
  if (!proof.confirmation) throw new ApiError(409, "booking_not_confirmed");
  const archived = await env.STATE.prepare(
    "SELECT 1 FROM completed_native_checkout_grants WHERE attempt_id=? AND capability_hash=?",
  )
    .bind(id, access.capability_hash)
    .first();
  if (archived) return { dismissed: true as const };
  const observation = await env.STATE.prepare(
    "SELECT observation_json FROM attempts WHERE id=? AND owner_id=?",
  )
    .bind(id, access.owner_id)
    .first<{ observation_json: string }>();
  if (!observation) throw new ApiError(404, "attempt_unavailable");
  // Revalidate the exact evidence captured for the transaction.
  const checked = await checkoutContext(request, env, id, Date.now());
  if (!checked.confirmation) throw new ApiError(409, "booking_not_confirmed");
  const eligible =
    "attempt_id=? AND capability_hash=? AND ongoing=1 AND state='complete' AND EXISTS(SELECT 1 FROM attempts a WHERE a.id=native_checkout_grants.attempt_id AND a.owner_id=? AND a.observation_json=?) AND EXISTS(SELECT 1 FROM hitpay_payments p WHERE p.attempt_id=native_checkout_grants.attempt_id AND p.state='complete' AND p.reason='verified' AND p.external_state='observed') AND EXISTS(SELECT 1 FROM guest_access g WHERE g.capability_hash=native_checkout_grants.capability_hash AND g.revoked_ms IS NULL AND g.expires_ms>?)";
  const values = [
    id,
    access.capability_hash,
    access.owner_id,
    observation.observation_json,
    Date.now(),
  ];
  const result = await env.STATE.batch([
    env.STATE.prepare(
      `INSERT INTO completed_native_checkout_grants SELECT * FROM native_checkout_grants WHERE ${eligible}`,
    ).bind(...values),
    env.STATE.prepare(
      `DELETE FROM native_checkout_grants WHERE ${eligible} AND EXISTS(SELECT 1 FROM completed_native_checkout_grants h WHERE h.attempt_id=native_checkout_grants.attempt_id AND h.capability_hash=native_checkout_grants.capability_hash)`,
    ).bind(...values),
  ]);
  if (result[1].meta.changes !== 1)
    throw new ApiError(409, "booking_exit_unavailable");
  return { dismissed: true as const };
}
