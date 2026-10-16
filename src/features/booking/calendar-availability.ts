"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BROWSER_CALENDAR_MAX_AGE_MS,
  nativeDisplaySlots,
} from "@/domain/native-checkout";
import { monthAt, todaySG } from "@/domain/dates";
import { BOOKING_LEAD_MS, withinOpeningHours } from "@/domain/booking-policy";
import { CATALOGUE_MAX_AGE_MS } from "@/domain/catalog";
import type {
  AvailableSlot,
  BookingService,
  CalendarAvailability,
} from "@/services/contracts";

const retention = (entry: CalendarAvailability) =>
  entry.dates.every((day) => day.offers !== undefined)
    ? BROWSER_CALENDAR_MAX_AGE_MS
    : CATALOGUE_MAX_AGE_MS;
// One booking-level prefetch owner. Current month first, then three following
// months sequentially; never 120 per-day requests or a retry/polling loop.
export function useCalendarAvailability(
  service: BookingService,
  serviceId: string | undefined,
  month: string,
  scope: string,
  paused: boolean,
) {
  const [reload, setReload] = useState(0);
  const protectedServiceId = service.publicCalendar ? undefined : serviceId;
  const key = JSON.stringify([
    service.publicCalendar ? "public" : serviceId,
    scope,
    reload,
  ]);
  const [state, setState] = useState<{
    owner: BookingService;
    key: string;
    entries: Record<string, CalendarAvailability & { receivedAtMs: number }>;
    failed: string[];
  } | null>(null);
  const retained = useRef(state);
  useEffect(() => {
    retained.current = state;
  }, [state]);
  useEffect(() => {
    if (
      paused ||
      (!service.publicCalendar && (!service.calendar || !protectedServiceId))
    )
      return;
    const controller = new AbortController();
    const calendar = service.calendar;
    void (async () => {
      for (let offset = 0; offset < 4; offset++) {
        const next = monthAt(month + "-01", offset).slice(0, 7);
        if (
          next >
          monthAt(todaySG(new Date(Date.now())).slice(0, 7) + "-01", 3).slice(
            0,
            7,
          )
        )
          break;
        if (controller.signal.aborted) return;
        const previous = retained.current;
        const saved =
          previous?.owner === service && previous.key === key
            ? previous.entries[next]
            : undefined;
        if (saved && Date.now() - saved.observedAtMs < retention(saved))
          continue;
        try {
          const result = service.publicCalendar
            ? await service.publicCalendar({
                month: next,
                signal: controller.signal,
              })
            : await calendar!({
                month: next,
                serviceId: protectedServiceId!,
                signal: controller.signal,
              });
          if (
            protectedServiceId &&
            "serviceId" in result &&
            result.serviceId !== protectedServiceId
          )
            throw new Error("calendar_service_changed");
          if (controller.signal.aborted) return;
          const receivedAtMs = Date.now();
          setState((previous) => {
            const entries =
              previous?.owner === service && previous.key === key
                ? { ...previous.entries }
                : {};
            entries[next] = { ...result, receivedAtMs };
            const retained = Object.fromEntries(
              Object.entries(entries).slice(-4),
            );
            return { owner: service, key, entries: retained, failed: [] };
          });
        } catch {
          if (!controller.signal.aborted)
            setState((previous) => {
              const entries =
                previous?.owner === service && previous.key === key
                  ? { ...previous.entries }
                  : {};
              delete entries[next];
              return { owner: service, key, entries, failed: [next] };
            });
          return;
        }
      }
    })();
    return () => controller.abort();
  }, [service, protectedServiceId, month, scope, paused, key]);
  // Expire display entries at their actual receipt deadline, independently of
  // the booking page's minute clock. No provider polling or silent retries.
  useEffect(() => {
    if (!state) return;
    const deadlines = Object.values(state.entries).map(
      (value) => value.observedAtMs + retention(value),
    );
    if (!deadlines.length) return;
    const timer = setTimeout(
      () =>
        setState((previous) => {
          if (previous !== state) return previous;
          const now = Date.now();
          return {
            ...previous,
            entries: Object.fromEntries(
              Object.entries(previous.entries).filter(
                ([, value]) => value.observedAtMs + retention(value) > now,
              ),
            ),
          };
        }),
      Math.max(0, Math.min(...deadlines) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [state]);
  const current = state?.owner === service && state.key === key ? state : null;
  const reconcile = useCallback(
    (date: string, available: boolean | undefined, slots?: AvailableSlot[]) => {
      setState((previous) => {
        if (!previous || previous.owner !== service || previous.key !== key)
          return previous;
        const month = date.slice(0, 7);
        const entry = previous.entries[month];
        if (!entry) return previous;
        const existing = entry.dates.find((day) => day.date === date);
        if (existing?.available === available && !slots) return previous;
        const dates = entry.dates.filter((day) => day.date !== date);
        if (available !== undefined)
          dates.push({
            date,
            available,
            ...(slots && slots.every((slot) => slot.native)
              ? {
                  offers: slots.map((slot) => ({
                    ...slot.native!,
                    instructorId: slot.instructor,
                    startMs: Date.parse(`${slot.date}T${slot.start}:00+08:00`),
                  })),
                }
              : {}),
          });
        return {
          ...previous,
          entries: {
            ...previous.entries,
            [month]: {
              ...entry,
              dates: dates.sort((a, b) => a.date.localeCompare(b.date)),
            },
          },
        };
      });
    },
    [service, key],
  );
  const cachedDates = useMemo(
    () =>
      Object.fromEntries(
        Object.values(current?.entries ?? {}).flatMap((entry) =>
          entry.dates.flatMap((day) =>
            day.offers &&
            day.offers.every(
              (offer) =>
                (offer.productServiceId ?? offer.serviceId) === serviceId,
            )
              ? [[day.date, nativeDisplaySlots(day.date, day.offers)]]
              : [],
          ),
        ),
      ),
    [current, serviceId],
  );
  return {
    cachedDates,
    reconcile,
    entry(selected: string, now: number) {
      const value = current?.entries[selected];
      const observedNow = Math.max(now, value?.receivedAtMs ?? now);
      return value &&
        value.observedAtMs <= observedNow &&
        observedNow - value.observedAtMs < retention(value)
        ? {
            ...value,
            dates: value.dates.map((day) => {
              if (!day.offers) return day;
              const offers = day.offers.filter(
                (offer) =>
                  withinOpeningHours(offer.startMs) &&
                  offer.startMs - observedNow >= BOOKING_LEAD_MS,
              );
              return {
                ...day,
                offers,
                available: day.available && offers.length > 0,
              };
            }),
          }
        : null;
    },
    failed: current?.failed ?? [],
    retry: () => setReload((value) => value + 1),
  };
}
