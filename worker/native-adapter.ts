import type { NativePrebooking } from "./prebooking";
import { isNativeCheckoutUrl } from "../src/domain/native-checkout";
import { z } from "zod";
import { ApiError, digest } from "./policy";
import { intentSchema, associationSchema } from "./journal";
import {
  normalizeNativeCreation,
  normalizeNativeSession,
  normalizeNativeReads,
  providerId,
  bookingWallTime,
  nativeRecord,
  nativeSingle,
  nativeHash,
  rejectNative,
} from "./provider-normalization";
import type { BookingOperations } from "./orchestration";
import { nativeBookFields, type NativeExchange } from "./provider-transport";

// A trusted server composition supplies authenticated, admitted dispatch and
// pre-write validation. No HTTP route accepts this contract from a customer.
export type { NativeExchange } from "./provider-transport";
export type NativeScope = {
  attemptId: string;
  companyLogin: string;
  timezone: "Asia/Singapore";
  intent: z.infer<typeof intentSchema>;
};
const retainedNativeKeySchema = z.strictObject({
  bookingId: z.string(),
  hash: z.string(),
  nativeCustomerId: z.string().optional(),
});
// Empty policy rejects navigation; production uses only the supplied fixed shape.
export function nativeCheckoutLink(raw: unknown, configured = true) {
  const parsed = z.object({ link: z.string().min(1).max(4096) }).safeParse(raw);
  if (!configured || !parsed.success || !isNativeCheckoutUrl(parsed.data.link))
    throw new ApiError(503, "native_checkout_unavailable");
  return parsed.data.link;
}
function validateScope(scope: NativeScope) {
  z.string().uuid().parse(scope.attemptId);
  const intent = intentSchema.parse(scope.intent);
  if (
    scope.timezone !== "Asia/Singapore" ||
    !scope.companyLogin ||
    scope.companyLogin.includes("[") ||
    scope.companyLogin.toLowerCase() === "soccerbotstudio"
  )
    throw new ApiError(503, "native_scope_unavailable");
  return intent;
}
// Implements the existing composition contract: book returns a single invoice;
// multiple sessions use one signed native batch closure. Neither path creates
// an independent payment or retries a dispatched booking/finalization.
export function nativeBookingOperations(options: {
  scope: NativeScope;
  exchange: NativeExchange;
  additional: unknown;
  // Required fields, eligibility/shared availability, current price/tax and
  // customer association remain trusted pre-write checks, not response guesses.
  prebooking: Pick<NativePrebooking, "revalidate" | "invalidate">;
  hasRecoveryCapacity: BookingOperations["hasRecoveryCapacity"];
  db: D1Database;
  clientSignature?: (clientId: string, hash: string) => Promise<string>;
  batchSignature?: (batchId: string, hash: string) => Promise<string>;
}): BookingOperations {
  const intent = validateScope(options.scope);
  if (!intent.contact)
    throw new ApiError(503, "native_contact_snapshot_unavailable");
  const { name, email, phone } = intent.contact;
  const fields = nativeBookFields({ name, email, phone }, options.additional);
  let created: ReturnType<typeof normalizeNativeCreation> | undefined;
  const dispatched = new Set<number>();
  const bookingIds: string[] = [];
  let batchId: string | undefined;
  let batchHash: string | undefined;
  let nativeCustomerId: string | undefined;
  let clientHash: string | undefined;
  if (intent.sessions.length > 1 && !options.batchSignature)
    throw new ApiError(503, "native_batch_signing_unavailable");
  const matches = async (value: unknown, attemptId: string) => {
    if (
      attemptId !== options.scope.attemptId ||
      (await digest(JSON.stringify(intentSchema.parse(value)))) !==
        (await digest(JSON.stringify(intent)))
    )
      throw new ApiError(409, "native_intent_mismatch");
  };
  return {
    supported: true,
    hasRecoveryCapacity: options.hasRecoveryCapacity,
    async revalidate(value, context) {
      await matches(value, context.attemptId);
      return options.prebooking.revalidate(value, context.sessionIndex);
    },
    async createSession(session, value, context) {
      await matches(value, context.attemptId);
      if (
        JSON.stringify(session) !==
        JSON.stringify(intent.sessions[context.sessionIndex])
      )
        throw new ApiError(409, "native_intent_mismatch");
      if (
        dispatched.has(context.sessionIndex) ||
        context.sessionIndex !== bookingIds.length
      )
        throw new ApiError(409, "native_write_not_replayable");
      dispatched.add(context.sessionIndex);
      if (intent.sessions.length > 1 && context.sessionIndex === 0) {
        const reserved = await options.db
          .prepare(
            "INSERT INTO session_effects(attempt_id,step,outcome) SELECT id,'native-batch','unknown' FROM attempts WHERE id=? AND state='dispatching' AND association_json IS NULL AND deadline_ms>?",
          )
          .bind(options.scope.attemptId, Date.now())
          .run();
        if (reserved.meta.changes !== 1)
          throw new ApiError(409, "native_batch_not_claimed");
        await context.assertCurrent();
        const batch = await options.exchange({ kind: "batch-create" });
        batchId = providerId(batch.body, "batch.id");
        await options.db
          .prepare(
            "UPDATE session_effects SET outcome='observed',reference_id=? WHERE attempt_id=? AND step='native-batch' AND outcome='unknown'",
          )
          .bind(batchId, options.scope.attemptId)
          .run();
      }
      const client = { ...fields.client };
      if (
        intent.customerMode === "booking-contact" &&
        context.sessionIndex > 0
      ) {
        if (!nativeCustomerId || !clientHash || !options.clientSignature)
          throw new ApiError(503, "native_client_signing_unavailable");
        client.client_id = nativeCustomerId;
        client.client_sign = await options.clientSignature(
          nativeCustomerId,
          clientHash,
        );
      }
      await context.assertCurrent();
      const wall = new Date(session.startMs + 8 * 3600000).toISOString();
      options.prebooking.invalidate();
      const response = await options
        .exchange({
          kind: "book",
          serviceId: session.serviceId,
          instructorId: session.instructorId,
          date: wall.slice(0, 10),
          time: wall.slice(11, 19),
          client,
          additional: fields.additional,
          ...(batchId ? { batchId } : {}),
        })
        .finally(() => options.prebooking.invalidate());
      // Retain the returned reference before validating its business fields.
      // This is a recovery candidate, never an accepted association. A missing
      // key still leaves the known ID in the journal without authorizing reads.
      const receipt = nativeSingle(
        nativeRecord(response.body, "creation").bookings,
        "creation.bookings",
      );
      const receiptHash = z
        .string()
        .regex(/^[A-Za-z0-9_-]{8,256}$/)
        .safeParse(receipt.hash);
      let receiptCustomerId: string | undefined;
      try {
        receiptCustomerId = providerId(
          receipt.client_id,
          "creation.booking.client_id",
        );
      } catch {
        /* Missing client evidence is not invented. */
      }
      await retainNativeBookingKey(
        options.db,
        options.scope.attemptId,
        providerId(receipt.id, "creation.booking.id"),
        receiptHash.success ? receiptHash.data : undefined,
        context.sessionIndex,
        intent.sessions.length,
        receiptCustomerId,
      );
      const key = normalizeNativeSession(
        response.body,
        { ...options.scope, nativeCustomerId },
        context.sessionIndex,
        batchId ? "batch-item" : "finalized",
      );
      nativeCustomerId = key.nativeCustomerId;
      if (
        intent.customerMode === "booking-contact" &&
        intent.sessions.length > 1 &&
        context.sessionIndex === 0
      ) {
        clientHash = nativeHash(
          receipt.client_hash,
          "creation.booking.client_hash",
        );
      }
      if (bookingIds.includes(key.bookingId))
        throw new ApiError(409, "native_duplicate_booking");
      bookingIds.push(key.bookingId);
      if (batchId) {
        const batch = nativeRecord(response.body, "creation");
        const returnedId = providerId(batch.batch_id, "creation.batch_id");
        const returnedHash = nativeHash(
          batch.batch_hash,
          "creation.batch_hash",
        );
        if (returnedId !== batchId)
          rejectNative(
            "creation.batch_id",
            "mismatch",
            409,
            "native_batch_mismatch",
          );
        if (batchHash !== undefined && batchHash !== returnedHash)
          rejectNative(
            "creation.batch_hash",
            "mismatch",
            409,
            "native_batch_mismatch",
          );
        batchHash = returnedHash;
      } else {
        created = normalizeNativeCreation(response.body, {
          ...options.scope,
          bookingObservedAtMs: response.receivedAtMs,
          invoiceObservedAtMs: response.receivedAtMs,
        });
      }
      return {
        bookingId: key.bookingId,
        accountId: intent.accountId,
        customerId: intent.customerId,
        ...(intent.customerMode === "booking-contact"
          ? { nativeCustomerId }
          : {}),
        ...session,
        currency: intent.currency,
        confirmed: true,
      };
    },
    async finalize(ids, value, attemptId, assertCurrent) {
      await matches(value, attemptId);
      if (
        ids.length !== intent.sessions.length ||
        JSON.stringify(ids) !== JSON.stringify(bookingIds)
      )
        throw new ApiError(409, "native_association_missing");
      if (batchId) {
        if (!batchHash || !options.batchSignature)
          throw new ApiError(503, "native_batch_signing_unavailable");
        const signature = await options.batchSignature(batchId, batchHash);
        await assertCurrent();
        const response = await options.exchange({
          kind: "batch-close",
          batchId,
          signature,
        });
        created = normalizeNativeCreation(response.body, {
          ...options.scope,
          bookingObservedAtMs: response.receivedAtMs,
          invoiceObservedAtMs: response.receivedAtMs,
        });
      }
      if (
        !created ||
        JSON.stringify(ids) !== JSON.stringify(created.association.bookingIds)
      )
        throw new ApiError(409, "native_association_missing");
      return {
        invoiceId: created.association.invoiceId,
        bookingIds: ids,
        accountId: intent.accountId,
        customerId: intent.customerId,
        ...(intent.customerMode === "booking-contact"
          ? { nativeCustomerId: created.association.nativeCustomerId }
          : {}),
        currency: intent.currency,
        totalMinor: intent.totalMinor,
        taxMinor: intent.taxMinor,
      };
    },
  };
}
// One read per known booking and one invoice read. Receipt times are captured by the
// authenticated exchange, not by provider entity timestamps or browser polling.
export async function readNativeAttempt(options: {
  scope: NativeScope;
  association: unknown;
  exchange: NativeExchange;
  signature: (bookingId: string) => Promise<string>;
  signal: AbortSignal;
}) {
  validateScope(options.scope);
  const refs = associationSchema.parse(options.association);
  if (refs.bookingIds.length !== options.scope.intent.sessions.length)
    throw new ApiError(503, "native_association_missing");
  providerId(refs.invoiceId);
  const bookings: unknown[] = [];
  let observedAtMs = Number.MAX_SAFE_INTEGER;
  for (const bookingId of refs.bookingIds) {
    providerId(bookingId);
    options.signal.throwIfAborted();
    const signature = await options.signature(bookingId);
    options.signal.throwIfAborted();
    const booking = await options.exchange(
      { kind: "booking-read", bookingId, signature },
      options.signal,
    );
    bookings.push(booking.body);
    observedAtMs = Math.min(observedAtMs, booking.receivedAtMs);
  }
  options.signal.throwIfAborted();
  const invoice = await options.exchange(
    { kind: "invoice-read", invoiceId: refs.invoiceId },
    options.signal,
  );
  options.signal.throwIfAborted();
  return {
    kind: "observation" as const,
    observation: normalizeNativeReads(bookings, invoice.body, {
      ...options.scope,
      association: refs,
      bookingObservedAtMs: observedAtMs,
      invoiceObservedAtMs: invoice.receivedAtMs,
    }),
  };
}
// Attempt03 local checkout guards; this does not establish provider TTL or cancellation.
export type NativeCheckoutTiming = {
  invoiceId: string;
  dueDatetime: unknown;
  supervisionDeadlineMs: number;
  handoffAtMs: number;
};
export function nativeCheckoutDeadline(
  timing: NativeCheckoutTiming,
  now: number,
) {
  const match =
    typeof timing.dueDatetime === "string" &&
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(
      timing.dueDatetime,
    );
  if (
    !match ||
    ![now, timing.supervisionDeadlineMs, timing.handoffAtMs].every(
      Number.isSafeInteger,
    ) ||
    timing.handoffAtMs > now
  )
    throw new ApiError(503, "native_checkout_expiry_unverified");
  const offset = match[3];
  const offsetMinutes = !offset
    ? 480
    : offset === "Z"
      ? 0
      : (offset[0] === "-" ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4)));
  const due =
    bookingWallTime(`${match[1]} ${match[2]}`, "Asia/Singapore") +
    (480 - offsetMinutes) * 60000;
  const deadline = Math.min(
    timing.supervisionDeadlineMs,
    timing.handoffAtMs + 600000,
    due - 30000,
  );
  if (
    Math.min(due, timing.supervisionDeadlineMs) - now < 180000 ||
    deadline <= now
  )
    throw new ApiError(503, "native_checkout_expiry_unverified");
  return deadline;
}
// Reserve the potentially stateful GET before dispatch. Lost/malformed replies
// remain unknown, and a new adapter instance cannot regenerate the link.
export async function prepareNativeLink(
  db: D1Database,
  scope: NativeScope,
  exchange: NativeExchange,
  configured = true,
  timing?: NativeCheckoutTiming,
) {
  const intent = validateScope(scope);
  if (!configured || !timing)
    throw new ApiError(503, "native_checkout_expiry_unverified");
  nativeCheckoutDeadline(timing, Date.now());
  const row = await db
    .withSession("first-primary")
    .prepare(
      "SELECT intent_json,association_json,version,deadline_ms FROM attempts WHERE id=? AND association_json IS NOT NULL AND state='dispatching'",
    )
    .bind(scope.attemptId)
    .first<{
      intent_json: string;
      association_json: string;
      version: number;
      deadline_ms: number;
    }>();
  if (
    !row ||
    row.deadline_ms < Date.now() + 180000 ||
    (await digest(JSON.stringify(intent))) !== (await digest(row.intent_json))
  )
    throw new ApiError(409, "native_association_missing");
  const refs = associationSchema.parse(JSON.parse(row.association_json));
  if (refs.bookingIds.length !== intent.sessions.length)
    throw new ApiError(409, "native_association_missing");
  if (providerId(timing.invoiceId) !== refs.invoiceId)
    throw new ApiError(409, "native_association_missing");
  const expiresAtMs = nativeCheckoutDeadline(
    {
      ...timing,
      supervisionDeadlineMs: Math.min(
        timing.supervisionDeadlineMs,
        row.deadline_ms,
      ),
    },
    Date.now(),
  );
  // A native-link effect's opaque reference is private capability metadata.
  // Protected context is its only customer read; logs/results omit it.
  const reserved = await db
    .prepare(
      "INSERT INTO session_effects(attempt_id,step,outcome) SELECT id,'native-link','unknown' FROM attempts WHERE id=? AND version=? AND state='dispatching' AND deadline_ms>?",
    )
    .bind(scope.attemptId, row.version, Date.now())
    .run();
  if (reserved.meta.changes !== 1)
    throw new ApiError(409, "native_link_not_claimed");
  const raw = await exchange({
    kind: "payment-link",
    invoiceId: providerId(refs.invoiceId),
  });
  const link = nativeCheckoutLink(raw.body, configured);
  const saved = await db
    .prepare(
      "UPDATE session_effects SET outcome='observed',reference_id=? WHERE attempt_id=? AND step='native-link' AND outcome='unknown' AND EXISTS(SELECT 1 FROM attempts WHERE id=? AND version=? AND state='dispatching')",
    )
    .bind(
      JSON.stringify({
        invoiceId: refs.invoiceId,
        link,
        expiresAtMs: Math.min(expiresAtMs!, row.deadline_ms),
      }),
      scope.attemptId,
      scope.attemptId,
      row.version,
    )
    .run();
  if (saved.meta.changes !== 1)
    throw new ApiError(409, "native_link_fence_lost");
  return {
    attemptId: scope.attemptId,
    invoiceId: refs.invoiceId,
    state: "prepared" as const,
  };
}

// Provider-required legacy signature only; never used for SoccerBot access.
export async function nativeBookingSignature(
  bookingId: string,
  hash: string,
  signingSecret: string,
) {
  providerId(bookingId);
  if (
    !/^[A-Za-z0-9_-]{8,256}$/.test(hash) ||
    !signingSecret ||
    signingSecret.includes("[")
  )
    throw new ApiError(503, "native_signing_unavailable");
  const result = await crypto.subtle.digest(
    "MD5",
    new TextEncoder().encode(bookingId + hash + signingSecret),
  );
  return Array.from(new Uint8Array(result), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

export async function storedNativeCheckout(
  db: D1Database,
  attemptId: string,
  association: unknown,
  now: number,
) {
  const refs = associationSchema.parse(association);
  const row = await db
    .withSession("first-primary")
    .prepare(
      "SELECT reference_id FROM session_effects WHERE attempt_id=? AND step='native-link' AND outcome='observed'",
    )
    .bind(attemptId)
    .first<{ reference_id: string }>();
  if (!row) return { state: "unavailable" as const };
  try {
    const value = z
      .strictObject({
        invoiceId: z.string(),
        link: z.string(),
        expiresAtMs: z.number().int().safe(),
      })
      .parse(JSON.parse(row.reference_id));
    if (value.invoiceId !== refs.invoiceId || now >= value.expiresAtMs)
      return { state: "unavailable" as const };
    return {
      state: "available" as const,
      url: nativeCheckoutLink({ link: value.link }),
      expiresAtMs: value.expiresAtMs,
    };
  } catch {
    return { state: "unavailable" as const };
  }
}

// Opaque native references use the existing per-attempt effect store. Unlike
// authentication tokens, booking hashes must survive a restart for known-ID reads.
async function retainNativeBookingKey(
  db: D1Database,
  attemptId: string,
  bookingId: string,
  hash: string | undefined,
  sessionIndex: number,
  sessionCount: number,
  nativeCustomerId?: string,
) {
  const statements = [
    db
      .prepare(
        "UPDATE session_effects SET outcome='observed',reference_id=? WHERE attempt_id=? AND step=? AND outcome='unknown' AND EXISTS(SELECT 1 FROM attempts WHERE id=? AND state IN ('dispatching','recovery_required') AND association_json IS NULL)",
      )
      .bind(bookingId, attemptId, `session:${sessionIndex}`, attemptId),
  ];
  if (hash !== undefined)
    statements.push(
      db
        .prepare(
          "INSERT INTO session_effects(attempt_id,step,outcome,reference_id) SELECT id,?,'observed',? FROM attempts WHERE id=? AND state IN ('dispatching','recovery_required') AND association_json IS NULL AND changes()=1",
        )
        .bind(
          sessionCount === 1
            ? "native-booking-key"
            : `native-booking-key:${sessionIndex}`,
          JSON.stringify({
            bookingId,
            hash,
            ...(nativeCustomerId ? { nativeCustomerId } : {}),
          }),
          attemptId,
        ),
    );
  const result = await db.batch(statements);
  if (result.some((statement) => statement.meta.changes !== 1))
    throw new ApiError(409, "native_key_not_retained");
}
export async function storedNativeSignature(
  db: D1Database,
  attemptId: string,
  bookingId: string,
  signingSecret: string,
) {
  const row = await db
    .withSession("first-primary")
    .prepare(
      "SELECT e.reference_id,a.association_json FROM session_effects e JOIN attempts a ON a.id=e.attempt_id WHERE e.attempt_id=? AND (e.step='native-booking-key' OR e.step GLOB 'native-booking-key:[0-9]*') AND e.outcome='observed' AND json_extract(e.reference_id,'$.bookingId')=?",
    )
    .bind(attemptId, bookingId)
    .first<{ reference_id: string; association_json: string }>();
  if (!row) throw new ApiError(503, "native_signing_unavailable");
  const key = retainedNativeKeySchema.parse(JSON.parse(row.reference_id));
  const refs = associationSchema.parse(JSON.parse(row.association_json));
  if (key.bookingId !== bookingId || !refs.bookingIds.includes(bookingId))
    throw new ApiError(503, "native_signing_unavailable");
  return nativeBookingSignature(bookingId, key.hash, signingSecret);
}

// A lost finalization reply can be reconciled only from every retained new
// booking key. No email lookup, batch replay, invoice creation or payment write.
export async function recoverNativeAssociation(options: {
  db: D1Database;
  scope: NativeScope;
  exchange: NativeExchange;
  signingSecret: string;
  signal: AbortSignal;
}) {
  const intent = validateScope(options.scope);
  const row = await options.db
    .withSession("first-primary")
    .prepare(
      "SELECT version,intent_json FROM attempts WHERE id=? AND association_json IS NULL AND state='recovery_required'",
    )
    .bind(options.scope.attemptId)
    .first<{ version: number; intent_json: string }>();
  if (
    !row ||
    (await digest(row.intent_json)) !== (await digest(JSON.stringify(intent)))
  )
    throw new ApiError(409, "native_recovery_scope_mismatch");
  const rows = await options.db
    .withSession("first-primary")
    .prepare(
      "SELECT step,reference_id FROM session_effects WHERE attempt_id=? AND (step='native-booking-key' OR step GLOB 'native-booking-key:[0-9]*') AND outcome='observed' ORDER BY step",
    )
    .bind(options.scope.attemptId)
    .all<{ step: string; reference_id: string }>();
  if (rows.results.length !== intent.sessions.length)
    throw new ApiError(503, "native_recovery_references_incomplete");
  const keys = intent.sessions.map((_, index) => {
    const step =
      intent.sessions.length === 1
        ? "native-booking-key"
        : `native-booking-key:${index}`;
    const retained = rows.results.find((entry) => entry.step === step);
    if (!retained)
      throw new ApiError(503, "native_recovery_references_incomplete");
    return retainedNativeKeySchema.parse(JSON.parse(retained.reference_id));
  });
  if (new Set(keys.map((key) => key.bookingId)).size !== keys.length)
    throw new ApiError(409, "native_duplicate_booking");
  const { association, observation, observedAtMs } = await readNativeKeySet({
    ...options,
    keys,
  });
  const result = await options.db
    .prepare(
      "UPDATE attempts SET association_json=?,observation_json=?,observation_ms=?,state='observed',version=version+1 WHERE id=? AND version=? AND state='recovery_required' AND association_json IS NULL",
    )
    .bind(
      JSON.stringify(association),
      JSON.stringify(observation),
      observedAtMs,
      options.scope.attemptId,
      row.version,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new ApiError(409, "native_recovery_fence_lost");
  return { state: "associated" as const, reads: keys.length + 1 };
}

// Read only retained new-booking keys. The same strict association/money
// normalization is used by recovery and compensation; a candidate is not proof.
async function readNativeKeySet(options: {
  scope: NativeScope;
  keys: z.infer<typeof retainedNativeKeySchema>[];
  exchange: NativeExchange;
  signingSecret: string;
  signal: AbortSignal;
}) {
  const { keys } = options;
  const bookings: unknown[] = [];
  let invoiceId: string | undefined, nativeCustomerId: string | undefined;
  let bookingObservedAtMs = Number.MAX_SAFE_INTEGER;
  for (const key of keys) {
    options.signal.throwIfAborted();
    const signature = await nativeBookingSignature(
      key.bookingId,
      key.hash,
      options.signingSecret,
    );
    const response = await options.exchange(
      { kind: "booking-read", bookingId: key.bookingId, signature },
      options.signal,
    );
    const booking = nativeRecord(response.body, "booking");
    const nativeInvoice = providerId(booking.invoice_id, "booking.invoice_id"),
      nativeCustomer = providerId(booking.client_id, "booking.client_id");
    if (providerId(booking.id, "booking.id") !== key.bookingId)
      rejectNative(
        "booking.id",
        "mismatch",
        409,
        "native_recovery_association_conflict",
      );
    if (
      (key.nativeCustomerId !== undefined &&
        key.nativeCustomerId !== nativeCustomer) ||
      (nativeCustomerId !== undefined && nativeCustomerId !== nativeCustomer)
    )
      rejectNative(
        "booking.client_id",
        "mismatch",
        409,
        "native_recovery_association_conflict",
      );
    if (invoiceId !== undefined && invoiceId !== nativeInvoice)
      rejectNative(
        "booking.invoice_id",
        "mismatch",
        409,
        "native_recovery_association_conflict",
      );
    invoiceId = nativeInvoice;
    nativeCustomerId = nativeCustomer;
    bookings.push(response.body);
    bookingObservedAtMs = Math.min(bookingObservedAtMs, response.receivedAtMs);
  }
  const association = associationSchema.parse({
    invoiceId,
    bookingIds: keys.map((key) => key.bookingId),
    ...(options.scope.intent.customerMode === "booking-contact"
      ? { nativeCustomerId }
      : {}),
  });
  options.signal.throwIfAborted();
  const invoice = await options.exchange(
    { kind: "invoice-read", invoiceId: association.invoiceId },
    options.signal,
  );
  const observation = normalizeNativeReads(bookings, invoice.body, {
    ...options.scope,
    association,
    bookingObservedAtMs,
    invoiceObservedAtMs: invoice.receivedAtMs,
  });
  options.signal.throwIfAborted();
  return {
    association,
    observation,
    observedAtMs: Math.min(bookingObservedAtMs, invoice.receivedAtMs),
  };
}

// Finite server-owned compensation only. It never repairs a cart, grants access,
// refunds money, or treats a cancellation response as proof of cancellation.
export async function compensateNativeAttempt(options: {
  db: D1Database;
  scope: NativeScope;
  exchange: NativeExchange;
  signingSecret: string;
  signal: AbortSignal;
  assertGranted: () => Promise<void>;
  invalidate: () => void;
  operatorRecovery?: { expiresMs: number; expectedBookingIds: string[] };
}) {
  const intent = validateScope(options.scope);
  const row = await options.db
    .withSession("first-primary")
    .prepare(
      "SELECT version,intent_json,association_json FROM attempts WHERE id=? AND state='recovery_required'",
    )
    .bind(options.scope.attemptId)
    .first<{
      version: number;
      intent_json: string;
      association_json: string | null;
    }>();
  if (
    !row ||
    (await digest(row.intent_json)) !== (await digest(JSON.stringify(intent)))
  )
    throw new ApiError(409, "native_cleanup_scope_mismatch");
  const effects = (
    await options.db
      .withSession("first-primary")
      .prepare(
        "SELECT step,outcome,reference_id FROM session_effects WHERE attempt_id=? ORDER BY step",
      )
      .bind(options.scope.attemptId)
      .all<{ step: string; outcome: string; reference_id: string | null }>()
  ).results;
  // Even an unknown link might have escaped. Never race a customer checkout.
  // A prior cancellation is readback work, never permission to dispatch again.
  if (
    effects.some(
      (effect) =>
        effect.step === "native-link" ||
        effect.step.startsWith("native-cancel:"),
    )
  )
    throw new ApiError(409, "native_cleanup_not_replayable");
  const candidates = intent.sessions.flatMap((session, index) => {
    const key = effects.find(
      (effect) =>
        effect.step ===
        (intent.sessions.length === 1
          ? "native-booking-key"
          : `native-booking-key:${index}`),
    );
    const effect = effects.find((effect) => effect.step === `session:${index}`);
    if (!key || key.outcome !== "observed" || !key.reference_id) return [];
    const value = retainedNativeKeySchema.parse(JSON.parse(key.reference_id));
    if (
      effect?.outcome !== "observed" ||
      effect.reference_id !== value.bookingId
    )
      throw new ApiError(409, "native_cleanup_reference_conflict");
    return [{ ...value, session, index }];
  });
  if (
    !candidates.length ||
    new Set(candidates.map((key) => key.bookingId)).size !== candidates.length
  )
    throw new ApiError(503, "native_cleanup_references_unavailable");
  const operator = options.operatorRecovery;
  if (
    operator &&
    (!Number.isSafeInteger(operator.expiresMs) ||
      operator.expiresMs <= Date.now() ||
      operator.expiresMs > Date.now() + 180000 ||
      JSON.stringify(candidates.map((key) => key.bookingId)) !==
        JSON.stringify(operator.expectedBookingIds))
  )
    throw new ApiError(409, "native_cleanup_scope_mismatch");
  // A partial invoice must prove exactly the retained subset. Extra/unknown
  // native lines fail normalization; the original immutable cart is unchanged.
  const scope = {
    ...options.scope,
    intent: intentSchema.parse({
      ...intent,
      sessions: candidates.map((key) => key.session),
      totalMinor: candidates.reduce(
        (total, key) => total + key.session.totalMinor,
        0,
      ),
      taxMinor: candidates.reduce(
        (total, key) => total + key.session.taxMinor,
        0,
      ),
    }),
  };
  const assertCurrent = async () => {
    options.signal.throwIfAborted();
    await options.assertGranted();
    if (operator && operator.expiresMs <= Date.now())
      throw new ApiError(409, "native_cleanup_fence_lost");
    const current = await options.db
      .withSession("first-primary")
      .prepare(
        "SELECT 1 FROM attempts WHERE id=? AND version=? AND state='recovery_required' AND (? > ? OR deadline_ms>?) AND NOT EXISTS(SELECT 1 FROM session_effects WHERE attempt_id=? AND step='native-link')",
      )
      .bind(
        scope.attemptId,
        row.version,
        operator?.expiresMs ?? 0,
        Date.now(),
        Date.now(),
        scope.attemptId,
      )
      .first();
    if (!current) throw new ApiError(409, "native_cleanup_fence_lost");
  };
  const exchange: NativeExchange = async (request, signal) => {
    await assertCurrent();
    return options.exchange(request, signal);
  };
  const read = async () => {
    const result = await readNativeKeySet({
      ...options,
      scope,
      keys: candidates,
      exchange,
    });
    const now = Date.now();
    if (
      row.association_json &&
      JSON.stringify(
        associationSchema.parse(JSON.parse(row.association_json)),
      ) !== JSON.stringify(result.association)
    )
      throw new ApiError(409, "native_cleanup_association_changed");
    if (
      result.observation.bookings.some(
        (booking) =>
          booking.observedAtMs > now || now - booking.observedAtMs > 15000,
      ) ||
      result.observation.invoice.observedAtMs > now ||
      now - result.observation.invoice.observedAtMs > 15000
    )
      throw new ApiError(409, "native_cleanup_evidence_expired");
    return result;
  };
  for (const candidate of candidates) {
    const before = await read();
    const booking = before.observation.bookings.find(
      (value) => value.session.bookingId === candidate.bookingId,
    )!;
    if (
      before.observation.invoice.status !== "unpaid" ||
      booking.status !== "confirmed"
    )
      throw new ApiError(409, "native_cleanup_payment_or_booking_changed");
    await assertCurrent();
    const step = `native-cancel:${candidate.index}`;
    const reserved = await options.db
      .prepare(
        "INSERT INTO session_effects(attempt_id,step,outcome) SELECT id,?,'unknown' FROM attempts WHERE id=? AND version=? AND state='recovery_required' AND (? > ? OR deadline_ms>?) AND NOT EXISTS(SELECT 1 FROM session_effects WHERE attempt_id=? AND step='native-link')",
      )
      .bind(
        step,
        scope.attemptId,
        row.version,
        operator?.expiresMs ?? 0,
        Date.now(),
        Date.now(),
        scope.attemptId,
      )
      .run();
    if (reserved.meta.changes !== 1)
      throw new ApiError(409, "native_cleanup_not_claimed");
    const signature = await nativeBookingSignature(
      candidate.bookingId,
      candidate.hash,
      options.signingSecret,
    );
    options.invalidate();
    const response = await exchange(
      {
        kind: "booking-cancel",
        bookingId: candidate.bookingId,
        signature,
        evidenceObservedAtMs: before.observedAtMs,
      },
      options.signal,
    ).finally(() => options.invalidate());
    if (response.body !== true)
      throw new ApiError(503, "native_cleanup_outcome_unknown");
    const after = await read();
    if (
      after.observation.invoice.paymentReceived ||
      !["unpaid", "cancelled"].includes(after.observation.invoice.status) ||
      after.observation.bookings.find(
        (value) => value.session.bookingId === candidate.bookingId,
      )?.status !== "cancelled"
    )
      throw new ApiError(409, "native_cleanup_outcome_unknown");
    const saved = await options.db
      .prepare(
        "UPDATE session_effects SET outcome='observed',reference_id=? WHERE attempt_id=? AND step=? AND outcome='unknown' AND EXISTS(SELECT 1 FROM attempts WHERE id=? AND version=? AND state='recovery_required')",
      )
      .bind(
        candidate.bookingId,
        scope.attemptId,
        step,
        scope.attemptId,
        row.version,
      )
      .run();
    if (saved.meta.changes !== 1)
      throw new ApiError(409, "native_cleanup_fence_lost");
  }
  // A missing reply can still conceal another booking. Never call that clean.
  const uncertain = effects.some(
    (effect) =>
      /^session:\d+$/.test(effect.step) &&
      !candidates.some((key) => effect.step === `session:${key.index}`),
  );
  return {
    state: uncertain ? ("incomplete" as const) : ("cancelled" as const),
    cancelled: candidates.length,
  };
}
