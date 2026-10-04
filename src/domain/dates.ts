export function todaySG(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function monthAt(date: string, offset: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1, 12),
  )
    .toISOString()
    .slice(0, 10);
}
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
export function clockMinutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function clock(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function endTime(start: string, duration = 40) {
  return clock(clockMinutes(start) + duration);
}
export function isDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function money(cents: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
