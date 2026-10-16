import { ApiError } from "./policy";
import { providerFlag } from "./provider-normalization";
import { traceId } from "./diagnostics";

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const kind = (value: unknown) =>
  value === undefined
    ? "missing"
    : value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : typeof value;
const flag = (value: unknown) => ({
  kind: kind(value),
  value: providerFlag(value),
});
const id = (value: unknown) =>
  (typeof value === "string" || typeof value === "number") &&
  /^[1-9]\d{0,15}$/.test(String(value))
    ? String(value)
    : null;
const status = (value: unknown) =>
  typeof value === "string" &&
  [
    "new",
    "pending",
    "unconfirmed",
    "confirmed",
    "paid",
    "cancelled",
    "cancelled_by_timeout",
    "deleted",
    "error",
  ].includes(value)
    ? value
    : kind(value) === "missing"
      ? "missing"
      : "unrecognized";
const expiry = (value: unknown) => ({
  kind: kind(value),
  value:
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(
      value,
    )
      ? value
      : null,
});
function booking(value: unknown) {
  const b = object(value);
  return {
    id: id(b.id),
    status: status(b.status),
    isConfirmed: flag(b.is_confirmed),
    isCancelled: flag(b.is_cancelled),
    requirePayment: flag(b.require_payment),
    requireConfirm: flag(b.require_confirm),
    invoiceId: id(b.invoice_id),
    invoiceStatus: status(b.invoice_status),
  };
}
function invoice(value: unknown) {
  const i = object(value);
  return {
    kind: kind(value),
    id: id(i.id),
    status: status(i.status),
    paymentReceived: flag(i.payment_received),
    dueDatetime: expiry(i.due_datetime),
    lines: Array.isArray(i.lines)
      ? i.lines.slice(0, 12).map((value) => {
          const line = object(value);
          return {
            invoiceId: id(line.invoice_id),
            bookingId: id(object(line.booking).id),
            bookingIds: Array.isArray(line.booking_ids)
              ? line.booking_ids.slice(0, 12).map(id)
              : null,
            bookings: Array.isArray(line.bookings)
              ? line.bookings.slice(0, 12).map(booking)
              : line.booking
                ? [booking(line.booking)]
                : [],
          };
        })
      : null,
  };
}
// Private observational evidence only. Persist before strict normalization; never
// feed these fields into booking authority or expose them in customer responses.
export async function retainHoldEvidence(
  db: D1Database,
  attemptId: string,
  operation: string,
  body: unknown,
  observedAtMs: number,
) {
  if (
    !["book", "batch-close", "booking-read", "invoice-read"].includes(operation)
  )
    return;
  const envelope = object(body);
  const evidence = {
    version: 1,
    operation,
    observedAtMs,
    correlationId: traceId(),
    requireConfirm: flag(envelope.require_confirm),
    bookings:
      operation === "booking-read"
        ? [booking(body)]
        : Array.isArray(envelope.bookings)
          ? envelope.bookings.slice(0, 12).map(booking)
          : [],
    invoice: invoice(operation === "invoice-read" ? body : envelope.invoice),
  };
  const saved = await db
    .prepare(
      "UPDATE native_checkout_grants SET result_json=json_insert(CASE WHEN json_type(COALESCE(result_json,'{}'),'$.holdEvidence')='array' THEN result_json ELSE json_set(COALESCE(result_json,'{}'),'$.holdEvidence',json('[]')) END,'$.holdEvidence[#]',json(?)) WHERE attempt_id=? AND state='running' AND COALESCE(json_array_length(result_json,'$.holdEvidence'),0)<32",
    )
    .bind(JSON.stringify(evidence), attemptId)
    .run();
  if (saved.meta.changes !== 1)
    throw new ApiError(503, "native_hold_evidence_unavailable");
}
