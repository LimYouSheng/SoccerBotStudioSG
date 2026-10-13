"use client";
import { useCallback, useEffect, useState } from "react";
import { monthAt } from "@/domain/dates";
import { CATALOGUE_MAX_AGE_MS } from "@/domain/catalog";
import type {
  BookingService,
  CalendarAvailability,
} from "@/services/contracts";

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
  const key = JSON.stringify([serviceId, scope, reload]);
  const [state, setState] = useState<{
    owner: BookingService;
    key: string;
    entries: Record<string, CalendarAvailability & { receivedAtMs: number }>;
    failed: string[];
  } | null>(null);
  useEffect(() => {
    if (
      paused ||
      (!service.publicCalendar && (!service.calendar || !serviceId))
    )
      return;
    const controller = new AbortController();
    const calendar = service.calendar;
    void (async () => {
      for (let offset = 0; offset < 4; offset++) {
        const next = monthAt(month + "-01", offset).slice(0, 7);
        if (controller.signal.aborted) return;
        try {
          const result = service.publicCalendar
            ? await service.publicCalendar({
                month: next,
                signal: controller.signal,
              })
            : await calendar!({
                month: next,
                serviceId: serviceId!,
                signal: controller.signal,
              });
          if (
            serviceId &&
            "serviceId" in result &&
            result.serviceId !== serviceId
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
  }, [service, serviceId, month, scope, paused, key]);
  // Expire display entries at their actual receipt deadline, independently of
  // the booking page's minute clock. No provider polling or silent retries.
  useEffect(() => {
    if (!state) return;
    const deadlines = Object.values(state.entries).map(
      (value) => value.observedAtMs + CATALOGUE_MAX_AGE_MS,
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
                ([, value]) => value.observedAtMs + CATALOGUE_MAX_AGE_MS > now,
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
    (date: string, available: boolean | undefined) => {
      setState((previous) => {
        if (!previous || previous.owner !== service || previous.key !== key)
          return previous;
        const month = date.slice(0, 7);
        const entry = previous.entries[month];
        if (!entry) return previous;
        const dates = entry.dates.filter((day) => day.date !== date);
        if (available !== undefined) dates.push({ date, available });
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
  return {
    reconcile,
    entry(selected: string, now: number) {
      const value = current?.entries[selected];
      const observedNow = Math.max(now, value?.receivedAtMs ?? now);
      return value &&
        value.observedAtMs <= observedNow &&
        observedNow - value.observedAtMs < CATALOGUE_MAX_AGE_MS
        ? value
        : null;
    },
    failed: current?.failed ?? [],
    retry: () => setReload((value) => value + 1),
  };
}
