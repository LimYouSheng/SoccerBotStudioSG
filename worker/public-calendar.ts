import { z } from "zod";
import { ApiError, policy, liveCustomerAccess } from "./policy";
import { providerSecrets } from "./provider-transport";
import type { ProviderSession, ProviderControl } from "./provider-session";
import { calendarDates, NativeCalendarReads } from "./native-calendar";
import {
  publicCalendarSchema,
  nativeAvailabilitySchema,
  nativeCalendarSchema,
} from "../src/domain/native-checkout";
import { customerCatalogueSchema } from "../src/domain/catalog";

// Management-owned, closed by absence. Visitors supply only a calendar month;
// no anonymous identity, booking grant or customer information is created.
const windowSchema = z.strictObject({
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  serviceId: z.string().regex(/^[1-9]\d{0,14}$/),
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1)
    .max(124),
  notBeforeMs: z.number().int().nonnegative().safe(),
  expiresMs: z.number().int().positive().safe(),
  startingUsed: z.number().int().nonnegative(),
  maximumUsed: z.number().int().positive(),
});
export type ReadOptions = {
  env: Env;
  cache: NativeCalendarReads;
  provider: ProviderSession;
  control: ProviderControl;
  accounting: () => { used: number; active: number };
  lastDispatchMs?: () => number;
};
export function hasPublicCalendarWindow(env: Env) {
  return (
    liveCustomerAccess(env) ||
    Boolean(Reflect.get(env, "PUBLIC_CALENDAR_WINDOW_JSON"))
  );
}
function calendarWindow(options: ReadOptions) {
  const { env } = options;
  const p = policy(env);
  const configured: unknown = Reflect.get(env, "PUBLIC_CALENDAR_WINDOW_JSON");
  let parsed: unknown = null;
  try {
    parsed =
      typeof configured === "string" && configured
        ? JSON.parse(configured)
        : null;
  } catch {
    /* Invalid configuration stays closed. */
  }
  const live = liveCustomerAccess(env);
  if (live) {
    const today = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
    const end = new Date(today.slice(0, 7) + "-01T00:00:00Z");
    end.setUTCMonth(end.getUTCMonth() + 4);
    const dates: string[] = [];
    for (
      let day = new Date(today + "T00:00:00Z");
      day < end;
      day.setUTCDate(day.getUTCDate() + 1)
    )
      dates.push(day.toISOString().slice(0, 10));
    parsed = {
      sourceRevision: p.SOURCE_REVISION,
      serviceId: "2",
      dates,
      notBeforeMs: Date.now(),
      expiresMs: Number.MAX_SAFE_INTEGER,
      startingUsed: 0,
      maximumUsed: Number.MAX_SAFE_INTEGER,
    };
  }
  const scope = windowSchema.safeParse(parsed);
  if (!scope.success) throw new ApiError(503, "public_calendar_closed");
  const window = scope.data;
  const assertOpen = () => {
    const now = Date.now(),
      usage = options.accounting();
    if (
      p.PROVIDER_ACCESS !== "trusted-reads" ||
      p.SOURCE_REVISION !== window.sourceRevision ||
      (!live &&
        (now < window.notBeforeMs ||
          now >= window.expiresMs ||
          window.expiresMs > window.notBeforeMs + 1200000 ||
          window.expiresMs > p.CAMPAIGN_END_MS ||
          window.maximumUsed <= window.startingUsed ||
          window.maximumUsed > p.PROVIDER_CALL_CEILING - 48 ||
          usage.used < window.startingUsed ||
          usage.used > window.maximumUsed))
    )
      throw new ApiError(503, "public_calendar_closed");
  };
  assertOpen();
  let lastCall = 0;
  const control = {
    ...options.control,
    reserve: async () => {
      const delay = Math.max(
        0,
        Math.max(lastCall, options.lastDispatchMs?.() ?? 0) + 300 - Date.now(),
      );
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      assertOpen();
      if (options.accounting().used >= window.maximumUsed)
        throw new ApiError(503, "public_calendar_budget_exhausted");
      lastCall = Date.now();
      return options.control.reserve();
    },
  };
  const binding = {
    accountId: p.DEPLOYMENT_ACCOUNT_ID,
    environmentId: p.ENVIRONMENT,
    companyLogin: providerSecrets(env).company,
  };
  return { window, assertOpen, control, binding, p };
}

// The same read-only window admits session details and slots. It creates no
// customer-specific write authority; checkout still requires its exact grant.
export async function windowCatalogue(options: ReadOptions) {
  const { window, control, assertOpen } = calendarWindow(options);
  await options.provider.identity(options.env, control);
  const value = await options.provider.catalogue(options.env, control);
  assertOpen();
  const services = value.services.filter(
    (service) => service.id === window.serviceId,
  );
  return customerCatalogueSchema.parse({
    environment: value.binding.environmentId,
    observedAtMs: value.observedAtMs,
    complete: value.complete,
    services,
    instructors: value.instructors.filter((instructor) =>
      services.some(
        (service) =>
          service.instructorIds === null ||
          service.instructorIds.includes(instructor.id),
      ),
    ),
  });
}

export async function windowCalendar(
  options: ReadOptions & {
    month: string;
    serviceId?: string;
    date?: string;
    fresh?: boolean;
  },
) {
  const { env, month, provider } = options;
  const { window, assertOpen, control, binding, p } = calendarWindow(options);
  const today = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
  const last = new Date(today.slice(0, 7) + "-01T00:00:00Z");
  last.setUTCMonth(last.getUTCMonth() + 3);
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    month < today.slice(0, 7) ||
    month > last.toISOString().slice(0, 7)
  )
    throw new ApiError(400, "calendar_month_invalid");
  const dates = calendarDates(month, window.dates).filter(
    (date) => date >= today,
  );
  if (
    (options.serviceId && options.serviceId !== window.serviceId) ||
    (options.date && !dates.includes(options.date))
  )
    throw new ApiError(503, "calendar_scope_unavailable");
  if (options.fresh && options.date) options.cache.invalidateDate(options.date);
  const raw = await options.cache.read({
    scope: JSON.stringify([binding, p.SOURCE_REVISION]),
    month,
    serviceId: window.serviceId,
    dates: options.fresh && options.date ? [options.date] : dates,
    catalogue: async () => {
      await provider.identity(env, control);
      return provider.catalogue(env, control, options.fresh === true);
    },
    exchange: async (request) => {
      await provider.identity(env, control);
      return provider.nativeRead(env, control, request);
    },
  });
  assertOpen();
  return nativeCalendarSchema.parse({
    ...raw,
    dates: raw.dates.map((day) => ({
      ...day,
      offers: day.offers.filter(
        (offer) => offer.startMs - Date.now() >= 48 * 3600000,
      ),
    })),
  });
}

export async function windowAvailability(
  options: ReadOptions & { date: string; serviceId: string; fresh?: boolean },
) {
  const value = await windowCalendar({
    ...options,
    month: options.date.slice(0, 7),
  });
  const day = value.dates.find((day) => day.date === options.date);
  if (!day) throw new ApiError(503, "calendar_date_unknown");
  return nativeAvailabilitySchema.parse(day);
}

export async function publicCalendar(options: ReadOptions & { month: string }) {
  const raw = await windowCalendar(options);
  const { window } = calendarWindow(options);
  return publicCalendarSchema.parse({
    month: options.month,
    serviceId: window.serviceId,
    observedAtMs: raw.observedAtMs,
    dates: raw.dates.map((day) => ({
      date: day.date,
      available: day.offers.some(
        (offer) => offer.startMs - Date.now() >= 48 * 3600000,
      ),
    })),
  });
}
