export type StoredAttempt = {
  id: string;
  created_ms: number;
  deadline_ms: number;
  state: string;
  intent_json: string;
  association_json: string | null;
  observation_json: string | null;
};
import type { HitpayRow } from "./hitpay-journal";
import { ApiError } from "./policy";

// Request-local primary snapshot. Never retained across HTTP requests or writes.
/** Build a confirmation snapshot from retained booking evidence. */
export async function confirmationSnapshot(
  env: Env,
  id: string,
  owner: string,
) {
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      `
    SELECT a.id,a.created_ms,a.deadline_ms,a.state,a.intent_json,a.intent_hash,
      a.association_json,a.observation_json,a.confirmation_next_ms,
      r.route,c.booking_created_ms,c.payment_window_ms,c.confirmation_json,
      (SELECT expires_ms FROM hitpay_holds WHERE attempt_id=a.id) AS hold_expires_ms,
      CASE WHEN p.attempt_id IS NULL THEN NULL ELSE json_object(
        'attempt_id',p.attempt_id,'scope_json',p.scope_json,'reference',p.reference,
        'request_id',p.request_id,'checkout_url',p.checkout_url,'expires_ms',p.expires_ms,
        'created_ms',p.created_ms,'recovery_end_ms',p.recovery_end_ms,
        'state',p.state,'reason',p.reason,'tries',p.tries,'retry_limit',p.retry_limit,
        'ready_ms',p.ready_ms,'generation',p.generation,'paid_ms',p.paid_ms,
        'payment_id',p.payment_id,'external_state',p.external_state,
        'external_reservation',p.external_reservation) END AS payment_json,
      (SELECT availability_json FROM native_checkout_grants WHERE attempt_id=a.id
       UNION ALL SELECT availability_json FROM completed_native_checkout_grants WHERE attempt_id=a.id
       UNION ALL SELECT availability_json FROM expired_native_checkout_grants WHERE attempt_id=a.id) AS availability_json
    FROM attempts a
    LEFT JOIN checkout_payment_routes r ON r.attempt_id=a.id
    LEFT JOIN hitpay_payments p ON p.attempt_id=a.id
    LEFT JOIN checkout_progress c ON c.attempt_id=a.id
    WHERE a.id=? AND a.owner_id=?
  `,
    )
    .bind(id, owner)
    .first<
      StoredAttempt & {
        intent_hash: string;
        confirmation_next_ms: number;
        route: string | null;
        booking_created_ms: number | null;
        payment_window_ms: number | null;
        hold_expires_ms: number | null;
        confirmation_json: string | null;
        payment_json: string | null;
        availability_json: string | null;
      }
    >();
  if (!row) throw new ApiError(404, "attempt_unavailable");
  const payment = row.payment_json
    ? (JSON.parse(row.payment_json) as HitpayRow)
    : null;
  return {
    row,
    payment: { route: row.route, payment },
    deadline:
      row.booking_created_ms === null
        ? row.deadline_ms
        : row.booking_created_ms + row.payment_window_ms! + 300000,
    proof:
      row.confirmation_json &&
      payment?.paid_ms != null &&
      payment.payment_id &&
      payment.state !== "manual_review" &&
      payment.external_state === "observed"
        ? {
            confirmation_json: row.confirmation_json,
            scope_json: payment.scope_json,
          }
        : null,
  };
}
