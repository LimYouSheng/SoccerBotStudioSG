import { z } from "zod";
import { ApiError, digest } from "./policy";
import {
  assertHitpayCreation,
  hitpayFailureReason,
  assertPaymentScope,
  hitpayConfiguration,
  hitpaySetting,
  paymentScopeSchema,
  verifyHitpayRequest,
} from "./hitpay-contract";
import { hitpayRequest } from "./provider-transport";
import { associationSchema } from "./journal";
import type { NativeScope } from "./native-adapter";
export type HitpayRow = {
  attempt_id: string;
  scope_json: string;
  reference: string;
  request_id: string | null;
  checkout_url: string | null;
  expires_ms: number;
  created_ms: number;
  recovery_end_ms: number;
  state: string;
  reason: string;
  tries: number;
  retry_limit: number;
  ready_ms: number;
  generation: number;
  paid_ms: number | null;
  payment_id: string | null;
  external_state: string;
  external_reservation: string | null;
};
export async function paymentRow(db: D1Database, id: string) {
  return db
    .withSession("first-primary")
    .prepare("SELECT * FROM hitpay_payments WHERE attempt_id=?")
    .bind(id)
    .first<HitpayRow>();
}
export async function selectPaymentRoute(env: Env, id: string) {
  const selected =
    hitpaySetting(env, "CHECKOUT_PAYMENT_ROUTE") === "hitpay"
      ? "hitpay"
      : "native";
  if (selected === "hitpay") assertHitpayCreation(env);
  await env.STATE.prepare(
    "INSERT INTO checkout_payment_routes VALUES(?,?) ON CONFLICT(attempt_id) DO NOTHING",
  )
    .bind(id, selected)
    .run();
  const row = await env.STATE.withSession("first-primary")
    .prepare("SELECT route FROM checkout_payment_routes WHERE attempt_id=?")
    .bind(id)
    .first<{ route: string }>();
  if (row?.route !== selected) throw new ApiError(409, "payment_route_changed");
  return selected;
}
export async function prepareHitpay(
  env: Env,
  scope: NativeScope,
  associationJson: string,
  intentHash: string,
  expires: number,
  assertGranted: () => Promise<void>,
) {
  assertHitpayCreation(env);
  const config = hitpayConfiguration(env),
    refs = associationSchema.parse(JSON.parse(associationJson));
  const paymentScope = paymentScopeSchema.parse({
    accountId: scope.intent.accountId,
    environmentId: scope.intent.environmentId,
    companyLogin: scope.companyLogin,
    businessId: config.businessId,
    merchant: config.merchant,
    externalProcessor: hitpaySetting(env, "SIMPLYBOOK_EXTERNAL_PROCESSOR"),
    keyDigest: await digest(config.key),
    attemptId: scope.attemptId,
    intentHash,
    associationJson,
    invoiceId: refs.invoiceId,
    customerId: scope.intent.customerId,
    totalMinor: scope.intent.totalMinor,
    currency: scope.intent.currency,
  });
  await assertPaymentScope(env, paymentScope);
  await assertGranted();
  const now = Date.now(),
    reference = `soccerbot-dev-${scope.attemptId}`;
  const intent = await env.STATE.prepare(
    "INSERT INTO hitpay_payments(attempt_id,scope_json,reference,expires_ms,created_ms,recovery_end_ms,state,reason,ready_ms) VALUES(?,?,?,?,?,?,'due','creation_unknown',?) ON CONFLICT(attempt_id) DO NOTHING",
  )
    .bind(
      scope.attemptId,
      JSON.stringify(paymentScope),
      reference,
      expires,
      now,
      now + 86400000,
      now + 90000,
    )
    .run();
  if (intent.meta.changes !== 1)
    throw new ApiError(409, "hitpay_creation_already_reserved");
  let verified: ReturnType<typeof verifyHitpayRequest>;
  try {
    const raw = await hitpayRequest(
      config.key,
      {
        kind: "create",
        body: {
          amount: `${Math.floor(scope.intent.totalMinor / 100)}.${String(scope.intent.totalMinor % 100).padStart(2, "0")}`,
          currency: "SGD",
          reference_number: reference,
          allow_repeated_payments: "false",
          send_email: "false",
          send_sms: "false",
          add_admin_fee: "false",
          payment_methods: ["paynow_online", "card"],
          expires_after: `${Math.floor((expires - Date.now() - 20000) / 60000)} mins`,
          redirect_url:
            env.APP_ORIGIN + "/confirmation/?attempt=" + scope.attemptId,
          ...(scope.intent.contact
            ? {
                name: scope.intent.contact.name,
                email: scope.intent.contact.email,
              }
            : {}),
          purpose: "SoccerBot booking",
        },
      },
      async () => {
        assertHitpayCreation(env);
        await assertGranted();
        if (Date.now() + 80000 >= expires)
          throw new ApiError(409, "hitpay_checkout_expired");
      },
    );
    verified = verifyHitpayRequest(raw, paymentScope, reference);
  } catch (error) {
    await env.STATE.prepare(
      "UPDATE hitpay_payments SET reason=? WHERE attempt_id=? AND request_id IS NULL AND generation=0",
    )
      .bind(hitpayFailureReason(error), scope.attemptId)
      .run();
    throw error;
  }
  if (
    verified.status !== "pending" ||
    verified.expiresAtMs === null ||
    verified.expiresAtMs > expires ||
    verified.expiresAtMs <= Date.now() + 60000
  )
    throw new ApiError(409, "hitpay_creation_state_unverified");
  await env.STATE.prepare(
    "UPDATE hitpay_payments SET request_id=?,checkout_url=?,reason='payment_pending',ready_ms=? WHERE attempt_id=? AND request_id IS NULL AND generation=0",
  )
    .bind(verified.id, verified.url, Date.now() + 90000, scope.attemptId)
    .run();
}
// Historical payment evidence only; this never authorizes confirmation or export.
// The caller authenticates ownership before reading this private metadata.
export async function recordedHitpayPayment(
  env: Env,
  id: string,
  intentHash: string,
  associationJson: string | null,
  intentJson: string,
) {
  const row = await paymentRow(env.STATE, id);
  if (
    !row ||
    row.state !== "complete" ||
    row.reason !== "verified" ||
    row.paid_ms === null ||
    !row.payment_id ||
    row.external_state !== "observed"
  )
    return undefined;
  const scope = paymentScopeSchema.parse(JSON.parse(row.scope_json));
  await assertPaymentScope(env, scope);
  if (
    scope.attemptId !== id ||
    scope.intentHash !== intentHash ||
    scope.associationJson !== associationJson ||
    scope.intentHash !== (await digest(intentJson))
  )
    throw new ApiError(409, "hitpay_scope_mismatch");
  return { status: "recorded" as const, paidAtMs: row.paid_ms };
}

export async function storedHitpayCheckout(env: Env, id: string, now: number) {
  const route = await env.STATE.withSession("first-primary")
    .prepare("SELECT route FROM checkout_payment_routes WHERE attempt_id=?")
    .bind(id)
    .first<{ route: string }>();
  if (route?.route !== "hitpay") return null;
  const row = await paymentRow(env.STATE, id);
  if (
    !row ||
    !row.request_id ||
    !row.checkout_url ||
    row.paid_ms !== null ||
    row.expires_ms <= now ||
    row.state === "manual_review" ||
    hitpaySetting(env, "HITPAY_CHECKOUT") !== "enabled"
  )
    return { state: "unavailable" as const };
  await assertPaymentScope(
    env,
    paymentScopeSchema.parse(JSON.parse(row.scope_json)),
  );
  return {
    state: "available" as const,
    url: row.checkout_url,
    expiresAtMs: row.expires_ms,
  };
}
export async function claimHitpay(env: Env, id: string, now: number) {
  // An interrupted final claim may retain an unseen authenticated receipt.
  // Exhaustion and its permitted wake-up must commit before selecting new work.
  await env.STATE.batch([
    env.STATE.prepare(
      "UPDATE hitpay_payments SET state='manual_review',reason='recovery_exhausted' WHERE attempt_id=? AND state IN ('due','claimed') AND ready_ms<=? AND (tries>=retry_limit OR recovery_end_ms<=?)",
    ).bind(id, now, now),
    reopenHitpayReview(env.STATE, id, now),
  ]);
  return env.STATE.prepare(
    "UPDATE hitpay_payments SET state='claimed',tries=tries+1,generation=generation+1,receipt_checkpoint=COALESCE((SELECT MAX(rowid) FROM hitpay_receipts WHERE attempt_id=hitpay_payments.attempt_id),0),ready_ms=? WHERE attempt_id=? AND state IN ('due','claimed') AND ready_ms<=? AND tries<retry_limit AND recovery_end_ms>? RETURNING *",
  )
    .bind(now + 120000, id, now, now)
    .first<HitpayRow>();
}
export async function findHitpayRequest(
  env: Env,
  row: HitpayRow,
  reserve: () => Promise<void>,
) {
  const scope = paymentScopeSchema.parse(JSON.parse(row.scope_json));
  await assertPaymentScope(env, scope);
  const { key } = hitpayConfiguration(env);
  let id = row.request_id;
  if (!id) {
    const candidates = new Set<string>();
    for (const page of [1, 2] as const) {
      const raw = await hitpayRequest(
        key,
        { kind: "search", reference: row.reference, page },
        reserve,
      );
      const list = z
        .object({
          data: z
            .array(
              z.object({
                id: z.string().uuid(),
                reference_number: z.string().nullable(),
              }),
            )
            .max(20),
        })
        .parse(raw);
      for (const item of list.data)
        if (item.reference_number === row.reference) candidates.add(item.id);
      if (list.data.length < 20) break;
      if (page === 2) throw new ApiError(409, "hitpay_search_unresolved");
    }
    if (candidates.size !== 1)
      throw new ApiError(409, "hitpay_creation_unresolved");
    id = [...candidates][0];
  }
  const verified = verifyHitpayRequest(
    await hitpayRequest(key, { kind: "read", id }, reserve),
    scope,
    row.reference,
    id,
  );
  return verified;
}

export async function hitpayConfirmationGuard(env: Env, id: string) {
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT r.route,p.state,p.paid_ms,p.payment_id,p.external_state FROM checkout_payment_routes r LEFT JOIN hitpay_payments p ON p.attempt_id=r.attempt_id WHERE r.attempt_id=?",
    )
    .bind(id)
    .first<{
      route: string;
      state: string | null;
      paid_ms: number | null;
      payment_id: string | null;
      external_state: string | null;
    }>();
  if (row?.route !== "hitpay") return null;
  if (
    row?.state === "complete" &&
    row.paid_ms !== null &&
    row.payment_id !== null &&
    row.external_state === "observed"
  )
    return null;
  return {
    status: row?.state === "manual_review" ? "unresolved" : "pending",
    reason:
      row?.paid_ms !== null && row?.paid_ms !== undefined
        ? "payment_received_booking_pending"
        : "payment_verification_pending",
  };
}

// A durable receipt watermark closes the webhook-versus-active-claim race.
// Each distinct authenticated receipt can wake eligible terminal work once.
export function reopenHitpayReview(db: D1Database, id: string, now: number) {
  return db
    .prepare(
      "UPDATE hitpay_payments SET state='due',reason='webhook_recheck_pending',ready_ms=?,retry_limit=MIN(16,MAX(retry_limit,tries+1)),receipt_checkpoint=(SELECT MAX(rowid) FROM hitpay_receipts WHERE attempt_id=hitpay_payments.attempt_id) WHERE attempt_id=? AND state='manual_review' AND reason IN ('hitpay_payment_failed','hitpay_payment_expired','hitpay_payment_canceled','recovery_exhausted') AND tries<16 AND recovery_end_ms>? AND EXISTS(SELECT 1 FROM hitpay_receipts WHERE attempt_id=hitpay_payments.attempt_id AND rowid>hitpay_payments.receipt_checkpoint)",
    )
    .bind(now, id, now);
}
