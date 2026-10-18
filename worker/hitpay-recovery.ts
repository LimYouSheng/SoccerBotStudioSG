import { ApiError, digest, policy } from "./policy";
import {
  hitpayRecoveryEnabled,
  hitpayFailureReason,
  hitpaySetting,
  paymentScopeSchema,
  assertPaymentScope,
} from "./hitpay-contract";
import {
  claimHitpay,
  findHitpayRequest,
  paymentRow,
  reopenHitpayReview,
} from "./hitpay-journal";
import { associationSchema, intentSchema, recordObservation } from "./journal";
import { readNativeAttempt, storedNativeSignature } from "./native-adapter";
import { ProviderSession, type ProviderControl } from "./provider-session";

export async function recoverHitpay(
  env: Env,
  id: string,
  provider: ProviderSession,
  base: ProviderControl,
) {
  if (
    !hitpayRecoveryEnabled(env) ||
    policy(env).PROVIDER_ACCESS !== "trusted-reads"
  )
    return;
  const row = await claimHitpay(env, id, Date.now());
  if (!row) return;
  const end = Date.now() + 90000;
  let calls = 0;
  const assertClaim = async () => {
    if (Date.now() >= end) throw new ApiError(409, "hitpay_claim_expired");
    const current = await paymentRow(env.STATE, id);
    if (
      !current ||
      current.state !== "claimed" ||
      current.generation !== row.generation ||
      current.ready_ms <= Date.now()
    )
      throw new ApiError(409, "hitpay_claim_stale");
  };
  const reserve = async () => {
    await assertClaim();
    if (++calls > 40) throw new ApiError(503, "hitpay_recovery_budget");
  };
  const control: ProviderControl = {
    ...base,
    reserve: async () => {
      await reserve();
      return base.reserve();
    },
  };
  let result = "due",
    reason = "verification_pending";
  try {
    const scope = paymentScopeSchema.parse(JSON.parse(row.scope_json));
    await assertPaymentScope(env, scope);
    const attempt = await env.STATE.withSession("first-primary")
      .prepare(
        "SELECT intent_json,intent_hash,association_json,version FROM attempts WHERE id=?",
      )
      .bind(id)
      .first<{
        intent_json: string;
        intent_hash: string;
        association_json: string;
        version: number;
      }>();
    if (
      !attempt ||
      attempt.intent_hash !== scope.intentHash ||
      (await digest(attempt.intent_json)) !== scope.intentHash ||
      attempt.association_json !== scope.associationJson
    )
      throw new ApiError(409, "hitpay_scope_mismatch");
    const intent = intentSchema.parse(JSON.parse(attempt.intent_json)),
      refs = associationSchema.parse(JSON.parse(attempt.association_json));
    if (
      intent.customerId !== scope.customerId ||
      intent.totalMinor !== scope.totalMinor ||
      intent.currency !== scope.currency ||
      refs.invoiceId !== scope.invoiceId
    )
      throw new ApiError(409, "hitpay_scope_mismatch");
    const verified = await findHitpayRequest(env, row, reserve);
    await assertClaim();
    await env.STATE.prepare(
      "UPDATE hitpay_payments SET request_id=COALESCE(request_id,?),checkout_url=COALESCE(checkout_url,?) WHERE attempt_id=? AND state='claimed' AND generation=?",
    )
      .bind(verified.id, verified.url, id, row.generation)
      .run();
    if (!verified.paymentId) {
      if (row.paid_ms !== null)
        throw new ApiError(409, "hitpay_paid_state_changed");
      reason = "payment_pending";
      if (["failed", "expired", "canceled"].includes(verified.status)) {
        result = "manual_review";
        reason = "hitpay_payment_" + verified.status;
      }
      return;
    }
    // Monotonic evidence: later failed callbacks cannot erase a verified payment.
    await env.STATE.prepare(
      "UPDATE hitpay_payments SET paid_ms=COALESCE(paid_ms,?),payment_id=COALESCE(payment_id,?) WHERE attempt_id=? AND state='claimed' AND generation=?",
    )
      .bind(Date.now(), verified.paymentId, id, row.generation)
      .run();
    if (row.payment_id !== null && row.payment_id !== verified.paymentId)
      throw new ApiError(409, "hitpay_payment_identity_changed");
    const secret = hitpaySetting(env, "SIMPLYBOOK_DEV_SIGNING_SECRET");
    if (!secret) throw new ApiError(503, "native_signing_unavailable");
    const read = async () => {
      await assertClaim();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Math.max(1, end - Date.now()),
      );
      try {
        return (
          await readNativeAttempt({
            parallelSingle: true,
            paymentProcessor: scope.externalProcessor,
            scope: {
              attemptId: id,
              companyLogin: scope.companyLogin,
              timezone: "Asia/Singapore",
              intent,
            },
            association: refs,
            signature: (bookingId) =>
              storedNativeSignature(env.STATE, id, bookingId, secret),
            signal: controller.signal,
            exchange: async (operation, signal) => {
              await assertClaim();
              await provider.identity(env, control);
              return provider.nativeRead(env, control, operation, signal);
            },
          })
        ).observation;
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    };
    let observation = await read();
    if (
      observation.bookings.some((b) => b.status !== "confirmed") ||
      !["paid", "unpaid"].includes(observation.invoice.status)
    )
      throw new ApiError(409, "hitpay_paid_booking_invalid");
    if (observation.invoice.status === "paid" && row.external_state === "none")
      throw new ApiError(409, "invoice_already_paid_review");
    if (observation.invoice.status !== "paid") {
      // Expired holds and past sessions never gain capacity by receiving money.
      if (
        Date.now() >= row.expires_ms ||
        intent.sessions.some((s) => s.startMs <= Date.now())
      )
        throw new ApiError(409, "hitpay_late_payment_review");
      if (row.external_state !== "none") {
        reason = "external_write_unknown";
        return;
      }
      if (
        hitpaySetting(env, "SIMPLYBOOK_EXTERNAL_PAYMENT") !== "sandbox-reviewed"
      )
        throw new ApiError(503, "external_payment_disabled");
      const processor = hitpaySetting(env, "SIMPLYBOOK_EXTERNAL_PROCESSOR");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(processor))
        throw new ApiError(503, "external_payment_disabled");
      await assertClaim();
      const reservation = await env.STATE.prepare(
        "UPDATE hitpay_payments SET external_state='unknown' WHERE attempt_id=? AND state='claimed' AND generation=? AND external_state='none' RETURNING attempt_id",
      )
        .bind(id, row.generation)
        .first();
      if (!reservation) throw new ApiError(409, "external_payment_reserved");
      // The write reply is not payment evidence; an unknown write is never replayed.
      await provider.nativeWrite(
        env,
        control,
        {
          kind: "invoice-external-payment",
          invoiceId: refs.invoiceId,
          processor,
        },
        assertClaim,
        async (reservationId) => {
          const stored = await env.STATE.prepare(
            "UPDATE hitpay_payments SET external_reservation=? WHERE attempt_id=? AND state='claimed' AND generation=? AND external_reservation IS NULL RETURNING attempt_id",
          )
            .bind(reservationId, id, row.generation)
            .first();
          if (!stored) throw new ApiError(409, "external_payment_reserved");
        },
      );
      observation = await read();
    }
    if (
      observation.invoice.status !== "paid" ||
      observation.bookings.some((b) => b.status !== "confirmed")
    ) {
      reason = "payment_received_booking_pending";
      return;
    }
    await assertClaim();
    await recordObservation(
      env.STATE,
      id,
      attempt.version,
      observation,
      Date.now(),
    );
    await env.STATE.prepare(
      "UPDATE hitpay_payments SET external_state='observed' WHERE attempt_id=? AND state='claimed' AND generation=?",
    )
      .bind(id, row.generation)
      .run();
    const retained = await paymentRow(env.STATE, id);
    if (retained?.external_reservation)
      base.reconciled?.(retained.external_reservation, id);
    result = "complete";
    reason = "verified";
  } catch (error) {
    reason = hitpayFailureReason(error);
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      ![
        "hitpay_creation_unresolved",
        "hitpay_claim_expired",
        "hitpay_claim_stale",
      ].includes(error.code)
    )
      result = "manual_review";
  } finally {
    if (
      result === "due" &&
      (row.tries >= row.retry_limit || Date.now() >= row.recovery_end_ms)
    ) {
      result = "manual_review";
      reason = "recovery_exhausted";
    }
    // Commit the terminal decision and the pending-receipt wake-up together.
    // If storage fails, the retained claim lease remains reclaimable by cron.
    await env.STATE.batch([
      env.STATE.prepare(
        "UPDATE hitpay_payments SET state=?,reason=?,ready_ms=? WHERE attempt_id=? AND state='claimed' AND generation=?",
      ).bind(
        result,
        reason,
        Date.now() + Math.min(3600000, 90000 * 2 ** Math.min(row.tries - 1, 6)),
        id,
        row.generation,
      ),
      reopenHitpayReview(env.STATE, id, Date.now()),
    ]);
  }
}
