import {
  START_INTERVAL_MINUTES,
  SESSION_MINUTES,
  CHANGEOVER_MINUTES,
} from "../src/domain/booking-policy";
import type { ConfirmationInput } from "../src/domain/confirmation";
import { z } from "zod";
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
export type NativeValidationField =
  | "association"
  | "association.bookingIds"
  | "association.nativeCustomerId"
  | "batch.id"
  | "booking"
  | "booking.client_id"
  | "booking.company_login"
  | "booking.count"
  | "booking.end_date_time"
  | "booking.event_buffertime_after"
  | "booking.event_buffertime_before"
  | "booking.event_currency"
  | "booking.event_duration"
  | "booking.event_id"
  | "booking.event_price"
  | "booking.id"
  | "booking.invoice_amount"
  | "booking.invoice_currency"
  | "booking.invoice_id"
  | "booking.invoice_line_amount"
  | "booking.invoice_line_id"
  | "booking.invoice_payment_received"
  | "booking.is_confirmed"
  | "booking.start_date_time"
  | "booking.unique_ids"
  | "booking.unit_id"
  | "booking.wall_time"
  | "context.bookingObservedAtMs"
  | "context.companyLogin"
  | "context.invoiceObservedAtMs"
  | "context.timezone"
  | "creation"
  | "creation.batch_hash"
  | "creation.batch_id"
  | "creation.booking"
  | "creation.booking.client_hash"
  | "creation.booking.client_id"
  | "creation.booking.end_date_time"
  | "creation.booking.event_id"
  | "creation.booking.hash"
  | "creation.booking.id"
  | "creation.booking.is_confirmed"
  | "creation.booking.require_payment"
  | "creation.booking.start_date_time"
  | "creation.booking.unit_id"
  | "creation.bookings"
  | "creation.invoice"
  | "creation.invoice.status"
  | "creation.phase"
  | "creation.require_confirm"
  | "creation.session_index"
  | "creation.session_match"
  | "intent"
  | "intent.contact"
  | "intent.customerId"
  | "intent.taxMinor"
  | "intent.sessions.taxMinor"
  | "invoice"
  | "invoice.amount"
  | "invoice.client_id"
  | "invoice.currency"
  | "invoice.deposit"
  | "invoice.deposit_child_invoice"
  | "invoice.deposit_is_client_can_pay_later"
  | "invoice.deposit_parent_invoice"
  | "invoice.discount_amount"
  | "invoice.id"
  | "invoice.is_with_deposit_amount"
  | "invoice.line"
  | "invoice.line.amount"
  | "invoice.line.booking.client_id"
  | "invoice.line.booking.duration"
  | "invoice.line.booking.end_datetime"
  | "invoice.line.booking.id"
  | "invoice.line.booking.is_confirmed"
  | "invoice.line.booking.provider_id"
  | "invoice.line.booking.service_id"
  | "invoice.line.booking.start_datetime"
  | "invoice.line.booking_ids"
  | "invoice.line.bookings"
  | "invoice.line.currency"
  | "invoice.line.discount"
  | "invoice.line.discount_amount"
  | "invoice.line.discount_ratio"
  | "invoice.line.final_price"
  | "invoice.line.id"
  | "invoice.line.invoice_id"
  | "invoice.line.is_with_deposit_amount"
  | "invoice.line.package_qty"
  | "invoice.line.price"
  | "invoice.line.price_without_tax"
  | "invoice.line.qty"
  | "invoice.line.recurring_price_without_tax"
  | "invoice.line.recurring_tax_amount"
  | "invoice.line.rest_amount"
  | "invoice.line.tax_amount"
  | "invoice.line.tax_ratio"
  | "invoice.line.tickets"
  | "invoice.line.type"
  | "invoice.lines"
  | "invoice.lines.booking_set"
  | "invoice.lines.unique_ids"
  | "invoice.payment_received"
  | "invoice.recurring_amount"
  | "invoice.recurring_profile_id"
  | "invoice.refund_datetime"
  | "invoice.require_recurring_payment_method"
  | "invoice.rest_amount"
  | "invoice.tax_amount"
  | "invoice.taxes"
  | "invoice.tip"
  | "provider.id";

// Only fixed source-owned field/rule names enter private diagnostics. Never copy
// a provider value, Zod issue path/message, exception message or expected value.
// This subclass is caught inside the coordinator before RPC; the existing
// ApiError/RpcOutcome/HTTP contract still carries only the generic status/code.
class NativeValidationError extends ApiError {
  constructor(
    readonly reason: NativeValidationReason,
    status = 503,
    code = "native_representation_unverified",
  ) {
    super(status, code);
  }
}
export type NativeValidationReason = {
  field: NativeValidationField;
  problem: "missing" | "malformed" | "mismatch";
};
export function nativeValidationReason(error: unknown) {
  return error instanceof NativeValidationError
    ? { field: error.reason.field, problem: error.reason.problem }
    : undefined;
}
export function rejectNative(
  field: NativeValidationField,
  problem: NativeValidationReason["problem"],
  status: 409 | 503 = 503,
  code:
    | "native_representation_unverified"
    | "native_batch_mismatch"
    | "native_recovery_association_conflict" = "native_representation_unverified",
): never {
  throw new NativeValidationError({ field, problem }, status, code);
}
function invalid(value: unknown, field: NativeValidationField): never {
  return rejectNative(field, value == null ? "missing" : "malformed");
}
export function nativeRecord(
  value: unknown,
  field: NativeValidationField,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(value, field);
  return value as Record<string, unknown>;
}
export function nativeArray(
  value: unknown,
  count: number,
  field: NativeValidationField,
): unknown[] {
  if (!Array.isArray(value)) invalid(value, field);
  if (value.length !== count) rejectNative(field, "mismatch");
  return value;
}
export function providerId(
  value: unknown,
  field: NativeValidationField = "provider.id",
): string {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (typeof text !== "string" || !/^[1-9]\d{0,14}$/.test(text))
    invalid(value, field);
  return text;
}
export function nativeHash(
  value: unknown,
  field: NativeValidationField,
): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,256}$/.test(value))
    invalid(value, field);
  return value;
}
function equal(
  actual: unknown,
  expected: unknown,
  field: NativeValidationField,
) {
  if (actual !== expected)
    rejectNative(
      field,
      actual == null
        ? "missing"
        : typeof actual !== typeof expected && expected !== null
          ? "malformed"
          : "mismatch",
    );
}
function flag(value: unknown, field: NativeValidationField) {
  const parsed = providerFlag(value);
  if (parsed === null) invalid(value, field);
  return parsed;
}
function decimal(value: unknown, field: NativeValidationField) {
  const parsed = minorUnits(value);
  if (parsed === null) invalid(value, field);
  return parsed;
}
export function nativeSingle(
  value: unknown,
  field: NativeValidationField,
): Record<string, unknown> {
  const item = nativeRecord(nativeArray(value, 1, field)[0], field);
  if (!Object.keys(item).length) rejectNative(field, "malformed");
  return item;
}
function receipt(value: number, field: NativeValidationField) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(value, field);
  return value;
}
function nativeSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  field: NativeValidationField,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) invalid(value, field);
  return parsed.data;
}
// Only booking local wall times have this established Singapore contract.
// Invoice created/due/payment datetimes are deliberately not parsed here.
export function bookingWallTime(
  value: unknown,
  timezone: string,
  field: NativeValidationField = "booking.wall_time",
): number {
  if (timezone !== "Asia/Singapore")
    rejectNative("context.timezone", "mismatch");
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  )
    invalid(value, field);
  const ms = Date.parse(value.replace(" ", "T") + "+08:00");
  if (
    !Number.isFinite(ms) ||
    new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ") !==
      value
  )
    invalid(value, field);
  return ms;
}
function boundIntent(value: unknown) {
  const intent = nativeSchema(intentSchema, value, "intent");
  if (intent.taxMinor !== 0) rejectNative("intent.taxMinor", "mismatch");
  if (intent.sessions.some((session) => session.taxMinor !== 0))
    rejectNative("intent.sessions.taxMinor", "mismatch");
  if (intent.customerMode !== "booking-contact")
    providerId(intent.customerId, "intent.customerId");
  else if (!intent.contact) rejectNative("intent.contact", "missing");
  return intent;
}
function invoiceEvidence(raw: unknown, context: NativeReadContext) {
  const intent = boundIntent(context.intent),
    refs = nativeSchema(associationSchema, context.association, "association");
  if (refs.bookingIds.length !== intent.sessions.length)
    rejectNative("association.bookingIds", "mismatch");
  const nativeCustomerId =
    intent.customerMode === "booking-contact"
      ? providerId(refs.nativeCustomerId, "association.nativeCustomerId")
      : providerId(intent.customerId, "intent.customerId");
  const invoice = nativeRecord(raw, "invoice");
  equal(providerId(invoice.id, "invoice.id"), refs.invoiceId, "invoice.id");
  equal(
    providerId(invoice.client_id, "invoice.client_id"),
    nativeCustomerId,
    "invoice.client_id",
  );
  equal(invoice.currency, intent.currency, "invoice.currency");
  equal(
    decimal(invoice.amount, "invoice.amount"),
    intent.totalMinor,
    "invoice.amount",
  );
  equal(
    decimal(invoice.tax_amount, "invoice.tax_amount"),
    intent.taxMinor,
    "invoice.tax_amount",
  );
  for (const key of [
    "rest_amount",
    "recurring_amount",
    "discount_amount",
  ] as const)
    equal(decimal(invoice[key], `invoice.${key}`), 0, `invoice.${key}`);
  equal(
    flag(invoice.is_with_deposit_amount, "invoice.is_with_deposit_amount"),
    false,
    "invoice.is_with_deposit_amount",
  );
  equal(
    decimal(invoice.deposit, "invoice.deposit"),
    intent.totalMinor,
    "invoice.deposit",
  );
  equal(invoice.refund_datetime, null, "invoice.refund_datetime");
  equal(invoice.deposit_child_invoice, null, "invoice.deposit_child_invoice");
  equal(invoice.deposit_parent_invoice, null, "invoice.deposit_parent_invoice");
  equal(invoice.recurring_profile_id, null, "invoice.recurring_profile_id");
  equal(invoice.tip, null, "invoice.tip");
  equal(
    flag(
      invoice.require_recurring_payment_method,
      "invoice.require_recurring_payment_method",
    ),
    false,
    "invoice.require_recurring_payment_method",
  );
  equal(
    flag(
      invoice.deposit_is_client_can_pay_later,
      "invoice.deposit_is_client_can_pay_later",
    ),
    false,
    "invoice.deposit_is_client_can_pay_later",
  );
  nativeArray(invoice.taxes, 0, "invoice.taxes");
  const rawLines = nativeArray(
    invoice.lines,
    refs.bookingIds.length,
    "invoice.lines",
  );
  // One evidenced quantity-one invoice line per reserved studio session.
  // Grouped quantities/add-ons remain unsupported, never partially accepted.
  const lines = rawLines.map((rawLine) => {
    const line = nativeRecord(rawLine, "invoice.line"),
      nested = nativeSingle(line.bookings, "invoice.line.bookings");
    const bookingId = providerId(nested.id, "invoice.line.booking.id"),
      index = refs.bookingIds.indexOf(bookingId);
    if (index < 0) rejectNative("invoice.line.booking.id", "mismatch");
    const expected = intent.sessions[index];
    equal(
      providerId(line.invoice_id, "invoice.line.invoice_id"),
      refs.invoiceId,
      "invoice.line.invoice_id",
    );
    equal(line.type, "booking", "invoice.line.type");
    const lineBookingIds = nativeArray(
      line.booking_ids,
      1,
      "invoice.line.booking_ids",
    );
    equal(
      providerId(lineBookingIds[0], "invoice.line.booking_ids"),
      bookingId,
      "invoice.line.booking_ids",
    );
    equal(
      providerId(nested.id, "invoice.line.booking.id"),
      bookingId,
      "invoice.line.booking.id",
    );
    equal(
      providerId(nested.client_id, "invoice.line.booking.client_id"),
      nativeCustomerId,
      "invoice.line.booking.client_id",
    );
    equal(
      providerId(nested.service_id, "invoice.line.booking.service_id"),
      expected.serviceId,
      "invoice.line.booking.service_id",
    );
    equal(
      providerId(nested.provider_id, "invoice.line.booking.provider_id"),
      expected.instructorId,
      "invoice.line.booking.provider_id",
    );
    equal(
      bookingWallTime(
        nested.start_datetime,
        context.timezone,
        "invoice.line.booking.start_datetime",
      ),
      expected.startMs,
      "invoice.line.booking.start_datetime",
    );
    equal(
      bookingWallTime(
        nested.end_datetime,
        context.timezone,
        "invoice.line.booking.end_datetime",
      ),
      expected.startMs + START_INTERVAL_MINUTES * 60000,
      "invoice.line.booking.end_datetime",
    );
    equal(
      providerId(nested.duration, "invoice.line.booking.duration"),
      String(SESSION_MINUTES),
      "invoice.line.booking.duration",
    );
    equal(line.currency, intent.currency, "invoice.line.currency");
    equal(
      decimal(line.amount, "invoice.line.amount"),
      expected.totalMinor,
      "invoice.line.amount",
    );
    equal(
      decimal(line.tax_amount, "invoice.line.tax_amount"),
      expected.taxMinor,
      "invoice.line.tax_amount",
    );
    equal(
      decimal(line.price, "invoice.line.price"),
      expected.totalMinor,
      "invoice.line.price",
    );
    equal(
      decimal(line.price_without_tax, "invoice.line.price_without_tax"),
      expected.totalMinor,
      "invoice.line.price_without_tax",
    );
    equal(
      decimal(line.final_price, "invoice.line.final_price"),
      expected.totalMinor,
      "invoice.line.final_price",
    );
    equal(decimal(line.qty, "invoice.line.qty"), 100, "invoice.line.qty");
    for (const key of [
      "rest_amount",
      "discount_amount",
      "recurring_tax_amount",
      "recurring_price_without_tax",
      "package_qty",
      "discount_ratio",
      "discount",
      "tax_ratio",
    ] as const)
      equal(
        decimal(line[key], `invoice.line.${key}`),
        0,
        `invoice.line.${key}`,
      );
    equal(
      flag(line.is_with_deposit_amount, "invoice.line.is_with_deposit_amount"),
      false,
      "invoice.line.is_with_deposit_amount",
    );
    nativeArray(line.tickets, 0, "invoice.line.tickets");
    return {
      bookingId,
      lineId: providerId(line.id, "invoice.line.id"),
      nestedConfirmed: flag(
        nested.is_confirmed,
        "invoice.line.booking.is_confirmed",
      ),
      money: {
        currency: intent.currency,
        totalMinor: expected.totalMinor,
        taxMinor: expected.taxMinor,
      },
    };
  });
  if (
    new Set(lines.map((line) => line.bookingId)).size !== refs.bookingIds.length
  )
    rejectNative("invoice.lines.booking_set", "mismatch");
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length)
    rejectNative("invoice.lines.unique_ids", "mismatch");
  const received = flag(invoice.payment_received, "invoice.payment_received");
  let status: "paid" | "unpaid" | "cancelled" | "unknown" = "unknown";
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
  else if (
    invoice.status === "cancelled" &&
    !received &&
    invoice.payment_processor === null
  )
    status = "cancelled";
  return {
    invoice: {
      accountId: intent.accountId,
      environmentId: intent.environmentId,
      attemptId: context.attemptId,
      customerId: intent.customerId,
      observedAtMs: receipt(
        context.invoiceObservedAtMs,
        "context.invoiceObservedAtMs",
      ),
      invoiceId: refs.invoiceId,
      money: {
        currency: intent.currency,
        totalMinor: intent.totalMinor,
        taxMinor: intent.taxMinor,
      },
      lines: refs.bookingIds.map((id) => {
        const line = lines.find((entry) => entry.bookingId === id)!;
        return { bookingId: id, money: line.money };
      }),
      status,
      paymentReceived: received,
    },
    lines,
  };
}
export function normalizeNativeReads(
  bookingValue: unknown,
  invoiceValue: unknown,
  context: NativeReadContext,
) {
  const intent = boundIntent(context.intent),
    refs = nativeSchema(associationSchema, context.association, "association");
  const normalized = invoiceEvidence(invoiceValue, context);
  const values = Array.isArray(bookingValue) ? bookingValue : [bookingValue];
  if (values.length !== intent.sessions.length)
    rejectNative("booking.count", "mismatch");
  const seen = new Set<string>();
  const bookings = values.map((value) => {
    const booking = nativeRecord(value, "booking"),
      bookingId = providerId(booking.id, "booking.id"),
      index = refs.bookingIds.indexOf(bookingId);
    if (index < 0) rejectNative("booking.id", "mismatch");
    if (seen.has(bookingId)) rejectNative("booking.unique_ids", "mismatch");
    seen.add(bookingId);
    const expected = intent.sessions[index],
      line = normalized.lines.find((entry) => entry.bookingId === bookingId)!;
    equal(providerId(booking.id, "booking.id"), bookingId, "booking.id");
    equal(
      providerId(booking.invoice_id, "booking.invoice_id"),
      refs.invoiceId,
      "booking.invoice_id",
    );
    equal(
      providerId(booking.invoice_line_id, "booking.invoice_line_id"),
      line.lineId,
      "booking.invoice_line_id",
    );
    equal(
      providerId(booking.client_id, "booking.client_id"),
      intent.customerMode === "booking-contact"
        ? providerId(refs.nativeCustomerId, "association.nativeCustomerId")
        : intent.customerId,
      "booking.client_id",
    );
    if (!context.companyLogin || context.companyLogin.includes("["))
      invalid(context.companyLogin, "context.companyLogin");
    equal(booking.company_login, context.companyLogin, "booking.company_login");
    equal(
      providerId(booking.event_id, "booking.event_id"),
      expected.serviceId,
      "booking.event_id",
    );
    equal(
      providerId(booking.unit_id, "booking.unit_id"),
      expected.instructorId,
      "booking.unit_id",
    );
    equal(
      providerId(booking.event_duration, "booking.event_duration"),
      String(SESSION_MINUTES),
      "booking.event_duration",
    );
    equal(
      decimal(
        booking.event_buffertime_before,
        "booking.event_buffertime_before",
      ),
      0,
      "booking.event_buffertime_before",
    );
    equal(
      decimal(booking.event_buffertime_after, "booking.event_buffertime_after"),
      CHANGEOVER_MINUTES * 100,
      "booking.event_buffertime_after",
    );
    equal(
      bookingWallTime(
        booking.start_date_time,
        context.timezone,
        "booking.start_date_time",
      ),
      expected.startMs,
      "booking.start_date_time",
    );
    equal(
      bookingWallTime(
        booking.end_date_time,
        context.timezone,
        "booking.end_date_time",
      ),
      expected.startMs + START_INTERVAL_MINUTES * 60000,
      "booking.end_date_time",
    );
    equal(
      decimal(booking.event_price, "booking.event_price"),
      expected.totalMinor,
      "booking.event_price",
    );
    equal(
      decimal(booking.invoice_line_amount, "booking.invoice_line_amount"),
      expected.totalMinor,
      "booking.invoice_line_amount",
    );
    equal(
      decimal(booking.invoice_amount, "booking.invoice_amount"),
      intent.totalMinor,
      "booking.invoice_amount",
    );
    equal(booking.event_currency, intent.currency, "booking.event_currency");
    equal(
      booking.invoice_currency,
      intent.currency,
      "booking.invoice_currency",
    );
    const confirmed = flag(booking.is_confirmed, "booking.is_confirmed");
    let status: ConfirmationInput["bookings"][number]["status"] = "unknown";
    if (booking.status === "confirmed" && confirmed && line.nestedConfirmed)
      status = "confirmed";
    else if (booking.status === "cancelled" && !confirmed) status = "cancelled";
    else if (!confirmed || !line.nestedConfirmed) status = "invalid";
    // Conflicting reads remain unknown; invoice numbers may legitimately change.
    if (
      flag(
        booking.invoice_payment_received,
        "booking.invoice_payment_received",
      ) !== normalized.invoice.paymentReceived ||
      booking.invoice_status !== record(invoiceValue).status ||
      booking.invoice_payment_processor !==
        record(invoiceValue).payment_processor
    )
      normalized.invoice.status = "unknown";
    return {
      accountId: intent.accountId,
      environmentId: intent.environmentId,
      attemptId: context.attemptId,
      customerId: intent.customerId,
      invoiceId: refs.invoiceId,
      observedAtMs: receipt(
        context.bookingObservedAtMs,
        "context.bookingObservedAtMs",
      ),
      session: {
        bookingId: bookingId,
        serviceId: expected.serviceId,
        instructorId: expected.instructorId,
        startMs: expected.startMs,
        playEndMs: expected.startMs + SESSION_MINUTES * 60000,
        occupiedStartMs: expected.startMs,
        occupiedEndMs: expected.startMs + START_INTERVAL_MINUTES * 60000,
      },
      status,
    };
  });
  return { invoice: normalized.invoice, bookings };
}
// A partial batch response is evidence only for its exact selected session.
// It cannot establish an invoice or payment authority.
export function normalizeNativeSession(
  raw: unknown,
  context: Pick<NativeReadContext, "intent" | "timezone"> & {
    nativeCustomerId?: string;
  },
  sessionIndex: number,
  phase: "batch-item" | "finalized" = "finalized",
) {
  const response = nativeRecord(raw, "creation"),
    booking = nativeSingle(response.bookings, "creation.bookings"),
    intent = boundIntent(context.intent);
  const expected = intent.sessions[sessionIndex];
  if (!Number.isInteger(sessionIndex) || !expected)
    rejectNative("creation.session_index", "malformed");
  const requiresConfirmation = flag(
    response.require_confirm,
    "creation.require_confirm",
  );
  // A batch item is an allocation receipt, not a finalized invoice. The
  // provider may still require confirmation until closeBatch. Never carry
  // that allowance into single-booking or finalization validation.
  if (phase === "batch-item") {
    if (intent.sessions.length < 2) rejectNative("creation.phase", "mismatch");
  } else equal(requiresConfirmation, false, "creation.require_confirm");
  flag(booking.require_payment, "creation.booking.require_payment");
  equal(
    flag(booking.is_confirmed, "creation.booking.is_confirmed"),
    true,
    "creation.booking.is_confirmed",
  );
  const nativeCustomerId = providerId(
    booking.client_id,
    "creation.booking.client_id",
  );
  if (intent.customerMode !== "booking-contact")
    equal(nativeCustomerId, intent.customerId, "creation.booking.client_id");
  else if (context.nativeCustomerId !== undefined)
    equal(
      nativeCustomerId,
      context.nativeCustomerId,
      "creation.booking.client_id",
    );
  equal(
    providerId(booking.event_id, "creation.booking.event_id"),
    expected.serviceId,
    "creation.booking.event_id",
  );
  equal(
    providerId(booking.unit_id, "creation.booking.unit_id"),
    expected.instructorId,
    "creation.booking.unit_id",
  );
  equal(
    bookingWallTime(
      booking.start_date_time,
      context.timezone,
      "creation.booking.start_date_time",
    ),
    expected.startMs,
    "creation.booking.start_date_time",
  );
  equal(
    bookingWallTime(
      booking.end_date_time,
      context.timezone,
      "creation.booking.end_date_time",
    ),
    expected.startMs + START_INTERVAL_MINUTES * 60000,
    "creation.booking.end_date_time",
  );
  const hash = nativeHash(booking.hash, "creation.booking.hash");
  return {
    bookingId: providerId(booking.id, "creation.booking.id"),
    hash,
    nativeCustomerId,
  };
}
export function normalizeNativeCreation(
  raw: unknown,
  context: Omit<NativeReadContext, "association">,
) {
  const response = nativeRecord(raw, "creation"),
    invoice = nativeRecord(response.invoice, "creation.invoice"),
    intent = boundIntent(context.intent);
  equal(
    flag(response.require_confirm, "creation.require_confirm"),
    false,
    "creation.require_confirm",
  );
  const remaining = [
    ...nativeArray(
      response.bookings,
      intent.sessions.length,
      "creation.bookings",
    ),
  ];
  const keys = intent.sessions.map((session, index) => {
    const matched = remaining.findIndex((value) => {
      const booking = nativeRecord(value, "creation.booking");
      return (
        providerId(booking.event_id, "creation.booking.event_id") ===
          session.serviceId &&
        providerId(booking.unit_id, "creation.booking.unit_id") ===
          session.instructorId &&
        bookingWallTime(
          booking.start_date_time,
          context.timezone,
          "creation.booking.start_date_time",
        ) === session.startMs
      );
    });
    if (matched < 0) rejectNative("creation.session_match", "mismatch");
    const booking = remaining.splice(matched, 1)[0];
    return normalizeNativeSession(
      { require_confirm: response.require_confirm, bookings: [booking] },
      context,
      index,
    );
  });
  if (keys.some((key) => key.nativeCustomerId !== keys[0].nativeCustomerId))
    rejectNative("creation.booking.client_id", "mismatch");
  const association = {
    bookingIds: keys.map((key) => key.bookingId),
    invoiceId: providerId(invoice.id, "invoice.id"),
    ...(intent.customerMode === "booking-contact"
      ? { nativeCustomerId: keys[0].nativeCustomerId }
      : {}),
  };
  const normalized = invoiceEvidence(invoice, { ...context, association });
  if (normalized.lines.some((line) => !line.nestedConfirmed))
    rejectNative("invoice.line.booking.is_confirmed", "mismatch");
  equal(normalized.invoice.status, "unpaid", "creation.invoice.status");
  return {
    association,
    bookingHash: keys[0].hash,
    bookingKeys: keys,
    invoice: normalized.invoice,
  };
}
