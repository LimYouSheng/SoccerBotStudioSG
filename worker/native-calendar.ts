import { z } from "zod";
import {
  nativeCalendarSchema,
  type nativeOfferSchema,
} from "../src/domain/native-checkout";
import type { ProviderCatalogue } from "../src/domain/catalog";
import type { NativeExchange } from "./provider-transport";
import { ApiError } from "./policy";
import { offeredStarts } from "./prebooking";
import { freshReceipt } from "./catalogue";

export const CALENDAR_CACHE_MS = 60000;
const dayMs = 86400000;
const dateMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
/** Enumerate the dates covered by the requested calendar range. */
export function calendarDates(month: string, approved: string[]) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new ApiError(400, "calendar_month_invalid");
  return [...new Set(approved)]
    .filter((date) => date.startsWith(month + "-"))
    .sort();
}
// Do not bridge unapproved gaps; each request is at most the existing 15-day
// transport bound. Four months therefore need ranges, not 120 daily reads.
/** Partition calendar dates into supported provider query ranges. */
export function calendarRanges(dates: string[]) {
  const ranges: { from: string; to: string; dates: string[] }[] = [];
  for (const date of dates) {
    const ms = dateMs(date);
    if (
      !Number.isFinite(ms) ||
      new Date(ms).toISOString().slice(0, 10) !== date
    )
      throw new ApiError(400, "calendar_date_invalid");
    const last = ranges.at(-1);
    if (last && ms - dateMs(last.to) === dayMs && last.dates.length < 15) {
      last.to = date;
      last.dates.push(date);
    } else ranges.push({ from: date, to: date, dates: [date] });
  }
  return ranges;
}
type Calendar = z.infer<typeof nativeCalendarSchema>;
// One instance belongs to the existing account coordinator. No process-global
// customer cache, new database or silent stale fallback. No personal data.
export class NativeCalendarReads {
  private entries = new Map<
    string,
    { value?: Calendar; pending?: Promise<Calendar> }
  >();
  invalidate() {
    this.entries.clear();
  }
  invalidateDate(date: string) {
    for (const key of this.entries.keys()) {
      const scope: unknown = JSON.parse(key);
      if (
        Array.isArray(scope) &&
        Array.isArray(scope[3]) &&
        scope[3].includes(date)
      )
        this.entries.delete(key);
    }
  }
  /** Read native calendar availability within the authorized query scope. */
  async read(input: {
    scope: string;
    month: string;
    serviceId: string;
    dates: string[];
    cacheOnly?: boolean;
    catalogue: () => Promise<ProviderCatalogue>;
    exchange: NativeExchange;
  }): Promise<Calendar> {
    const dates = calendarDates(input.month, input.dates);
    const key = JSON.stringify([
      input.scope,
      input.serviceId,
      input.month,
      dates,
    ]);
    let entry = this.entries.get(key);
    if (
      entry?.value &&
      entry.value.observedAtMs <= Date.now() &&
      Date.now() - entry.value.observedAtMs < CALENDAR_CACHE_MS
    )
      return structuredClone(entry.value);
    if (input.cacheOnly) throw new ApiError(503, "display_cache_miss");
    if (entry?.pending) return structuredClone(await entry.pending);
    if (!entry) {
      if (this.entries.size >= 8)
        this.entries.delete(this.entries.keys().next().value!);
      entry = {};
      this.entries.set(key, entry);
    }
    const selected = entry;
    const pending = (async () => {
      if (!dates.length)
        return { month: input.month, observedAtMs: Date.now(), dates: [] };
      const catalogue = await input.catalogue();
      const service = catalogue.services.find(
        (s) =>
          s.id === input.serviceId &&
          s.active &&
          s.durationMinutes === 40 &&
          !s.recurring &&
          s.currency === "SGD",
      );
      if (!service) throw new ApiError(503, "native_service_unavailable");
      const instructors = catalogue.instructors.filter(
        (i) =>
          i.active &&
          (service.instructorIds === null ||
            service.instructorIds.includes(i.id)),
      );
      if (!instructors.length || instructors.length > 3)
        throw new ApiError(503, "native_instructors_unavailable");
      const offers = new Map<string, z.infer<typeof nativeOfferSchema>[]>(
        dates.map((d) => [d, []]),
      );
      const complete = new Set(dates);
      let observedAtMs = catalogue.observedAtMs;
      for (const instructor of instructors)
        for (const range of calendarRanges(dates)) {
          const response = await input.exchange({
            kind: "availability-range",
            serviceId: service.id,
            instructorId: instructor.id,
            from: range.from,
            to: range.to,
          });
          freshReceipt(response.receivedAtMs, Date.now());
          observedAtMs = Math.min(observedAtMs, response.receivedAtMs);
          const matrix = z.record(z.string(), z.unknown()).parse(response.body);
          if (Object.keys(matrix).some((date) => !range.dates.includes(date)))
            throw new ApiError(503, "calendar_representation_unavailable");
          for (const date of range.dates) {
            // Omitted days are unknown, not an invented closed-day declaration.
            if (!(date in matrix)) {
              complete.delete(date);
              continue;
            }
            const day = offers.get(date)!;
            for (const time of offeredStarts({ [date]: matrix[date] }, date)) {
              const startMs = Date.parse(`${date}T${time}+08:00`);
              if (
                day.some(
                  (o) =>
                    o.instructorId !== instructor.id &&
                    Math.abs(o.startMs - startMs) < 3000000,
                )
              )
                throw new ApiError(503, "native_provider_schedule_overlap");
              day.push({
                serviceId: service.id,
                serviceName: service.name,
                instructorId: instructor.id,
                instructorName: instructor.name,
                startMs,
                priceMinor: service.priceMinor,
                currency: "SGD",
              });
            }
          }
        }
      freshReceipt(observedAtMs, Date.now(), CALENDAR_CACHE_MS);
      return nativeCalendarSchema.parse({
        month: input.month,
        observedAtMs,
        dates: dates
          .filter((d) => complete.has(d) || offers.get(d)!.length > 0)
          .map((date) => ({
            date,
            observedAtMs,
            offers: offers.get(date)!.sort((a, b) => a.startMs - b.startMs),
          })),
      });
    })();
    selected.pending = pending;
    try {
      const value = await pending;
      if (this.entries.get(key) !== selected)
        throw new ApiError(409, "calendar_read_superseded");
      selected.value = value;
      return structuredClone(value);
    } finally {
      if (selected.pending === pending) selected.pending = undefined;
    }
  }
}
