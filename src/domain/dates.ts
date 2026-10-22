import { SESSION_MINUTES } from "./booking-policy";
/** Return today's calendar date in Singapore time. */
export function todaySG(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** Shift a calendar date by the requested number of days. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
/** Resolve a month relative to the supplied calendar date. */
export function monthAt(date: string, offset: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1, 12),
  )
    .toISOString()
    .slice(0, 10);
}
/** Format a calendar date for customer-facing display. */
export function dateLabel(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  },
) {
  return new Intl.DateTimeFormat("en-SG", {
    ...options,
    timeZone: "Asia/Singapore",
  }).format(new Date(`${date}T04:00:00Z`));
}
/** Convert a clock string into minutes after midnight. */
export function clockMinutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
/** Format minutes after midnight as a clock string. */
export function clock(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
/** Calculate the displayed session end time. */
export function endTime(start: string, duration = SESSION_MINUTES) {
  return clock(clockMinutes(start) + duration);
}
/** Check whether a value represents a valid calendar date. */
export function isDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
/** Format an amount for customer-facing currency display. */
export function money(cents: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
