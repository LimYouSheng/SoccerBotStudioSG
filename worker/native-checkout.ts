import { retainHoldEvidence } from "./native-hold-evidence";
import { retainHitpayHold } from "./hitpay-hold";
import { hitpaySetting } from "./hitpay-contract";
import { selectPaymentRoute } from "./hitpay-journal";
import { NativeCalendarReads, calendarDates } from "./native-calendar";
import { nativeValidationReason } from "./provider-normalization";
import { safeNativeFailure } from "./native-residual";
import { z } from "zod";
import { authenticate } from "./access";
import { ApiError, digest, policy, liveCustomerAccess } from "./policy";
import {
  intentSchema,
  associationSchema,
  prepareAttempt,
  recordObservation,
  requireRecovery,
} from "./journal";
import {
  nativeAccountContractSchema,
  nativeContractSelection,
  offeredStarts,
  nativeTrialLeadMs,
  nativeCustomerHours,
} from "./prebooking";
import {
  nativeAvailabilitySchema,
  nativePrepareSchema,
  nativeCurrentSchema,
  type nativeOfferSchema,
} from "../src/domain/native-checkout";
import { freshReceipt } from "./catalogue";
import { orchestrateBooking } from "./orchestration";
import {
  nativeCheckoutDeadline,
  nativeBookingOperations,
  nativeBookingSignature,
  prepareNativeLink,
  readNativeAttempt,
  storedNativeSignature,
  compensateNativeAttempt,
} from "./native-adapter";
import { ProviderSession, type ProviderControl } from "./provider-session";
import { providerSecrets, type NativeExchange } from "./provider-transport";

// Both operator experiments and ongoing customer checkout use one-use grants.
// Customer grants are issued after authenticated consent and fresh slot reads.
type Grant = {
  capability_hash: string;
  attempt_id: string | null;
  intent_hash: string | null;
  source_revision: string;
  contract_json: string;
  not_before_ms: number;
  expires_ms: number;
  starting_used: number;
  maximum_used: number;
  cleanup_allowed: number;
  state: string;
  result_json: string | null;
  available_dates_json: string;
  availability_json: string | null;
  read_state: string;
  ongoing: number;
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
  recoveryControl: ProviderControl;
  accounting: () => { used: number; active: number };
  holding?: boolean;
  combinedHold?: boolean;
}) {
  const { request, env, attemptId, provider } = options;
  z.string().uuid().parse(attemptId);
  const p = policy(env),
    now = Date.now();
  if (
    p.PROVIDER_ACCESS !== "trusted-reads" ||
    (p.CAMPAIGN_END_MS <= now && !liveCustomerAccess(env))
  )
    throw new ApiError(503, "provider_access_disabled");
  const access = await authenticate(request, env, now);
  const grant = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT * FROM native_checkout_grants WHERE attempt_id=? AND capability_hash=?",
    )
    .bind(attemptId, access.capability_hash)
    .first<Grant>();
  if (!grant) throw new ApiError(503, "native_write_grant_unavailable");
  const ongoing = grant.ongoing === 1 && liveCustomerAccess(env);
  if (grant.ongoing === 1 && !ongoing)
    throw new ApiError(503, "provider_access_disabled");
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
    intent.sessions.length > (ongoing ? 12 : 2) ||
    intent.accountId !== p.DEPLOYMENT_ACCOUNT_ID ||
    intent.environmentId !== p.ENVIRONMENT ||
    contract.accountId !== p.DEPLOYMENT_ACCOUNT_ID ||
    contract.environmentId !== p.ENVIRONMENT ||
    contract.companyLogin !== company ||
    contract.confirmedAtMs > now ||
    contract.expiresAtMs < grant.expires_ms ||
    intent.sessions.some(
      (session) =>
        session.serviceId !==
        nativeContractSelection(contract, session.startMs).serviceId,
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
    (!ongoing && p.CAMPAIGN_END_MS < grant.expires_ms) ||
    !Number.isSafeInteger(grant.starting_used) ||
    !Number.isSafeInteger(grant.maximum_used) ||
    initial.used < grant.starting_used ||
    (!ongoing && initial.used + 20 > grant.maximum_used) ||
    initial.active !== 0 ||
    (!ongoing && grant.maximum_used > p.PROVIDER_CALL_CEILING - 16) ||
    grant.maximum_used - grant.starting_used < 20
  )
    throw new ApiError(503, "native_write_scope_unavailable");
  const secret: unknown = Reflect.get(env, "SIMPLYBOOK_DEV_SIGNING_SECRET");
  if (typeof secret !== "string" || !secret || secret.includes("["))
    throw new ApiError(503, "native_signing_unavailable");
  const paymentRoute = await selectPaymentRoute(env, attemptId);
  if ((paymentRoute === "hitpay") !== (options.holding === true))
    throw new ApiError(409, "booking_hold_required");
  const claimed = await env.STATE.prepare(
    "UPDATE native_checkout_grants SET state='running' WHERE attempt_id=? AND capability_hash=? AND state='granted' AND expires_ms>?",
  )
    .bind(attemptId, access.capability_hash, Date.now() + 180000)
    .run();
  if (claimed.meta.changes !== 1)
    return nativeCheckoutStatus(request, env, attemptId);
  let cleanupMode = false;
  let cleanupSignal: AbortSignal | undefined;
  // Entry authentication establishes this operation's access. Reads retain
  // local time/cancellation checks; writes recheck durable authority after identity.
  const assertWindow = () => {
    cleanupSignal?.throwIfAborted();
    const current = Date.now();
    if (current >= access.expires_ms) throw new ApiError(401, "access_denied");
    if (
      current + 15000 >=
      Math.min(grant.expires_ms, ongoing ? grant.expires_ms : p.CAMPAIGN_END_MS)
    )
      throw new ApiError(503, "native_write_window_closed");
  };
  const assertGranted = async () => {
    assertWindow();
    const current = Date.now();
    const valid = await env.STATE.withSession("first-primary")
      .prepare(
        "SELECT 1 FROM native_checkout_grants g JOIN attempts a ON a.id=g.attempt_id JOIN guest_access c ON c.capability_hash=g.capability_hash WHERE g.attempt_id=? AND g.state='running' AND g.source_revision=? AND g.intent_hash=a.intent_hash AND g.intent_hash=? AND g.expires_ms>? AND g.contract_json=? AND c.owner_id=a.owner_id AND c.revoked_ms IS NULL AND c.issued_ms<=? AND c.expires_ms>? AND (a.state IN ('prepared','dispatching') OR (?=1 AND g.cleanup_allowed=1 AND a.state='recovery_required')) AND a.deadline_ms>?",
      )
      .bind(
        attemptId,
        p.SOURCE_REVISION,
        grant.intent_hash,
        current + 15000,
        grant.contract_json,
        current,
        current,
        cleanupMode ? 1 : 0,
        current + 15000,
      )
      .first();
    if (!valid) throw new ApiError(503, "native_write_grant_closed");
  };
  let count = 0,
    last = 0,
    cleanupCount = 0;
  const control = {
    ...options.control,
    reserve: async () => {
      const delay = Math.max(0, last + 300 - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (cleanupMode) await assertGranted();
      else assertWindow();
      if (
        (cleanupMode && cleanupCount >= 16) ||
        count >=
          grant.maximum_used - grant.starting_used + (cleanupMode ? 16 : 0) ||
        (!ongoing &&
          options.accounting().used >=
            grant.maximum_used + (cleanupMode ? 16 : 0))
      )
        throw new ApiError(503, "native_write_budget_exhausted");
      count++;
      if (cleanupMode) cleanupCount++;
      last = Date.now();
      return (
        cleanupMode ? options.recoveryControl : options.control
      ).reserve();
    },
  };
  const scope = {
    attemptId,
    companyLogin: company,
    timezone: "Asia/Singapore" as const,
    intent,
  };
  let lastOperation: Parameters<NativeExchange>[0]["kind"] | undefined;
  const structure = (value: unknown) =>
    value === undefined
      ? { kind: "missing" as const }
      : Array.isArray(value)
        ? { kind: "array" as const, count: value.length }
        : value === null
          ? { kind: "null" as const }
          : typeof value === "object"
            ? { kind: "object" as const, count: Object.keys(value).length }
            : { kind: "primitive" as const };
  let representation:
    | (ReturnType<typeof structure> & {
        bookings?: ReturnType<typeof structure>;
      })
    | undefined;
  const observeResponse = (
    kind: NonNullable<typeof lastOperation>,
    body?: unknown,
  ) => {
    lastOperation = kind;
    representation =
      body === undefined
        ? undefined
        : {
            ...structure(body),
            ...(kind === "book" || kind === "batch-close"
              ? {
                  bookings: structure(
                    body !== null &&
                      typeof body === "object" &&
                      !Array.isArray(body)
                      ? (body as Record<string, unknown>).bookings
                      : undefined,
                  ),
                }
              : {}),
          };
  };
  let diagnostic:
    | {
        stage:
          "identity" | "allowance" | "prebooking" | "execution" | "cleanup";
        sessionIndex?: number;
        code: string;
        validation?: ReturnType<typeof nativeValidationReason>;
        operation?: typeof lastOperation;
        representation?: typeof representation;
        providerUsed: number;
      }
    | undefined;
  let cleanupDiagnostic: typeof diagnostic;
  const retainFailure = (
    error: unknown,
    stage: NonNullable<typeof diagnostic>["stage"],
    sessionIndex?: number,
  ) => {
    // Only server-defined codes and structural counts belong in private evidence.
    // Never retain provider values, exception messages, contacts or credentials.
    const failure = {
      stage,
      sessionIndex,
      code: safeNativeFailure(error),
      validation: nativeValidationReason(error),
      operation: lastOperation,
      representation,
      providerUsed: options.accounting().used,
    };
    if (stage === "cleanup") cleanupDiagnostic ??= failure;
    else diagnostic ??= failure;
  };
  const exchange: NativeExchange = async (operation, signal) => {
    lastOperation = operation.kind;
    representation = undefined;
    if (cleanupMode) await assertGranted();
    else assertWindow();
    if (cleanupMode) await provider.identity(env, control);
    if (operation.kind === "booking-cancel" && !cleanupMode)
      throw new ApiError(503, "native_cleanup_not_granted");
    if (
      cleanupMode &&
      !["booking-read", "invoice-read", "booking-cancel"].includes(
        operation.kind,
      )
    )
      throw new ApiError(503, "native_cleanup_operation_unavailable");
    if (
      [
        "book",
        "booking-comment",
        "batch-create",
        "batch-close",
        "payment-link",
        "booking-cancel",
      ].includes(operation.kind)
    ) {
      const response = await provider.nativeWrite(env, control, operation, {
        beforeIdentity: async () =>
          cleanupMode ? assertGranted() : assertWindow(),
        beforeWrite: assertGranted,
      });
      if (options.holding)
        await retainHoldEvidence(
          env.STATE,
          attemptId,
          operation.kind,
          response.body,
          response.receivedAtMs,
        );
      observeResponse(operation.kind, response.body);
      return response;
    }
    signal?.throwIfAborted();
    await provider.identity(env, control);
    const response = await provider.nativeRead(env, control, operation, signal);
    if (options.holding)
      await retainHoldEvidence(
        env.STATE,
        attemptId,
        operation.kind,
        response.body,
        response.receivedAtMs,
      );
    observeResponse(operation.kind, response.body);
    return response;
  };
  let result: {
    state: string;
    paymentAvailable: boolean;
    rejectedSessionIndex?: number;
  } = {
    state: "recovery_required",
    paymentAvailable: false,
  };
  let dispatchFence: number | undefined;
  try {
    const prebooking = provider.prebooking(
      env,
      control,
      contract,
      observeResponse,
    );
    const validatedDates: Record<
      string,
      z.infer<typeof nativeAvailabilitySchema>
    > = {};
    const operations = nativeBookingOperations({
      scope,
      exchange,
      additional: { handle_invoice: true },
      db: env.STATE,
      hasRecoveryCapacity: async () =>
        (ongoing || grant.maximum_used <= p.PROVIDER_CALL_CEILING - 16) &&
        options.accounting().active === 0,
      prebooking: {
        invalidate: () => prebooking.invalidate(),
        revalidate: async (value, index) => {
          let stage: NonNullable<typeof diagnostic>["stage"] = "identity";
          lastOperation = undefined;
          representation = undefined;
          try {
            assertWindow();
            const identity = await provider.identity(env, control);
            stage = "allowance";
            const allowance = z
              .object({ remaining: z.number().int().nonnegative().safe() })
              .safeParse(identity.bookingAllowance);
            if (
              !allowance.success ||
              allowance.data.remaining < value.sessions.length - (index ?? 0)
            )
              throw new ApiError(503, "native_booking_allowance_unavailable");
            stage = "prebooking";
            return await prebooking.revalidate(
              value,
              index,
              options.combinedHold
                ? async (review) => {
                    const session = value.sessions[index ?? 0];
                    const date = new Date(session.startMs + 28800000)
                      .toISOString()
                      .slice(0, 10);
                    const day = (validatedDates[date] ??= {
                      date,
                      observedAtMs: Date.now(),
                      offers: [],
                    });
                    day.offers = day.offers.filter(
                      (offer) => offer.startMs !== session.startMs,
                    );
                    day.offers.push({
                      serviceId: session.serviceId,
                      productServiceId: contract.serviceId,
                      serviceName: review.serviceName,
                      instructorId: session.instructorId,
                      instructorName: review.instructorName,
                      startMs: session.startMs,
                      priceMinor: session.totalMinor,
                      currency: value.currency,
                    });
                    await env.STATE.prepare(
                      "UPDATE native_checkout_grants SET availability_json=? WHERE attempt_id=? AND state='running'",
                    )
                      .bind(JSON.stringify(validatedDates), attemptId)
                      .run();
                  }
                : undefined,
            );
          } catch (error) {
            retainFailure(error, stage, index);
            throw error;
          }
        },
      },
      batchSignature: (id, hash) => nativeBookingSignature(id, hash, secret),
      clientSignature: (id, hash) => nativeBookingSignature(id, hash, secret),
    });
    if (ongoing && options.combinedHold)
      operations.validationMode = "per-session";
    operations.onFailure = (error, index) =>
      retainFailure(error, "execution", index);
    result = await orchestrateBooking(request, env, attemptId, operations);
    if (result.state === "associated") {
      const associated = await env.STATE.withSession("first-primary")
        .prepare(
          "SELECT association_json,version FROM attempts WHERE id=? AND owner_id=? AND state='dispatching'",
        )
        .bind(attemptId, access.owner_id)
        .first<{ association_json: string; version: number }>();
      if (!associated) throw new ApiError(409, "native_association_missing");
      dispatchFence = associated.version;
      const refs = associationSchema.parse(
        JSON.parse(associated.association_json),
      );
      await provider.identity(env, control);
      let dueDatetime: unknown;
      let observation: Awaited<
        ReturnType<typeof readNativeAttempt>
      >["observation"];
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
        observation = observed.observation;
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
      const timing = {
        invoiceId: refs.invoiceId,
        dueDatetime,
        supervisionDeadlineMs: grant.expires_ms,
        handoffAtMs: Date.now(),
      };
      if (paymentRoute === "hitpay") {
        await retainHitpayHold(
          env,
          scope,
          associated.association_json,
          row.intent_hash,
          nativeCheckoutDeadline(timing, Date.now()),
        );
      } else await prepareNativeLink(env.STATE, scope, exchange, true, timing);
      await recordObservation(
        env.STATE,
        attemptId,
        associated.version,
        observation!,
        Date.now(),
      );
      result = {
        state: "associated",
        paymentAvailable: paymentRoute !== "hitpay",
      };
    }
  } catch (error) {
    retainFailure(error, "execution");
    // A lost reply may have created native state. Retain the original attempt;
    // this one-use grant never resumes writes or exposes raw provider errors.
    if (dispatchFence !== undefined)
      await requireRecovery(env.STATE, attemptId, dispatchFence);
    result = { state: "recovery_required", paymentAvailable: false };
  }
  if (
    result.state === "recovery_required" &&
    paymentRoute !== "hitpay" &&
    grant.cleanup_allowed === 1 &&
    options.accounting().active === 0
  ) {
    // This separate permission is absent by default. The recovery reserve may
    // only compensate known unpaid effects, never continue forward checkout.
    cleanupMode = true;
    const controller = new AbortController();
    cleanupSignal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      await compensateNativeAttempt({
        db: env.STATE,
        scope,
        exchange,
        signingSecret: secret,
        signal: controller.signal,
        assertGranted,
        invalidate: () =>
          provider.prebooking(env, control, contract).invalidate(),
      });
    } catch (error) {
      retainFailure(error, "cleanup");
      // Unknown cancellation/readback stays in the immutable effect journal.
      // Partial cleanup is never reported as successful booking or payment.
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  await env.STATE.prepare(
    "UPDATE native_checkout_grants SET state=?,result_json=json_patch(COALESCE(result_json,'{}'),?) WHERE attempt_id=? AND state='running'",
  )
    .bind(
      result.state === "associated" ? "complete" : "blocked",
      JSON.stringify({
        ...result,
        ...(diagnostic ? { diagnostic } : {}),
        ...(cleanupDiagnostic ? { cleanupDiagnostic } : {}),
      }),
      attemptId,
    )
    .run();
  await authenticate(request, env, Date.now());
  return { attemptId, ...result };
}

async function customerNativeWindow(
  request: Request,
  env: Env,
  attemptId?: string,
) {
  const p = policy(env),
    now = Date.now();
  const access = await authenticate(request, env, now);
  const grant = await env.STATE.withSession("first-primary")
    .prepare("SELECT * FROM native_checkout_grants WHERE capability_hash=?")
    .bind(access.capability_hash)
    .first<Grant>();
  if (!grant) throw new ApiError(503, "native_customer_window_unavailable");
  const ongoing = grant.ongoing === 1 && liveCustomerAccess(env);
  const failedChecks = Object.entries({
    state:
      grant.state === "granted" ||
      (attemptId !== undefined && grant.attempt_id === attemptId),
    mode: grant.ongoing !== 1 || ongoing,
    access: p.PROVIDER_ACCESS === "trusted-reads",
    source:
      grant.source_revision === p.SOURCE_REVISION &&
      /^[a-f0-9]{40}$/.test(grant.source_revision),
    ceiling: ongoing || grant.maximum_used <= p.PROVIDER_CALL_CEILING - 16,
    start: now >= grant.not_before_ms,
    remaining: now + 180000 < grant.expires_ms,
    duration: grant.expires_ms <= grant.not_before_ms + 1200000,
    end: ongoing || p.CAMPAIGN_END_MS >= grant.expires_ms,
  })
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedChecks.length) {
    // Preserve the first rejection privately without consuming/reopening the
    // grant or changing the customer error. No raw values or contacts persist.
    await env.STATE.prepare(
      "UPDATE native_checkout_grants SET result_json=? WHERE capability_hash=? AND state='granted' AND result_json IS NULL",
    )
      .bind(
        JSON.stringify({
          diagnostic: { stage: "customer_window", failedChecks },
        }),
        access.capability_hash,
      )
      .run();
    throw new ApiError(503, "native_customer_window_unavailable");
  }
  const contract = nativeAccountContractSchema.parse(
    JSON.parse(grant.contract_json),
  );
  if (
    contract.accountId !== p.DEPLOYMENT_ACCOUNT_ID ||
    contract.environmentId !== p.ENVIRONMENT ||
    contract.companyLogin !== providerSecrets(env).company ||
    contract.confirmedAtMs > now ||
    contract.expiresAtMs < grant.expires_ms
  )
    throw new ApiError(503, "native_account_contract_unavailable");
  const dates = z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .max(124)
    .parse(JSON.parse(grant.available_dates_json));
  if (
    contract.trialLeadTimeException &&
    (contract.serviceId !== "2" ||
      dates.length !== 2 ||
      [...dates].sort().join(",") !== "2026-10-14,2026-10-15" ||
      contract.expiresAtMs > Date.parse("2026-10-14T00:00:00+08:00"))
  )
    throw new ApiError(503, "native_trial_exception_scope");
  const binding = {
    accountId: p.DEPLOYMENT_ACCOUNT_ID,
    environmentId: p.ENVIRONMENT,
    companyLogin: contract.companyLogin,
  };
  return { p, access, grant, contract, dates, binding };
}
export async function prepareCustomerNative(
  request: Request,
  env: Env,
  value: unknown,
  attemptId?: string,
) {
  const { p, access, grant, contract, dates, binding } =
    await customerNativeWindow(request, env, attemptId);
  const input = nativePrepareSchema.parse(value);
  if (
    input.holding &&
    hitpaySetting(env, "CHECKOUT_PAYMENT_ROUTE") !== "hitpay"
  )
    throw new ApiError(503, "hitpay_checkout_disabled");
  const now = Date.now();
  if (grant.read_state !== "available")
    throw new ApiError(503, "native_availability_unavailable");
  if (
    input.sessions.length >
      (grant.ongoing === 1 && liveCustomerAccess(env) ? 12 : 2) ||
    (contract.trialLeadTimeException &&
      (input.sessions.length !== 2 ||
        input.sessions.some((session) => session.instructorId !== "3") ||
        input.sessions
          .map((session) =>
            new Date(session.startMs + 8 * 3600000).toISOString().slice(0, 10),
          )
          .sort()
          .join(",") !== "2026-10-14,2026-10-15")) ||
    input.sessions.some(
      (session) =>
        session.serviceId !==
          nativeContractSelection(contract, session.startMs).serviceId ||
        !nativeCustomerHours(contract, session.startMs) ||
        session.startMs - now <
          nativeTrialLeadMs(contract, binding, session, now) ||
        !dates.includes(
          new Date(session.startMs + 8 * 3600000).toISOString().slice(0, 10),
        ),
    )
  )
    throw new ApiError(409, "native_selection_changed");
  if (
    input.sessions.some(
      (session) =>
        session.totalMinor !==
        nativeContractSelection(contract, session.startMs).priceMinor,
    )
  )
    throw new ApiError(409, "native_restart_required");
  const offers = Object.values(
    z
      .record(z.string(), nativeAvailabilitySchema)
      .parse(JSON.parse(grant.availability_json || "{}")),
  ).flatMap((entry) => entry.offers);
  if (
    attemptId === undefined &&
    input.sessions.some(
      (session) =>
        !offers.some(
          (offer) =>
            offer.serviceId === session.serviceId &&
            offer.instructorId === session.instructorId &&
            offer.startMs === session.startMs &&
            offer.priceMinor === session.totalMinor,
        ),
    )
  )
    throw new ApiError(409, "native_selection_changed");
  const intent = intentSchema.parse({
    accountId: p.DEPLOYMENT_ACCOUNT_ID,
    environmentId: p.ENVIRONMENT,
    customerId: access.owner_id,
    customerMode: "booking-contact",
    contact: input.contact,
    currency: "SGD",
    taxMinor: 0,
    totalMinor: input.sessions.reduce(
      (total, session) => total + session.totalMinor,
      0,
    ),
    sessions: input.sessions.map((session) => ({ ...session, taxMinor: 0 })),
  });
  const hash = await digest(JSON.stringify(intent));
  if (grant.attempt_id) {
    if (
      grant.intent_hash !== hash ||
      (attemptId !== undefined && grant.attempt_id !== attemptId)
    )
      throw new ApiError(409, "native_attempt_already_bound");
    return { attemptId: grant.attempt_id, state: "prepared" as const };
  }
  const attempt = await prepareAttempt(
    env.STATE,
    access.owner_id,
    input.key,
    intent,
    now,
    grant.expires_ms - now,
    attemptId,
  );
  const bound = await env.STATE.prepare(
    "UPDATE native_checkout_grants SET attempt_id=?,intent_hash=? WHERE capability_hash=? AND state='granted' AND source_revision=? AND expires_ms>? AND ((attempt_id IS NULL AND intent_hash IS NULL) OR (attempt_id=? AND intent_hash=?))",
  )
    .bind(
      attempt.id,
      hash,
      access.capability_hash,
      p.SOURCE_REVISION,
      Date.now() + 180000,
      attempt.id,
      hash,
    )
    .run();
  if (bound.meta.changes !== 1)
    throw new ApiError(409, "native_attempt_already_bound");
  await authenticate(request, env, Date.now());
  return { attemptId: attempt.id, state: "prepared" as const };
}
export async function customerNativeAvailability(options: {
  request: Request;
  env: Env;
  date: string;
  serviceId: string;
  fresh?: boolean;
  invalidate?: () => void;
  provider: ProviderSession;
  control: ProviderControl;
  accounting: () => { used: number; active: number };
}) {
  const { request, env, provider, date, serviceId } = options;
  const { grant, access, contract, dates, binding } =
    await customerNativeWindow(request, env);
  if (
    !dates.includes(date) ||
    serviceId !== contract.serviceId ||
    grant.attempt_id
  )
    throw new ApiError(503, "native_availability_unavailable");
  const cache = z
    .record(z.string(), nativeAvailabilitySchema)
    .parse(JSON.parse(grant.availability_json || "{}"));
  const retained = cache[date];
  if (
    !options.fresh &&
    retained &&
    retained.observedAtMs <= Date.now() &&
    Date.now() - retained.observedAtMs < 60000
  )
    return retained;
  options.invalidate?.();
  const claimed = await env.STATE.prepare(
    "UPDATE native_checkout_grants SET read_state='reading' WHERE capability_hash=? AND state='granted' AND read_state='available' AND attempt_id IS NULL AND expires_ms>?",
  )
    .bind(access.capability_hash, Date.now() + 180000)
    .run();
  if (claimed.meta.changes !== 1)
    throw new ApiError(503, "native_availability_busy");
  let last = 0;
  const control = {
    ...options.control,
    reserve: async () => {
      const delay = Math.max(0, last + 300 - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const current = await customerNativeWindow(request, env);
      const usage = options.accounting();
      if (
        current.grant.read_state !== "reading" ||
        current.grant.attempt_id ||
        usage.used < grant.starting_used ||
        usage.used >= grant.maximum_used - 32
      )
        throw new ApiError(503, "native_availability_budget_exhausted");
      last = Date.now();
      return options.control.reserve();
    },
  };
  try {
    await provider.identity(env, control);
    const catalogue = await provider.catalogue(env, control);
    const service = catalogue.services.find(
      (item) => item.id === serviceId && item.active,
    );
    if (
      !service ||
      service.recurring ||
      service.durationMinutes !== 40 ||
      service.currency !== "SGD"
    )
      throw new ApiError(503, "native_service_unavailable");
    const instructors = catalogue.instructors.filter(
      (person) =>
        person.active &&
        (service.instructorIds === null ||
          service.instructorIds.includes(person.id)),
    );
    if (!instructors.length || instructors.length > 3)
      throw new ApiError(503, "native_instructors_unavailable");
    const offers: z.infer<typeof nativeOfferSchema>[] = [];
    let observedAtMs = catalogue.observedAtMs;
    for (const instructor of instructors) {
      await provider.identity(env, control);
      const response = await provider.nativeRead(env, control, {
        kind: "availability",
        serviceId,
        instructorId: instructor.id,
        date,
      });
      observedAtMs = Math.min(observedAtMs, response.receivedAtMs);
      for (const time of offeredStarts(response.body, date)) {
        const startMs = Date.parse(`${date}T${time}+08:00`);
        const now = Date.now();
        if (
          !nativeCustomerHours(contract, startMs) ||
          startMs - now <
            nativeTrialLeadMs(
              contract,
              binding,
              { serviceId, instructorId: instructor.id, startMs },
              now,
            )
        )
          continue;
        // Unexpected simultaneous eligibility is configuration drift. Never pick
        // a provider by order or silently hide a competing studio allocation.
        if (
          offers.some(
            (offer) =>
              Math.abs(offer.startMs - startMs) < 3000000 &&
              offer.instructorId !== instructor.id,
          )
        )
          throw new ApiError(503, "native_provider_schedule_overlap");
        offers.push({
          serviceId,
          serviceName: service.name,
          instructorId: instructor.id,
          instructorName: instructor.name,
          startMs,
          priceMinor: service.priceMinor,
          currency: "SGD",
        });
      }
    }
    freshReceipt(observedAtMs, Date.now());
    const result = nativeAvailabilitySchema.parse({
      date,
      observedAtMs,
      offers: offers.sort((a, b) => a.startMs - b.startMs),
    });
    cache[date] = result;
    const saved = await env.STATE.prepare(
      "UPDATE native_checkout_grants SET read_state='available',availability_json=? WHERE capability_hash=? AND state='granted' AND read_state='reading' AND attempt_id IS NULL AND expires_ms>?",
    )
      .bind(JSON.stringify(cache), access.capability_hash, Date.now() + 180000)
      .run();
    if (saved.meta.changes !== 1)
      throw new ApiError(503, "native_availability_expired");
    await authenticate(request, env, Date.now());
    return result;
  } catch (error) {
    await env.STATE.prepare(
      "UPDATE native_checkout_grants SET read_state='blocked' WHERE capability_hash=? AND read_state='reading'",
    )
      .bind(access.capability_hash)
      .run();
    throw error;
  }
}

export async function currentCustomerNative(request: Request, env: Env) {
  const access = await authenticate(request, env, Date.now());
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT a.id,a.intent_json,a.state,g.state AS grant_state,g.result_json,g.availability_json FROM native_checkout_grants g JOIN attempts a ON a.id=g.attempt_id WHERE g.capability_hash=? AND a.owner_id=?",
    )
    .bind(access.capability_hash, access.owner_id)
    .first<{
      id: string;
      intent_json: string;
      state: string;
      grant_state: string;
      result_json: string | null;
      availability_json: string | null;
    }>();
  if (!row) return { state: "empty" as const };
  if (
    row.state === "prepared" &&
    row.grant_state === "blocked" &&
    ["selection_unavailable", "restart_required"].includes(
      JSON.parse(row.result_json || "{}").state,
    )
  )
    return { state: "empty" as const };
  const intent = intentSchema.parse(JSON.parse(row.intent_json));
  const cache = z
    .record(z.string(), nativeAvailabilitySchema)
    .parse(JSON.parse(row.availability_json || "{}"));
  const held = await env.STATE.prepare(
    "SELECT 1 FROM hitpay_holds h WHERE h.attempt_id=? AND NOT EXISTS(SELECT 1 FROM hitpay_payments p WHERE p.attempt_id=h.attempt_id)",
  )
    .bind(row.id)
    .first();
  const offers = Object.values(cache).flatMap((entry) => entry.offers);
  const sessions = intent.sessions.map((session) => {
    const offer = offers.find(
      (item) =>
        item.serviceId === session.serviceId &&
        item.instructorId === session.instructorId &&
        item.startMs === session.startMs &&
        item.priceMinor === session.totalMinor,
    );
    if (!offer && !held && row.state === "recovery_required") {
      // A later batch item may fail before its display snapshot is retained.
      // Restore the immutable request for recovery, never as an available offer
      // or a payable hold. Labels are deliberately not provider assertions.
      return {
        serviceId: session.serviceId,
        productServiceId: session.serviceId,
        serviceName: "Requested session",
        instructorId: session.instructorId,
        instructorName: "Requested instructor",
        startMs: session.startMs,
        priceMinor: session.totalMinor,
        currency: intent.currency,
        players: session.players,
      };
    }
    if (!offer) throw new ApiError(503, "native_snapshot_unavailable");
    return { ...offer, players: session.players };
  });
  return nativeCurrentSchema.parse({
    attemptId: row.id,
    contact: intent.contact,
    sessions,
    state: held
      ? "held"
      : row.state === "prepared" && row.grant_state === "granted"
        ? "prepared"
        : "checking",
  });
}

export async function customerNativeCalendar(options: {
  request: Request;
  env: Env;
  month: string;
  serviceId: string;
  provider: ProviderSession;
  control: ProviderControl;
  accounting: () => { used: number; active: number };
  cache: NativeCalendarReads;
}) {
  const { request, env, month, serviceId, provider } = options;
  const { p, grant, access, contract, dates, binding } =
    await customerNativeWindow(request, env);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const monthStart = new Date(today.slice(0, 7) + "-01T00:00:00Z");
  monthStart.setUTCMonth(monthStart.getUTCMonth() + 3);
  if (
    month < today.slice(0, 7) ||
    month > monthStart.toISOString().slice(0, 7) ||
    serviceId !== contract.serviceId ||
    grant.attempt_id
  )
    throw new ApiError(503, "native_calendar_unavailable");
  const approved = calendarDates(month, dates).filter((date) => date >= today);
  if (!approved.length) return { month, observedAtMs: Date.now(), dates: [] };
  const claimed = await env.STATE.prepare(
    "UPDATE native_checkout_grants SET read_state='reading' WHERE capability_hash=? AND state='granted' AND read_state='available' AND attempt_id IS NULL AND expires_ms>?",
  )
    .bind(access.capability_hash, Date.now() + 180000)
    .run();
  if (claimed.meta.changes !== 1)
    throw new ApiError(503, "native_availability_busy");
  let last = 0;
  const control = {
    ...options.control,
    reserve: async () => {
      const wait = Math.max(0, last + 300 - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      const current = await customerNativeWindow(request, env);
      const usage = options.accounting();
      if (
        current.grant.read_state !== "reading" ||
        current.grant.attempt_id ||
        usage.used < grant.starting_used ||
        usage.used >= grant.maximum_used - 32
      )
        throw new ApiError(503, "native_availability_budget_exhausted");
      last = Date.now();
      return options.control.reserve();
    },
  };
  try {
    const raw = await options.cache.read({
      scope: JSON.stringify([binding, p.SOURCE_REVISION]),
      month,
      serviceId,
      dates: approved,
      catalogue: async () => {
        await provider.identity(env, control);
        return provider.catalogue(env, control);
      },
      exchange: async (native) => {
        await provider.identity(env, control);
        return provider.nativeRead(env, control, native);
      },
    });
    const now = Date.now();
    const result = {
      ...raw,
      dates: raw.dates.map((day) => ({
        ...day,
        offers: day.offers.filter(
          (offer) =>
            nativeCustomerHours(contract, offer.startMs) &&
            offer.startMs - now >=
              nativeTrialLeadMs(contract, binding, offer, now),
        ),
      })),
    };
    const retained = z
      .record(z.string(), nativeAvailabilitySchema)
      .parse(JSON.parse(grant.availability_json || "{}"));
    for (const day of result.dates) retained[day.date] = day;
    const saved = await env.STATE.prepare(
      "UPDATE native_checkout_grants SET read_state='available',availability_json=? WHERE capability_hash=? AND state='granted' AND read_state='reading' AND attempt_id IS NULL AND expires_ms>?",
    )
      .bind(
        JSON.stringify(retained),
        access.capability_hash,
        Date.now() + 180000,
      )
      .run();
    if (saved.meta.changes !== 1)
      throw new ApiError(503, "native_availability_expired");
    await authenticate(request, env, Date.now());
    return result;
  } catch (error) {
    await env.STATE.prepare(
      "UPDATE native_checkout_grants SET read_state='blocked' WHERE capability_hash=? AND read_state='reading'",
    )
      .bind(access.capability_hash)
      .run();
    throw error;
  }
}
