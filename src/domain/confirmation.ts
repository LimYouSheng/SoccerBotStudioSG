import { z } from "zod";

// Internal normalized evidence, not provider response schemas or authentication.
// Only a trusted server caller may supply access, approved intent and observations.
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = integer.max(8_640_000_000_000_000);
const subject = z.strictObject({
  kind: z.enum(["principal", "guest"]),
  id: identifier,
});
const binding = {
  accountId: identifier,
  environmentId: identifier,
  attemptId: identifier,
};
const attemptBinding = z.object({ ...binding, subject });
const accessSchema = z.strictObject({
  ...binding,
  subject,
  permission: z.literal("confirmation:read"),
  validFromMs: instant,
  expiresAtMs: instant,
});
const accessGate = z.object({
  nowMs: instant,
  attempt: attemptBinding,
  access: accessSchema,
});
const money = z
  .strictObject({
    totalMinor: integer,
    taxMinor: integer,
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .refine((value) => value.taxMinor <= value.totalMinor);
const session = z
  .strictObject({
    bookingId: identifier,
    serviceId: identifier,
    instructorId: identifier,
    startMs: instant,
    playEndMs: instant,
    occupiedStartMs: instant,
    occupiedEndMs: instant,
  })
  .refine(
    (value) =>
      value.occupiedStartMs <= value.startMs &&
      value.startMs < value.playEndMs &&
      value.playEndMs <= value.occupiedEndMs,
  );
const expectedBooking = z.strictObject({ session, money });
const attemptSchema = z.strictObject({
  ...binding,
  subject,
  customerId: identifier,
  approvedAtMs: instant,
  invoiceId: identifier,
  money,
  bookings: z.array(expectedBooking).min(1),
});
const observationBinding = {
  ...binding,
  customerId: identifier,
  observedAtMs: instant,
};
const bookingSchema = z.strictObject({
  ...observationBinding,
  invoiceId: identifier,
  session,
  status: z.enum(["confirmed", "pending", "cancelled", "invalid", "unknown"]),
});
const invoiceSchema = z.strictObject({
  ...observationBinding,
  invoiceId: identifier,
  money,
  lines: z.array(z.strictObject({ bookingId: identifier, money })),
  status: z.enum([
    "paid",
    "pending",
    "unpaid",
    "failed",
    "expired",
    "cancelled",
    "unknown",
  ]),
  paymentReceived: z.boolean().nullable(),
});
const inputSchema = z.strictObject({
  nowMs: instant,
  policy: z.strictObject({
    maxObservationAgeMs: integer,
    verificationDeadlineMs: instant,
  }),
  attempt: attemptSchema,
  access: accessSchema,
  bookings: z.array(bookingSchema),
  invoice: invoiceSchema.nullable(),
});

export type ConfirmationInput = z.infer<typeof inputSchema>;
export type ConfirmationDecision =
  | { status: "confirmed"; reason: "verified" }
  | { status: "denied"; reason: "access_denied" }
  | {
      status: "pending";
      reason: "missing_evidence" | "payment_pending" | "booking_pending";
    }
  | {
      status: "invalid";
      reason:
        | "booking_invalid"
        | "invoice_failed"
        | "invoice_expired"
        | "invoice_cancelled";
    }
  | {
      status: "unresolved";
      reason:
        | "invalid_input"
        | "invalid_attempt"
        | "scope_mismatch"
        | "booking_set_conflict"
        | "invoice_association_conflict"
        | "session_mismatch"
        | "money_mismatch"
        | "observation_time_invalid"
        | "stale_observation"
        | "unknown_state"
        | "payment_conflict"
        | "paid_booking_invalid"
        | "verification_window_elapsed";
    };

type Binding = z.infer<typeof attemptBinding>;
type Scope = Pick<Binding, "accountId" | "environmentId" | "attemptId">;
function sameScope(a: Scope, b: Scope): boolean {
  return (
    a.accountId === b.accountId &&
    a.environmentId === b.environmentId &&
    a.attemptId === b.attemptId
  );
}
function sameMoney(
  a: z.infer<typeof money>,
  b: z.infer<typeof money>,
): boolean {
  return (
    a.totalMinor === b.totalMinor &&
    a.taxMinor === b.taxMinor &&
    a.currency === b.currency
  );
}
function unique(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}
function sameSession(
  a: z.infer<typeof session>,
  b: z.infer<typeof session>,
): boolean {
  return (
    a.bookingId === b.bookingId &&
    a.serviceId === b.serviceId &&
    a.instructorId === b.instructorId &&
    a.startMs === b.startMs &&
    a.playEndMs === b.playEndMs &&
    a.occupiedStartMs === b.occupiedStartMs &&
    a.occupiedEndMs === b.occupiedEndMs
  );
}
function pending(
  input: ConfirmationInput,
  reason: Extract<ConfirmationDecision, { status: "pending" }>["reason"],
): ConfirmationDecision {
  return input.nowMs >= input.policy.verificationDeadlineMs
    ? { status: "unresolved", reason: "verification_window_elapsed" }
    : { status: "pending", reason };
}

/**
 * Decisions only: no I/O, clocks, persistence, mutation, retries or polling.
 * The caller must authenticate/revoke access, load immutable approved intent,
 * and normalize complete authenticated provider reads independently of the client.
 * Matching these runtime shapes does NOT establish that provenance.
 * All results contain only closed status/reason codes; denied callers learn no IDs.
 */
export function verifyConfirmation(value: unknown): ConfirmationDecision {
  // Authorize the binding before inspecting financial/session evidence. This is
  // a scope/validity check of supplied context, never token/signature verification.
  const gate = accessGate.safeParse(value);
  if (!gate.success) return { status: "denied", reason: "access_denied" };
  const { access, attempt: bindingValue, nowMs } = gate.data;
  if (
    !sameScope(access, bindingValue) ||
    access.subject.kind !== bindingValue.subject.kind ||
    access.subject.id !== bindingValue.subject.id ||
    access.validFromMs > nowMs ||
    access.expiresAtMs <= nowMs ||
    access.expiresAtMs <= access.validFromMs
  ) {
    return { status: "denied", reason: "access_denied" };
  }
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) return { status: "unresolved", reason: "invalid_input" };
  const input = parsed.data;
  const { attempt, bookings, invoice, policy } = input;
  const expectedIds = attempt.bookings.map(
    (booking) => booking.session.bookingId,
  );
  const total = attempt.bookings.reduce(
    (sum, booking) => sum + BigInt(booking.money.totalMinor),
    0n,
  );
  const tax = attempt.bookings.reduce(
    (sum, booking) => sum + BigInt(booking.money.taxMinor),
    0n,
  );
  if (
    !unique(expectedIds) ||
    attempt.approvedAtMs > nowMs ||
    policy.verificationDeadlineMs < attempt.approvedAtMs ||
    attempt.bookings.some(
      (booking) => booking.money.currency !== attempt.money.currency,
    ) ||
    total !== BigInt(attempt.money.totalMinor) ||
    tax !== BigInt(attempt.money.taxMinor)
  ) {
    return { status: "unresolved", reason: "invalid_attempt" };
  }
  const expected = new Map(
    attempt.bookings.map((booking) => [booking.session.bookingId, booking]),
  );
  const observations = invoice ? [...bookings, invoice] : bookings;
  if (
    observations.some(
      (observation) =>
        !sameScope(observation, attempt) ||
        observation.customerId !== attempt.customerId,
    )
  ) {
    return { status: "unresolved", reason: "scope_mismatch" };
  }
  if (
    !unique(bookings.map((booking) => booking.session.bookingId)) ||
    bookings.some((booking) => !expected.has(booking.session.bookingId))
  ) {
    return { status: "unresolved", reason: "booking_set_conflict" };
  }
  if (
    bookings.some((booking) => booking.invoiceId !== attempt.invoiceId) ||
    (invoice &&
      (invoice.invoiceId !== attempt.invoiceId ||
        !unique(invoice.lines.map((line) => line.bookingId)) ||
        invoice.lines.length !== expected.size ||
        invoice.lines.some((line) => !expected.has(line.bookingId))))
  ) {
    return { status: "unresolved", reason: "invoice_association_conflict" };
  }
  if (
    bookings.some(
      (booking) =>
        !sameSession(
          booking.session,
          expected.get(booking.session.bookingId)!.session,
        ),
    )
  ) {
    return { status: "unresolved", reason: "session_mismatch" };
  }
  if (
    invoice &&
    (!sameMoney(invoice.money, attempt.money) ||
      invoice.lines.some(
        (line) => !sameMoney(line.money, expected.get(line.bookingId)!.money),
      ))
  ) {
    return { status: "unresolved", reason: "money_mismatch" };
  }
  if (
    observations.some(
      (observation) =>
        observation.observedAtMs > nowMs ||
        observation.observedAtMs < attempt.approvedAtMs,
    )
  ) {
    return { status: "unresolved", reason: "observation_time_invalid" };
  }
  if (
    observations.some(
      (observation) =>
        nowMs - observation.observedAtMs > policy.maxObservationAgeMs,
    )
  ) {
    return { status: "unresolved", reason: "stale_observation" };
  }
  if (
    invoice?.status === "unknown" ||
    invoice?.paymentReceived === null ||
    bookings.some((booking) => booking.status === "unknown")
  ) {
    return { status: "unresolved", reason: "unknown_state" };
  }
  if (invoice && (invoice.status === "paid") !== invoice.paymentReceived) {
    return { status: "unresolved", reason: "payment_conflict" };
  }
  if (
    bookings.some(
      (booking) =>
        booking.status === "cancelled" || booking.status === "invalid",
    )
  ) {
    return invoice?.status === "paid"
      ? { status: "unresolved", reason: "paid_booking_invalid" }
      : { status: "invalid", reason: "booking_invalid" };
  }
  if (invoice?.status === "failed")
    return { status: "invalid", reason: "invoice_failed" };
  if (invoice?.status === "expired")
    return { status: "invalid", reason: "invoice_expired" };
  if (invoice?.status === "cancelled")
    return { status: "invalid", reason: "invoice_cancelled" };
  if (!invoice || bookings.length !== expected.size)
    return pending(input, "missing_evidence");
  if (invoice.status !== "paid") return pending(input, "payment_pending");
  if (bookings.some((booking) => booking.status === "pending"))
    return pending(input, "booking_pending");
  return { status: "confirmed", reason: "verified" };
}
