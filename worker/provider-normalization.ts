import type { ConfirmationInput } from "../src/domain/confirmation";
import { ApiError } from "./policy";
import { intentSchema, associationSchema } from "./journal";

// Unknown flag values must not be coerced to false or paid.
export function providerFlag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}
function scalar(value: unknown) {
  return typeof value === "string" && value.length <= 128
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function minorUnits(value: unknown): number | null {
  const s =
    typeof value === "number" || typeof value === "string" ? String(value) : "";
  if (s.length > 32 || !/^(0|[1-9]\d*)(\.\d{1,2}0*|\.0+)?$/.test(s))
    return null;
  const [whole, fraction = ""] = s.split(".");
  const n = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
}
function invoiceStatus(value: unknown) {
  return typeof value === "string" &&
    [
      "new",
      "pending",
      "paid",
      "cancelled",
      "cancelled_by_timeout",
      "deleted",
      "error",
    ].includes(value)
    ? value
    : "unknown";
}
// Fixed historical23 diagnostics. Never constructs confirmation input/intent.
export function historicalComparison(
  bookingValue: unknown,
  invoiceValue: unknown,
) {
  const b = record(bookingValue),
    i = record(invoiceValue);
  const lines = Array.isArray(i.lines)
    ? i.lines.map(record).map((line) => ({
        bookingId: scalar(record(line.booking).id),
        bookingCode: scalar(record(line.booking).code),
        totalMinor: minorUnits(line.amount),
        taxMinor: minorUnits(line.tax_amount),
      }))
    : null;
  const booking = {
    id: scalar(b.id),
    code: scalar(b.code),
    confirmed: providerFlag(b.is_confirmed),
    cancelled: providerFlag(b.is_cancelled),
    invoiceId: scalar(b.invoice_id),
    invoiceStatus: invoiceStatus(b.invoice_status),
    start: scalar(b.start_date_time),
    end: scalar(b.end_date_time),
  };
  const invoice = {
    id: scalar(i.id),
    number: scalar(i.number),
    status: invoiceStatus(i.status),
    paymentReceived: providerFlag(i.payment_received),
    currency: scalar(i.currency),
    totalMinor: minorUnits(i.amount),
    taxMinor: minorUnits(i.tax_amount),
    lines,
  };
  return {
    verified: true,
    evidenceKind: "historical_read_only",
    newWritePathVerified: false,
    booking,
    invoice,
    knownInvoiceJoin:
      booking.id !== null &&
      invoice.id !== null &&
      String(booking.invoiceId) === String(invoice.id) &&
      lines !== null &&
      lines.length === 1 &&
      String(lines[0].bookingId) === String(booking.id),
    observedAtMs: Date.now(),
  };
}

// Supplied historical response bodies establish field paths, not current account
// authority. Callers bind these values from authenticated reads and immutable D1.
export type NativeReadContext = {
  attemptId: string;
  intent: unknown;
  association: unknown;
  companyLogin: string;
  timezone: "Asia/Singapore";
  bookingObservedAtMs: number;
  invoiceObservedAtMs: number;
};
function reject(): never {
  throw new ApiError(503, "native_representation_unverified");
}
export function providerId(value: unknown): string {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (typeof text !== "string" || !/^[1-9]\d{0,14}$/.test(text)) reject();
  return text;
}
function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) reject();
}
function flag(value: unknown) {
  const parsed = providerFlag(value);
  if (parsed === null) reject();
  return parsed;
}
function decimal(value: unknown) {
  const parsed = minorUnits(value);
  if (parsed === null) reject();
  return parsed;
}
function single(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) reject();
  const item = record(value[0]);
  if (!Object.keys(item).length) reject();
  return item;
}
function receipt(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) reject();
  return value;
}
// Only booking local wall times have this established Singapore contract.
// Invoice created/due/payment datetimes are deliberately not parsed here.
export function bookingWallTime(value: unknown, timezone: string): number {
  if (
    timezone !== "Asia/Singapore" ||
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  )
    reject();
  const ms = Date.parse(value.replace(" ", "T") + "+08:00");
  if (
    !Number.isFinite(ms) ||
    new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ") !==
      value
  )
    reject();
  return ms;
}
function boundIntent(value: unknown) {
  const intent = intentSchema.parse(value);
  if (
    intent.sessions.length !== 1 ||
    intent.taxMinor !== 0 ||
    intent.sessions[0].taxMinor !== 0
  )
    reject();
  providerId(intent.customerId);
  return intent;
}
function invoiceEvidence(raw: unknown, context: NativeReadContext) {
  const intent = boundIntent(context.intent),
    refs = associationSchema.parse(context.association);
  if (refs.bookingIds.length !== 1) reject();
  const invoice = record(raw),
    line = single(invoice.lines),
    nested = single(line.bookings);
  equal(providerId(invoice.id), refs.invoiceId);
  equal(providerId(invoice.client_id), intent.customerId);
  equal(providerId(line.invoice_id), refs.invoiceId);
  equal(line.type, "booking");
  if (!Array.isArray(line.booking_ids) || line.booking_ids.length !== 1)
    reject();
  equal(providerId(line.booking_ids[0]), refs.bookingIds[0]);
  equal(providerId(nested.id), refs.bookingIds[0]);
  equal(providerId(nested.client_id), intent.customerId);
  const expected = intent.sessions[0];
  equal(providerId(nested.service_id), expected.serviceId);
  equal(providerId(nested.provider_id), expected.instructorId);
  equal(
    bookingWallTime(nested.start_datetime, context.timezone),
    expected.startMs,
  );
  equal(
    bookingWallTime(nested.end_datetime, context.timezone),
    expected.startMs + 50 * 60000,
  );
  equal(providerId(nested.duration), "40");
  const nestedConfirmed = flag(nested.is_confirmed);
  equal(invoice.currency, intent.currency);
  equal(line.currency, intent.currency);
  equal(decimal(invoice.amount), intent.totalMinor);
  equal(decimal(invoice.tax_amount), intent.taxMinor);
  equal(decimal(line.amount), expected.totalMinor);
  equal(decimal(line.tax_amount), expected.taxMinor);
  equal(decimal(line.price), expected.totalMinor);
  equal(decimal(line.price_without_tax), expected.totalMinor);
  equal(decimal(line.final_price), expected.totalMinor);
  equal(decimal(line.qty), 100);
  // Deliberately restricted to the evidenced full-price, zero-tax purchase.
  for (const v of [
    invoice.rest_amount,
    invoice.recurring_amount,
    invoice.discount_amount,
    line.rest_amount,
    line.discount_amount,
    line.recurring_tax_amount,
  ])
    equal(decimal(v), 0);
  equal(flag(invoice.is_with_deposit_amount), false);
  equal(flag(line.is_with_deposit_amount), false);
  equal(decimal(invoice.deposit), intent.totalMinor);
  equal(invoice.refund_datetime, null);
  if (
    !Array.isArray(invoice.taxes) ||
    invoice.taxes.length !== 0 ||
    !Array.isArray(line.tickets) ||
    line.tickets.length !== 0
  )
    reject();
  const received = flag(invoice.payment_received);
  let status: "paid" | "unpaid" | "unknown" = "unknown";
  if (
    invoice.status === "paid" &&
    received &&
    invoice.payment_processor === "hitpay"
  )
    status = "paid";
  else if (
    invoice.status === "new" &&
    !received &&
    invoice.payment_processor === null
  )
    status = "unpaid";
  return {
    invoice: {
      accountId: intent.accountId,
      environmentId: intent.environmentId,
      attemptId: context.attemptId,
      customerId: intent.customerId,
      observedAtMs: receipt(context.invoiceObservedAtMs),
      invoiceId: refs.invoiceId,
      money: {
        currency: intent.currency,
        totalMinor: intent.totalMinor,
        taxMinor: intent.taxMinor,
      },
      lines: [
        {
          bookingId: refs.bookingIds[0],
          money: {
            currency: intent.currency,
            totalMinor: expected.totalMinor,
            taxMinor: expected.taxMinor,
          },
        },
      ],
      status,
      paymentReceived: received,
    },
    nestedConfirmed,
    lineId: providerId(line.id),
  };
}
export function normalizeNativeReads(
  bookingValue: unknown,
  invoiceValue: unknown,
  context: NativeReadContext,
) {
  const intent = boundIntent(context.intent),
    refs = associationSchema.parse(context.association);
  const booking = record(bookingValue),
    expected = intent.sessions[0];
  const normalized = invoiceEvidence(invoiceValue, context);
  equal(providerId(booking.id), refs.bookingIds[0]);
  equal(providerId(booking.invoice_id), refs.invoiceId);
  equal(providerId(booking.invoice_line_id), normalized.lineId);
  equal(providerId(booking.client_id), intent.customerId);
  if (!context.companyLogin || context.companyLogin.includes("[")) reject();
  equal(booking.company_login, context.companyLogin);
  equal(providerId(booking.event_id), expected.serviceId);
  equal(providerId(booking.unit_id), expected.instructorId);
  equal(providerId(booking.event_duration), "40");
  equal(decimal(booking.event_buffertime_before), 0);
  equal(decimal(booking.event_buffertime_after), 1000);
  equal(
    bookingWallTime(booking.start_date_time, context.timezone),
    expected.startMs,
  );
  equal(
    bookingWallTime(booking.end_date_time, context.timezone),
    expected.startMs + 50 * 60000,
  );
  equal(decimal(booking.event_price), expected.totalMinor);
  equal(decimal(booking.invoice_line_amount), expected.totalMinor);
  equal(decimal(booking.invoice_amount), intent.totalMinor);
  equal(booking.event_currency, intent.currency);
  equal(booking.invoice_currency, intent.currency);
  const confirmed = flag(booking.is_confirmed);
  let status: ConfirmationInput["bookings"][number]["status"] = "unknown";
  if (booking.status === "confirmed" && confirmed && normalized.nestedConfirmed)
    status = "confirmed";
  else if (booking.status === "cancelled" && !confirmed) status = "cancelled";
  else if (!confirmed || !normalized.nestedConfirmed) status = "invalid";
  // Conflicting reads remain unknown; invoice numbers may legitimately change.
  if (
    flag(booking.invoice_payment_received) !==
      normalized.invoice.paymentReceived ||
    booking.invoice_status !== record(invoiceValue).status ||
    booking.invoice_payment_processor !== record(invoiceValue).payment_processor
  )
    normalized.invoice.status = "unknown";
  return {
    invoice: normalized.invoice,
    bookings: [
      {
        accountId: intent.accountId,
        environmentId: intent.environmentId,
        attemptId: context.attemptId,
        customerId: intent.customerId,
        invoiceId: refs.invoiceId,
        observedAtMs: receipt(context.bookingObservedAtMs),
        session: {
          bookingId: refs.bookingIds[0],
          serviceId: expected.serviceId,
          instructorId: expected.instructorId,
          startMs: expected.startMs,
          playEndMs: expected.startMs + 40 * 60000,
          occupiedStartMs: expected.startMs,
          occupiedEndMs: expected.startMs + 50 * 60000,
        },
        status,
      },
    ],
  };
}
export function normalizeNativeCreation(
  raw: unknown,
  context: Omit<NativeReadContext, "association">,
) {
  const response = record(raw),
    booking = single(response.bookings),
    invoice = record(response.invoice);
  equal(flag(response.require_confirm), false);
  // require_payment is checked for representation only, never used as paid evidence.
  flag(booking.require_payment);
  equal(flag(booking.is_confirmed), true);
  const intent = boundIntent(context.intent),
    expected = intent.sessions[0];
  const association = {
    bookingIds: [providerId(booking.id)],
    invoiceId: providerId(invoice.id),
  };
  const normalized = invoiceEvidence(invoice, { ...context, association });
  equal(normalized.nestedConfirmed, true);
  equal(normalized.invoice.status, "unpaid");
  equal(providerId(booking.client_id), intent.customerId);
  equal(providerId(booking.event_id), expected.serviceId);
  equal(providerId(booking.unit_id), expected.instructorId);
  equal(
    bookingWallTime(booking.start_date_time, context.timezone),
    expected.startMs,
  );
  equal(
    bookingWallTime(booking.end_date_time, context.timezone),
    expected.startMs + 50 * 60000,
  );
  if (
    typeof booking.hash !== "string" ||
    !/^[A-Za-z0-9_-]{8,256}$/.test(booking.hash)
  )
    reject();
  return {
    association,
    bookingHash: booking.hash,
    invoice: normalized.invoice,
  };
}
