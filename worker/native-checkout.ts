import { z } from "zod";
import { authenticate } from "./access";
import { ApiError, digest, policy } from "./policy";
import {
  intentSchema,
  associationSchema,
  prepareAttempt,
  recordObservation,
  requireRecovery,
} from "./journal";
import { nativeAccountContractSchema, offeredStarts } from "./prebooking";
import {
  nativeAvailabilitySchema,
  nativePrepareSchema,
  nativeCurrentSchema,
  type nativeOfferSchema,
} from "../src/domain/native-checkout";
import { NATIVE_TRIAL_LEAD_MS } from "../src/domain/booking-policy";
import { freshReceipt } from "./catalogue";
import { orchestrateBooking } from "./orchestration";
import {
  nativeBookingOperations,
  nativeBookingSignature,
  prepareNativeLink,
  readNativeAttempt,
  storedNativeSignature,
  compensateNativeAttempt,
} from "./native-adapter";
import { ProviderSession, type ProviderControl } from "./provider-session";
import { providerSecrets, type NativeExchange } from "./provider-transport";

// One reviewed developer attempt, not an open customer write API. Grants are
// installed externally from the exact approved packet; this code never grants.
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
    initial.used < grant.starting_used ||
    initial.used + 20 > grant.maximum_used ||
    initial.active !== 0 ||
    grant.maximum_used > p.PROVIDER_CALL_CEILING - 16 ||
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
  let cleanupMode = false;
  let cleanupSignal: AbortSignal | undefined;
  const assertGranted = async () => {
    cleanupSignal?.throwIfAborted();
    const current = Date.now();
    if (current + 15000 >= Math.min(grant.expires_ms, p.CAMPAIGN_END_MS))
      throw new ApiError(503, "native_write_window_closed");
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
      await assertGranted();
      if (
        (cleanupMode && cleanupCount >= 16) ||
        count >=
          grant.maximum_used - grant.starting_used + (cleanupMode ? 16 : 0) ||
        options.accounting().used >= grant.maximum_used + (cleanupMode ? 16 : 0)
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
  let representation:
    | { kind: "array" | "object" | "primitive" | "null"; count?: number }
    | undefined;
  const observeRead = (
    kind: NonNullable<typeof lastOperation>,
    body?: unknown,
  ) => {
    lastOperation = kind;
    representation =
      body === undefined
        ? undefined
        : Array.isArray(body)
          ? { kind: "array", count: body.length }
          : body === null
            ? { kind: "null" }
            : typeof body === "object"
              ? { kind: "object", count: Object.keys(body).length }
              : { kind: "primitive" };
  };
  let diagnostic:
    | {
        stage: "identity" | "allowance" | "prebooking" | "execution";
        sessionIndex?: number;
        code: string;
        operation?: typeof lastOperation;
        representation?: typeof representation;
        providerUsed: number;
      }
    | undefined;
  const retainFailure = (
    error: unknown,
    stage: NonNullable<typeof diagnostic>["stage"],
    sessionIndex?: number,
  ) => {
    // Only server-defined codes and structural counts belong in private evidence.
    // Never retain provider values, exception messages, contacts or credentials.
    diagnostic ??= {
      stage,
      sessionIndex,
      code:
        error instanceof ApiError && /^[a-z][a-z0-9_]{0,100}$/.test(error.code)
          ? error.code
          : "internal_error",
      operation: lastOperation,
      representation,
      providerUsed: options.accounting().used,
    };
  };
  const exchange: NativeExchange = async (operation, signal) => {
    lastOperation = operation.kind;
    representation = undefined;
    await assertGranted();
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
        "batch-create",
        "batch-close",
        "payment-link",
        "booking-cancel",
      ].includes(operation.kind)
    )
      return provider.nativeWrite(env, control, operation, assertGranted);
    signal?.throwIfAborted();
    await provider.identity(env, control);
    const response = await provider.nativeRead(env, control, operation, signal);
    observeRead(operation.kind, response.body);
    return response;
  };
  let result: { state: string; paymentAvailable: boolean } = {
    state: "recovery_required",
    paymentAvailable: false,
  };
  let dispatchFence: number | undefined;
  try {
    const prebooking = provider.prebooking(env, control, contract, observeRead);
    const operations = nativeBookingOperations({
      scope,
      exchange,
      additional: { handle_invoice: true },
      db: env.STATE,
      hasRecoveryCapacity: async () =>
        grant.maximum_used <= p.PROVIDER_CALL_CEILING - 16 &&
        options.accounting().active === 0,
      prebooking: {
        invalidate: () => prebooking.invalidate(),
        revalidate: async (value, index) => {
          let stage: NonNullable<typeof diagnostic>["stage"] = "identity";
          lastOperation = undefined;
          representation = undefined;
          try {
            await assertGranted();
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
            return await prebooking.revalidate(value, index);
          } catch (error) {
            retainFailure(error, stage, index);
            throw error;
          }
        },
      },
      batchSignature: (id, hash) => nativeBookingSignature(id, hash, secret),
      clientSignature: (id, hash) => nativeBookingSignature(id, hash, secret),
    });
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
      await prepareNativeLink(env.STATE, scope, exchange, true, {
        invoiceId: refs.invoiceId,
        dueDatetime,
        supervisionDeadlineMs: grant.expires_ms,
        handoffAtMs: Date.now(),
      });
      await recordObservation(
        env.STATE,
        attemptId,
        associated.version,
        observation!,
        Date.now(),
      );
      result = { state: "associated", paymentAvailable: true };
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
    } catch {
      // Unknown cancellation/readback stays in the immutable effect journal.
      // Partial cleanup is never reported as successful booking or payment.
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  await env.STATE.prepare(
    "UPDATE native_checkout_grants SET state=?,result_json=? WHERE attempt_id=? AND state='running'",
  )
    .bind(
      result.state === "associated" ? "complete" : "blocked",
      JSON.stringify(diagnostic ? { ...result, diagnostic } : result),
      attemptId,
    )
    .run();
  await authenticate(request, env, Date.now());
  return { attemptId, ...result };
}

async function customerNativeWindow(request: Request, env: Env) {
  const p = policy(env),
    now = Date.now();
  const access = await authenticate(request, env, now);
  const grant = await env.STATE.withSession("first-primary")
    .prepare("SELECT * FROM native_checkout_grants WHERE capability_hash=?")
    .bind(access.capability_hash)
    .first<Grant>();
  if (!grant) throw new ApiError(503, "native_customer_window_unavailable");
  const failedChecks = Object.entries({
    state: grant.state === "granted",
    access: p.PROVIDER_ACCESS === "trusted-reads",
    source:
      grant.source_revision === p.SOURCE_REVISION &&
      /^[a-f0-9]{40}$/.test(grant.source_revision),
    ceiling: grant.maximum_used <= p.PROVIDER_CALL_CEILING - 16,
    start: now >= grant.not_before_ms,
    remaining: now + 180000 < grant.expires_ms,
    duration: grant.expires_ms <= grant.not_before_ms + 1200000,
    end: p.CAMPAIGN_END_MS >= grant.expires_ms,
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
    .max(2)
    .parse(JSON.parse(grant.available_dates_json));
  return { p, access, grant, contract, dates };
}
export async function prepareCustomerNative(
  request: Request,
  env: Env,
  value: unknown,
) {
  const { p, access, grant, contract, dates } = await customerNativeWindow(
    request,
    env,
  );
  const input = nativePrepareSchema.parse(value),
    now = Date.now();
  if (grant.read_state !== "available")
    throw new ApiError(503, "native_availability_unavailable");
  if (
    input.sessions.length > 2 ||
    input.sessions.some(
      (session) =>
        session.serviceId !== contract.serviceId ||
        session.startMs - now < NATIVE_TRIAL_LEAD_MS ||
        !dates.includes(
          new Date(session.startMs + 8 * 3600000).toISOString().slice(0, 10),
        ),
    )
  )
    throw new ApiError(409, "native_selection_changed");
  if (
    input.sessions.some((session) => session.totalMinor !== contract.priceMinor)
  )
    throw new ApiError(409, "native_restart_required");
  const offers = Object.values(
    z
      .record(z.string(), nativeAvailabilitySchema)
      .parse(JSON.parse(grant.availability_json || "{}")),
  ).flatMap((entry) => entry.offers);
  if (
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
    if (grant.intent_hash !== hash)
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
  provider: ProviderSession;
  control: ProviderControl;
  accounting: () => { used: number; active: number };
}) {
  const { request, env, provider, date, serviceId } = options;
  const { grant, access, contract, dates } = await customerNativeWindow(
    request,
    env,
  );
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
    retained &&
    retained.observedAtMs <= Date.now() &&
    Date.now() - retained.observedAtMs < 60000
  )
    return retained;
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
        if (startMs - Date.now() < NATIVE_TRIAL_LEAD_MS) continue;
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
      "SELECT a.id,a.intent_json,a.state,g.state AS grant_state,g.availability_json FROM native_checkout_grants g JOIN attempts a ON a.id=g.attempt_id WHERE g.capability_hash=? AND a.owner_id=?",
    )
    .bind(access.capability_hash, access.owner_id)
    .first<{
      id: string;
      intent_json: string;
      state: string;
      grant_state: string;
      availability_json: string | null;
    }>();
  if (!row) return { state: "empty" as const };
  const intent = intentSchema.parse(JSON.parse(row.intent_json));
  const cache = z
    .record(z.string(), nativeAvailabilitySchema)
    .parse(JSON.parse(row.availability_json || "{}"));
  const offers = Object.values(cache).flatMap((entry) => entry.offers);
  const sessions = intent.sessions.map((session) => {
    const offer = offers.find(
      (item) =>
        item.serviceId === session.serviceId &&
        item.instructorId === session.instructorId &&
        item.startMs === session.startMs &&
        item.priceMinor === session.totalMinor,
    );
    if (!offer) throw new ApiError(503, "native_snapshot_unavailable");
    return { ...offer, players: session.players };
  });
  return nativeCurrentSchema.parse({
    attemptId: row.id,
    contact: intent.contact,
    sessions,
    state:
      row.state === "prepared" && row.grant_state === "granted"
        ? "prepared"
        : "checking",
  });
}
