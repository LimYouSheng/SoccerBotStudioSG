import { authenticate } from "./access";
import { ApiError, digest } from "./policy";
import { receiptSchema } from "../src/domain/native-checkout";
import { assertPaymentScope, paymentScopeSchema } from "./hitpay-contract";
import { receiptData } from "./receipt-data";
import type { HitpayRow } from "./hitpay-journal";

// A verified live hold plus a matching, verified payment completes the customer
// journey. Accounting/readback continues under the original financial claim.
export async function retainCustomerConfirmation(
  env: Env,
  payment: HitpayRow,
  now: number,
) {
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT a.id,a.created_ms,a.intent_json,a.association_json,a.intent_hash,h.expires_ms FROM attempts a JOIN hitpay_holds h ON h.attempt_id=a.id JOIN checkout_progress c ON c.attempt_id=a.id WHERE a.id=? AND a.state='observed' AND a.intent_hash=h.intent_hash AND a.association_json=h.association_json",
    )
    .bind(payment.attempt_id)
    .first<{
      id: string;
      created_ms: number;
      intent_json: string;
      association_json: string;
      intent_hash: string;
      expires_ms: number;
    }>();
  if (
    !row ||
    now >= Math.min(row.expires_ms, payment.expires_ms) ||
    Date.now() >= row.expires_ms
  )
    return;
  const scope = paymentScopeSchema.parse(JSON.parse(payment.scope_json));
  await assertPaymentScope(env, scope);
  if (
    scope.intentHash !== row.intent_hash ||
    scope.associationJson !== row.association_json ||
    (await digest(row.intent_json)) !== row.intent_hash
  )
    throw new ApiError(409, "hitpay_scope_mismatch");
  const receipt = await receiptData(env, row, now);
  if (receipt.sessions.some((s) => s.startMs <= Date.now())) return;
  await env.STATE.prepare(
    "UPDATE checkout_progress SET confirmation_json=? WHERE attempt_id=? AND confirmation_json IS NULL AND EXISTS(SELECT 1 FROM hitpay_payments p WHERE p.attempt_id=checkout_progress.attempt_id AND p.state='claimed' AND p.generation=? AND p.paid_ms IS NOT NULL AND p.payment_id IS NOT NULL)",
  )
    .bind(JSON.stringify(receipt), row.id, payment.generation)
    .run();
}

export async function customerConfirmation(env: Env, id: string) {
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT c.confirmation_json,p.scope_json FROM checkout_progress c JOIN hitpay_payments p ON p.attempt_id=c.attempt_id WHERE c.attempt_id=? AND c.confirmation_json IS NOT NULL AND p.paid_ms IS NOT NULL AND p.payment_id IS NOT NULL AND p.state!='manual_review'",
    )
    .bind(id)
    .first<{ confirmation_json: string; scope_json: string }>();
  if (!row) return undefined;
  await assertPaymentScope(
    env,
    paymentScopeSchema.parse(JSON.parse(row.scope_json)),
  );
  return receiptSchema.parse(JSON.parse(row.confirmation_json));
}

// Time alone is not proof of non-payment. Once a payment creation was
// dispatched, only authoritative expired-without-payment evidence may release
// the active grant. A newer webhook invalidates that evidence.
const unpaidExpiry = `EXISTS(SELECT 1 FROM hitpay_holds h WHERE h.attempt_id=native_checkout_grants.attempt_id AND MIN(h.expires_ms,COALESCE((SELECT c.booking_created_ms+300000 FROM checkout_progress c WHERE c.attempt_id=h.attempt_id),h.expires_ms))<=?) AND (NOT EXISTS(SELECT 1 FROM hitpay_payments p WHERE p.attempt_id=native_checkout_grants.attempt_id) OR EXISTS(SELECT 1 FROM hitpay_payments p WHERE p.attempt_id=native_checkout_grants.attempt_id AND p.state='manual_review' AND p.reason='hitpay_payment_expired' AND p.paid_ms IS NULL AND p.payment_id IS NULL AND p.external_state='none' AND NOT EXISTS(SELECT 1 FROM hitpay_receipts r WHERE r.attempt_id=p.attempt_id AND r.rowid>p.receipt_checkpoint)))`;
export async function checkoutExpired(env: Env, id: string, now: number) {
  return !!(await env.STATE.withSession("first-primary")
    .prepare(
      `SELECT 1 FROM native_checkout_grants WHERE attempt_id=? AND ongoing=1 AND state='complete' AND ${unpaidExpiry} UNION ALL SELECT 1 FROM expired_native_checkout_grants WHERE attempt_id=? AND ${unpaidExpiry.replaceAll("native_checkout_grants", "expired_native_checkout_grants")}`,
    )
    .bind(id, now, id, now)
    .first());
}
export async function expireCheckout(request: Request, env: Env, id: string) {
  const access = await authenticate(request, env, Date.now());
  if (
    await env.STATE.prepare(
      `SELECT 1 FROM expired_native_checkout_grants WHERE attempt_id=? AND capability_hash=? AND EXISTS(SELECT 1 FROM attempts a WHERE a.id=expired_native_checkout_grants.attempt_id AND a.owner_id=?) AND ${unpaidExpiry.replaceAll("native_checkout_grants", "expired_native_checkout_grants")}`,
    )
      .bind(id, access.capability_hash, access.owner_id, Date.now())
      .first()
  )
    return { expired: true };
  const eligible = `attempt_id=? AND capability_hash=? AND ongoing=1 AND state='complete' AND EXISTS(SELECT 1 FROM attempts a WHERE a.id=native_checkout_grants.attempt_id AND a.owner_id=?) AND EXISTS(SELECT 1 FROM guest_access g WHERE g.capability_hash=native_checkout_grants.capability_hash AND g.revoked_ms IS NULL AND g.expires_ms>?) AND ${unpaidExpiry}`;
  const now = Date.now(),
    values = [id, access.capability_hash, access.owner_id, now, now];
  const results = await env.STATE.batch([
    env.STATE.prepare(
      `INSERT INTO expired_native_checkout_grants SELECT * FROM native_checkout_grants WHERE ${eligible}`,
    ).bind(...values),
    env.STATE.prepare(
      `DELETE FROM native_checkout_grants WHERE ${eligible} AND EXISTS(SELECT 1 FROM expired_native_checkout_grants h WHERE h.attempt_id=native_checkout_grants.attempt_id AND h.capability_hash=native_checkout_grants.capability_hash)`,
    ).bind(...values),
  ]);
  if (results[1].meta.changes !== 1)
    throw new ApiError(409, "checkout_expiry_unresolved");
  return { expired: true };
}
