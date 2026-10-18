import { authenticate } from "./access";
import { ApiError, digest } from "./policy";
import { intentSchema, associationSchema } from "./journal";
import { assertHitpayCreation, hitpaySetting } from "./hitpay-contract";
import { prepareHitpay } from "./hitpay-journal";
import {
  readNativeAttempt,
  storedNativeSignature,
  type NativeScope,
} from "./native-adapter";
import type { ProviderSession, ProviderControl } from "./provider-session";

export async function retainHitpayHold(
  env: Env,
  scope: NativeScope,
  association: string,
  hash: string,
  expires: number,
) {
  await env.STATE.prepare(
    "INSERT INTO hitpay_holds(attempt_id,scope_json,association_json,intent_hash,expires_ms) VALUES(?,?,?,?,?)",
  )
    .bind(
      scope.attemptId,
      JSON.stringify({
        attemptId: scope.attemptId,
        companyLogin: scope.companyLogin,
        timezone: scope.timezone,
      }),
      association,
      hash,
      expires,
    )
    .run();
}

// A held slot must be unavailable to others. Payment validates the existing
// booking/invoice identities and state, never the availability of their slots.
export async function payHitpayHold(
  request: Request,
  env: Env,
  id: string,
  provider: ProviderSession,
  control: ProviderControl,
) {
  assertHitpayCreation(env);
  const access = await authenticate(request, env, Date.now());
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT h.scope_json,h.association_json,h.intent_hash,h.expires_ms,a.intent_json FROM hitpay_holds h JOIN attempts a ON a.id=h.attempt_id JOIN checkout_payment_routes r ON r.attempt_id=a.id WHERE a.id=? AND a.owner_id=? AND r.route='hitpay' AND a.association_json=h.association_json AND a.intent_hash=h.intent_hash",
    )
    .bind(id, access.owner_id)
    .first<{
      scope_json: string;
      association_json: string;
      intent_hash: string;
      expires_ms: number;
      intent_json: string;
    }>();
  if (!row) throw new ApiError(404, "hitpay_hold_unavailable");
  const intent = intentSchema.parse(JSON.parse(row.intent_json));
  if ((await digest(row.intent_json)) !== row.intent_hash)
    throw new ApiError(409, "hitpay_scope_mismatch");
  const scope: NativeScope = {
    attemptId: id,
    companyLogin: hitpaySetting(env, "SIMPLYBOOK_DEV_COMPANY_LOGIN"),
    timezone: "Asia/Singapore",
    intent,
  };
  if (
    JSON.stringify({
      attemptId: scope.attemptId,
      companyLogin: scope.companyLogin,
      timezone: scope.timezone,
    }) !== row.scope_json
  )
    throw new ApiError(409, "hitpay_scope_mismatch");
  const assertHeld = async () => {
    await authenticate(request, env, Date.now());
    assertHitpayCreation(env);
    if (Date.now() + 80000 >= row.expires_ms)
      throw new ApiError(409, "hitpay_hold_expired");
  };
  await assertHeld();
  const prior = await env.STATE.prepare(
    "SELECT 1 FROM hitpay_payments WHERE attempt_id=?",
  )
    .bind(id)
    .first();
  if (prior)
    return { attemptId: id, state: "checking", paymentAvailable: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const read = await readNativeAttempt({
      parallelSingle: true,
      scope,
      association: associationSchema.parse(JSON.parse(row.association_json)),
      signal: controller.signal,
      signature: (bookingId) =>
        storedNativeSignature(
          env.STATE,
          id,
          bookingId,
          hitpaySetting(env, "SIMPLYBOOK_DEV_SIGNING_SECRET"),
        ),
      exchange: async (operation, signal) => {
        await assertHeld();
        await provider.identity(env, control);
        return provider.nativeRead(env, control, operation, signal);
      },
    });
    if (
      read.observation.invoice.status !== "unpaid" ||
      read.observation.bookings.some((b) => b.status !== "confirmed")
    )
      throw new ApiError(409, "hitpay_hold_invalid");
    await prepareHitpay(
      env,
      scope,
      row.association_json,
      row.intent_hash,
      row.expires_ms,
      assertHeld,
    );
    return { attemptId: id, state: "associated", paymentAvailable: true };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
