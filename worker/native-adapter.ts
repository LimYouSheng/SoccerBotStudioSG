import { isNativeCheckoutUrl } from "../src/domain/native-checkout";
import { z } from "zod";
import { ApiError, digest } from "./policy";
import { intentSchema, associationSchema } from "./journal";
import {
  normalizeNativeCreation,
  normalizeNativeReads,
  providerId,
  bookingWallTime,
} from "./provider-normalization";
import type { BookingOperations } from "./orchestration";
import { nativeBookFields, type NativeRequest } from "./provider-transport";

// A trusted server composition supplies authenticated, admitted dispatch and
// pre-write validation. No HTTP route accepts this contract from a customer.
export type NativeExchange = (
  request: NativeRequest,
  signal?: AbortSignal,
) => Promise<{
  body: unknown;
  receivedAtMs: number;
}>;
export type NativeScope = {
  attemptId: string;
  companyLogin: string;
  timezone: "Asia/Singapore";
  intent: z.infer<typeof intentSchema>;
};
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
    intent.sessions.length !== 1 ||
    scope.timezone !== "Asia/Singapore" ||
    !scope.companyLogin ||
    scope.companyLogin.includes("[") ||
    scope.companyLogin.toLowerCase() === "soccerbotstudio"
  )
    throw new ApiError(503, "native_scope_unavailable");
  return intent;
}
// Implements the existing composition contract. Finalize consumes the invoice
// returned by book; it never issues a second booking or independent payment.
export function nativeBookingOperations(options: {
  scope: NativeScope;
  exchange: NativeExchange;
  client: unknown;
  additional: unknown;
  // Required-fields, eligibility/shared availability, current price/tax, customer
  // and player mapping remain trusted pre-write checks, not response guesses.
  revalidate: BookingOperations["revalidate"];
  hasRecoveryCapacity: BookingOperations["hasRecoveryCapacity"];
  db: D1Database;
}): BookingOperations {
  const intent = validateScope(options.scope);
  const fields = nativeBookFields(options.client, options.additional);
  let created: ReturnType<typeof normalizeNativeCreation> | undefined;
  let dispatched = false;
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
      if (context.sessionIndex !== 0)
        throw new ApiError(409, "native_single_session_only");
      return options.revalidate(value, context);
    },
    async createSession(session, value, context) {
      await matches(value, context.attemptId);
      if (JSON.stringify(session) !== JSON.stringify(intent.sessions[0]))
        throw new ApiError(409, "native_intent_mismatch");
      if (dispatched || context.sessionIndex !== 0)
        throw new ApiError(409, "native_write_not_replayable");
      dispatched = true;
      const wall = new Date(session.startMs + 8 * 3600000).toISOString();
      const response = await options.exchange({
        kind: "book",
        serviceId: session.serviceId,
        instructorId: session.instructorId,
        date: wall.slice(0, 10),
        time: wall.slice(11, 19),
        client: fields.client,
        additional: fields.additional,
      });
      created = normalizeNativeCreation(response.body, {
        ...options.scope,
        bookingObservedAtMs: response.receivedAtMs,
        invoiceObservedAtMs: response.receivedAtMs,
      });
      await retainNativeBookingKey(
        options.db,
        options.scope.attemptId,
        created.association.bookingIds[0],
        created.bookingHash,
      );
      return {
        bookingId: created.association.bookingIds[0],
        accountId: intent.accountId,
        customerId: intent.customerId,
        ...session,
        currency: intent.currency,
        confirmed: true,
      };
    },
    async finalize(ids, value, attemptId) {
      await matches(value, attemptId);
      if (
        !created ||
        ids.length !== 1 ||
        ids[0] !== created.association.bookingIds[0]
      )
        throw new ApiError(409, "native_association_missing");
      return {
        invoiceId: created.association.invoiceId,
        bookingIds: ids,
        accountId: intent.accountId,
        customerId: intent.customerId,
        currency: intent.currency,
        totalMinor: intent.totalMinor,
        taxMinor: intent.taxMinor,
      };
    },
  };
}
// Exactly two reads of known references. Receipt times are captured by the
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
  if (refs.bookingIds.length !== 1)
    throw new ApiError(503, "native_single_session_only");
  providerId(refs.invoiceId);
  providerId(refs.bookingIds[0]);
  options.signal.throwIfAborted();
  const signature = await options.signature(refs.bookingIds[0]);
  options.signal.throwIfAborted();
  const booking = await options.exchange(
    { kind: "booking-read", bookingId: refs.bookingIds[0], signature },
    options.signal,
  );
  options.signal.throwIfAborted();
  const invoice = await options.exchange(
    { kind: "invoice-read", invoiceId: refs.invoiceId },
    options.signal,
  );
  options.signal.throwIfAborted();
  return {
    kind: "observation" as const,
    observation: normalizeNativeReads(booking.body, invoice.body, {
      ...options.scope,
      association: refs,
      bookingObservedAtMs: booking.receivedAtMs,
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
  if (refs.bookingIds.length !== 1)
    throw new ApiError(409, "native_single_session_only");
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
  hash: string,
) {
  const result = await db
    .prepare(
      "INSERT INTO session_effects(attempt_id,step,outcome,reference_id) SELECT id,'native-booking-key','observed',? FROM attempts WHERE id=? AND state='dispatching' AND association_json IS NULL",
    )
    .bind(JSON.stringify({ bookingId, hash }), attemptId)
    .run();
  if (result.meta.changes !== 1)
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
      "SELECT e.reference_id,a.association_json FROM session_effects e JOIN attempts a ON a.id=e.attempt_id WHERE e.attempt_id=? AND e.step='native-booking-key' AND e.outcome='observed'",
    )
    .bind(attemptId)
    .first<{ reference_id: string; association_json: string }>();
  if (!row) throw new ApiError(503, "native_signing_unavailable");
  const key = z
    .strictObject({ bookingId: z.string(), hash: z.string() })
    .parse(JSON.parse(row.reference_id));
  const refs = associationSchema.parse(JSON.parse(row.association_json));
  if (
    key.bookingId !== bookingId ||
    refs.bookingIds.length !== 1 ||
    refs.bookingIds[0] !== bookingId
  )
    throw new ApiError(503, "native_signing_unavailable");
  return nativeBookingSignature(bookingId, key.hash, signingSecret);
}
