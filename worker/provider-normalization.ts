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
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ""] = s.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(n) ? n : null;
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
