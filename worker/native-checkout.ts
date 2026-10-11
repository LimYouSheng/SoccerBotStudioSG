import { z } from "zod";
import { authenticate } from "./access";
import { ApiError, digest, policy } from "./policy";
import { intentSchema, associationSchema } from "./journal";
import { nativeAccountContractSchema } from "./prebooking";
import { orchestrateBooking } from "./orchestration";
import {
  nativeBookingOperations,
  nativeBookingSignature,
  prepareNativeLink,
  readNativeAttempt,
  storedNativeSignature,
} from "./native-adapter";
import { ProviderSession, type ProviderControl } from "./provider-session";
import { providerSecrets, type NativeExchange } from "./provider-transport";

// One reviewed developer attempt, not an open customer write API. Grants are
// installed externally from the exact approved packet; this code never grants.
type Grant = {
  capability_hash: string;
  intent_hash: string;
  source_revision: string;
  contract_json: string;
  not_before_ms: number;
  expires_ms: number;
  starting_used: number;
  maximum_used: number;
  state: string;
  result_json: string | null;
};
export async function nativeCheckoutStatus(
  request: Request,
  env: Env,
  attemptId: string,
) {
  z.string().uuid().parse(attemptId);
  const access = await authenticate(request, env, Date.now());
  const grant = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT g.state,g.result_json FROM native_checkout_grants g JOIN attempts a ON a.id=g.attempt_id WHERE g.attempt_id=? AND g.capability_hash=? AND a.owner_id=?",
    )
    .bind(attemptId, access.capability_hash, access.owner_id)
    .first<{ state: string; result_json: string | null }>();
  if (!grant) throw new ApiError(404, "native_checkout_unavailable");
  return { attemptId, state: grant.state, paymentAvailable: false };
}
export async function executeNativeCheckout(options: {
  request: Request;
  env: Env;
  attemptId: string;
  provider: ProviderSession;
  control: ProviderControl;
  accounting: () => { used: number; active: number };
}) {
  const { request, env, attemptId, provider } = options;
  z.string().uuid().parse(attemptId);
  const p = policy(env),
    now = Date.now();
  if (p.PROVIDER_ACCESS !== "trusted-reads" || p.CAMPAIGN_END_MS <= now)
    throw new ApiError(503, "provider_access_disabled");
  const access = await authenticate(request, env, now);
  const grant = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT * FROM native_checkout_grants WHERE attempt_id=? AND capability_hash=?",
    )
    .bind(attemptId, access.capability_hash)
    .first<Grant>();
  if (!grant) throw new ApiError(503, "native_write_grant_unavailable");
  if (grant.state !== "granted")
    return nativeCheckoutStatus(request, env, attemptId);
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT intent_json,intent_hash,state,deadline_ms FROM attempts WHERE id=? AND owner_id=?",
    )
    .bind(attemptId, access.owner_id)
    .first<{
      intent_json: string;
      intent_hash: string;
      state: string;
      deadline_ms: number;
    }>();
  if (!row || row.state !== "prepared")
    throw new ApiError(409, "native_attempt_unavailable");
  const intent = intentSchema.parse(JSON.parse(row.intent_json));
  const contract = nativeAccountContractSchema.parse(
    JSON.parse(grant.contract_json),
  );
  const initial = options.accounting(),
    company = providerSecrets(env).company;
  // Two sessions are the finite trial maximum, not the product cart limit.
  if (
    intent.customerMode !== "booking-contact" ||
    intent.customerId !== access.owner_id ||
    !intent.contact ||
    intent.sessions.length > 2 ||
    intent.accountId !== p.DEPLOYMENT_ACCOUNT_ID ||
    intent.environmentId !== p.ENVIRONMENT ||
    contract.accountId !== p.DEPLOYMENT_ACCOUNT_ID ||
    contract.environmentId !== p.ENVIRONMENT ||
    contract.companyLogin !== company ||
    contract.confirmedAtMs > now ||
    contract.expiresAtMs < grant.expires_ms ||
    intent.sessions.some(
      (session) => session.serviceId !== contract.serviceId,
    ) ||
    grant.intent_hash !== row.intent_hash ||
    (await digest(row.intent_json)) !== row.intent_hash ||
    !/^[a-f0-9]{40}$/.test(grant.source_revision) ||
    grant.source_revision !== p.SOURCE_REVISION ||
    !Number.isSafeInteger(grant.not_before_ms) ||
    !Number.isSafeInteger(grant.expires_ms) ||
    now < grant.not_before_ms ||
    now + 180000 >= grant.expires_ms ||
    grant.expires_ms > grant.not_before_ms + 1200000 ||
    row.deadline_ms < grant.expires_ms ||
    p.CAMPAIGN_END_MS < grant.expires_ms ||
    !Number.isSafeInteger(grant.starting_used) ||
    !Number.isSafeInteger(grant.maximum_used) ||
    initial.used !== grant.starting_used ||
    initial.active !== 0 ||
    grant.maximum_used > 64 ||
    grant.maximum_used - grant.starting_used < 20
  )
    throw new ApiError(503, "native_write_scope_unavailable");
  const secret: unknown = Reflect.get(env, "SIMPLYBOOK_DEV_SIGNING_SECRET");
  if (typeof secret !== "string" || !secret || secret.includes("["))
    throw new ApiError(503, "native_signing_unavailable");
  const claimed = await env.STATE.prepare(
    "UPDATE native_checkout_grants SET state='running' WHERE attempt_id=? AND capability_hash=? AND state='granted' AND expires_ms>?",
  )
    .bind(attemptId, access.capability_hash, Date.now() + 180000)
    .run();
  if (claimed.meta.changes !== 1)
    return nativeCheckoutStatus(request, env, attemptId);
  const assertGranted = async () => {
    const current = Date.now();
    if (current + 15000 >= Math.min(grant.expires_ms, p.CAMPAIGN_END_MS))
      throw new ApiError(503, "native_write_window_closed");
    const valid = await env.STATE.withSession("first-primary")
      .prepare(
        "SELECT 1 FROM native_checkout_grants g JOIN attempts a ON a.id=g.attempt_id JOIN guest_access c ON c.capability_hash=g.capability_hash WHERE g.attempt_id=? AND g.state='running' AND g.source_revision=? AND g.intent_hash=a.intent_hash AND g.intent_hash=? AND g.expires_ms>? AND g.contract_json=? AND c.owner_id=a.owner_id AND c.revoked_ms IS NULL AND c.issued_ms<=? AND c.expires_ms>? AND a.state IN ('prepared','dispatching') AND a.deadline_ms>?",
      )
      .bind(
        attemptId,
        p.SOURCE_REVISION,
        grant.intent_hash,
        current + 15000,
        grant.contract_json,
        current,
        current,
        current + 15000,
      )
      .first();
    if (!valid) throw new ApiError(503, "native_write_grant_closed");
  };
  let count = 0,
    last = 0;
  const control = {
    ...options.control,
    reserve: async () => {
      const delay = Math.max(0, last + 300 - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      await assertGranted();
      if (
        count >= grant.maximum_used - grant.starting_used ||
        options.accounting().used >= grant.maximum_used
      )
        throw new ApiError(503, "native_write_budget_exhausted");
      count++;
      last = Date.now();
      return options.control.reserve();
    },
  };
  const scope = {
    attemptId,
    companyLogin: company,
    timezone: "Asia/Singapore" as const,
    intent,
  };
  const exchange: NativeExchange = async (operation, signal) => {
    await assertGranted();
    if (
      ["book", "batch-create", "batch-close", "payment-link"].includes(
        operation.kind,
      )
    )
      return provider.nativeWrite(env, control, operation, assertGranted);
    return provider.nativeRead(env, control, operation, signal);
  };
  let result: { state: string; paymentAvailable: boolean } = {
    state: "recovery_required",
    paymentAvailable: false,
  };
  try {
    const prebooking = provider.prebooking(env, control, contract);
    const operations = nativeBookingOperations({
      scope,
      exchange,
      additional: { handle_invoice: true },
      db: env.STATE,
      hasRecoveryCapacity: async () =>
        grant.maximum_used <= 64 && options.accounting().active === 0,
      prebooking: {
        invalidate: () => prebooking.invalidate(),
        revalidate: async (value, index) => {
          await assertGranted();
          await provider.identity(env, control);
          return prebooking.revalidate(value, index);
        },
      },
      batchSignature: (id, hash) => nativeBookingSignature(id, hash, secret),
      clientSignature: (id, hash) => nativeBookingSignature(id, hash, secret),
    });
    result = await orchestrateBooking(request, env, attemptId, operations);
    if (result.state === "associated") {
      const associated = await env.STATE.withSession("first-primary")
        .prepare(
          "SELECT association_json FROM attempts WHERE id=? AND owner_id=? AND state='dispatching'",
        )
        .bind(attemptId, access.owner_id)
        .first<{ association_json: string }>();
      if (!associated) throw new ApiError(409, "native_association_missing");
      const refs = associationSchema.parse(
        JSON.parse(associated.association_json),
      );
      await provider.identity(env, control);
      let dueDatetime: unknown;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const observed = await readNativeAttempt({
          scope,
          association: refs,
          signal: controller.signal,
          signature: (id) =>
            storedNativeSignature(env.STATE, attemptId, id, secret),
          exchange: async (operation, signal) => {
            const response = await exchange(operation, signal);
            if (operation.kind === "invoice-read")
              dueDatetime = z
                .object({ due_datetime: z.string() })
                .parse(response.body).due_datetime;
            return response;
          },
        });
        if (
          observed.observation.invoice.status !== "unpaid" ||
          observed.observation.bookings.some(
            (booking) => booking.status !== "confirmed",
          )
        )
          throw new ApiError(409, "native_checkout_state_changed");
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
      await assertGranted();
      await prepareNativeLink(env.STATE, scope, exchange, true, {
        invoiceId: refs.invoiceId,
        dueDatetime,
        supervisionDeadlineMs: grant.expires_ms,
        handoffAtMs: Date.now(),
      });
      result = { state: "associated", paymentAvailable: true };
    }
  } catch {
    // A lost reply may have created native state. Retain the original attempt;
    // this one-use grant never resumes writes or exposes raw provider errors.
    result = { state: "recovery_required", paymentAvailable: false };
  }
  await env.STATE.prepare(
    "UPDATE native_checkout_grants SET state=?,result_json=? WHERE attempt_id=? AND state='running'",
  )
    .bind(
      result.state === "associated" ? "complete" : "blocked",
      JSON.stringify(result),
      attemptId,
    )
    .run();
  await authenticate(request, env, Date.now());
  return { attemptId, ...result };
}
