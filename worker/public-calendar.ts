import { z } from "zod";
import { ApiError, policy } from "./policy";
import { providerSecrets } from "./provider-transport";
import type { ProviderSession, ProviderControl } from "./provider-session";
import { calendarDates, NativeCalendarReads } from "./native-calendar";
import { publicCalendarSchema } from "../src/domain/native-checkout";

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
export async function publicCalendar(options: {
  env: Env;
  month: string;
  cache: NativeCalendarReads;
  provider: ProviderSession;
  control: ProviderControl;
  accounting: () => { used: number; active: number };
}) {
  const { env, month, provider } = options;
  const p = policy(env);
  const configured: unknown = Reflect.get(env, "PUBLIC_CALENDAR_WINDOW_JSON");
  const scope = windowSchema.safeParse(
    typeof configured === "string" && configured
      ? JSON.parse(configured)
      : null,
  );
  if (!scope.success) throw new ApiError(503, "public_calendar_closed");
  const window = scope.data;
  const assertOpen = () => {
    const now = Date.now(),
      usage = options.accounting();
    if (
      p.PROVIDER_ACCESS !== "trusted-reads" ||
      p.SOURCE_REVISION !== window.sourceRevision ||
      now < window.notBeforeMs ||
      now >= window.expiresMs ||
      window.expiresMs > window.notBeforeMs + 1200000 ||
      window.expiresMs > p.CAMPAIGN_END_MS ||
      window.maximumUsed <= window.startingUsed ||
      window.maximumUsed > p.PROVIDER_CALL_CEILING - 48 ||
      usage.used < window.startingUsed ||
      usage.used > window.maximumUsed
    )
      throw new ApiError(503, "public_calendar_closed");
  };
  assertOpen();
  const today = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
  const last = new Date(today.slice(0, 7) + "-01T00:00:00Z");
  last.setUTCMonth(last.getUTCMonth() + 3);
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    month < today.slice(0, 7) ||
    month > last.toISOString().slice(0, 7)
  )
    throw new ApiError(400, "calendar_month_invalid");
  let lastCall = 0;
  const control = {
    ...options.control,
    reserve: async () => {
      const delay = Math.max(0, lastCall + 300 - Date.now());
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
  const raw = await options.cache.read({
    scope: JSON.stringify([binding, p.SOURCE_REVISION]),
    month,
    serviceId: window.serviceId,
    dates: calendarDates(month, window.dates).filter((date) => date >= today),
    catalogue: async () => {
      await provider.identity(env, control);
      return provider.catalogue(env, control);
    },
    exchange: async (request) => {
      await provider.identity(env, control);
      return provider.nativeRead(env, control, request);
    },
  });
  assertOpen();
  return publicCalendarSchema.parse({
    month,
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
