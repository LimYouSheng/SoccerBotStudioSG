import { authenticate } from "./access";
import { ApiError, liveCustomerAccess, policy } from "./policy";
import { nativePrepareSchema } from "../src/domain/native-checkout";
import { nativeAccountContractSchema } from "./prebooking";
import { windowAvailability, type ReadOptions } from "./public-calendar";
import { providerSecrets } from "./provider-transport";

// Ordinary customer consent creates one short-lived, immutable checkout grant.
// The site stays open; a grant is never renewed or replayed after dispatch.
export async function authorizeCustomerCheckout(
  request: Request,
  value: unknown,
  options: ReadOptions,
) {
  const { env } = options;
  if (!liveCustomerAccess(env))
    throw new ApiError(503, "provider_access_disabled");
  const input = nativePrepareSchema.parse(value);
  const access = await authenticate(request, env, Date.now());
  const existing = await env.STATE.withSession("first-primary")
    .prepare("SELECT 1 FROM native_checkout_grants WHERE capability_hash=?")
    .bind(access.capability_hash)
    .first();
  if (existing) return;
  const dates = [
    ...new Set(
      input.sessions.map((session) =>
        new Date(session.startMs + 28800000).toISOString().slice(0, 10),
      ),
    ),
  ].sort();
  if (input.sessions.some((session) => session.serviceId !== "2"))
    throw new ApiError(409, "native_selection_changed");
  const available: Record<
    string,
    Awaited<ReturnType<typeof windowAvailability>>
  > = {};
  for (const date of dates) {
    available[date] = await windowAvailability({
      ...options,
      date,
      serviceId: "2",
      fresh: true,
    });
  }
  if (
    input.sessions.some(
      (session) =>
        !Object.values(available).some((day) =>
          day.offers.some(
            (offer) =>
              offer.serviceId === session.serviceId &&
              offer.instructorId === session.instructorId &&
              offer.startMs === session.startMs &&
              offer.priceMinor === session.totalMinor,
          ),
        ),
    )
  )
    throw new ApiError(409, "native_selection_changed");
  const now = Date.now();
  await authenticate(request, env, now);
  const expires = Math.min(now + 1200000, access.expires_ms);
  if (expires <= now + 180000) throw new ApiError(401, "access_expiring");
  const p = policy(env);
  const contract = nativeAccountContractSchema.parse({
    accountId: p.DEPLOYMENT_ACCOUNT_ID,
    environmentId: p.ENVIRONMENT,
    companyLogin: providerSecrets(env).company,
    serviceId: "2",
    priceMinor: 8800,
    ...(p.PREMIUM_SERVICE_ID ? { premiumServiceId: p.PREMIUM_SERVICE_ID } : {}),
    currency: "SGD",
    taxMinor: 0,
    durationMinutes: 40,
    bufferAfterMinutes: 10,
    clientLoginRequired: false,
    providerSchedules: "non-overlapping",
    confirmedAtMs: now,
    expiresAtMs: expires,
  });
  const used = options.accounting().used;
  // Bound each attempt, including fresh pre-write validation of every session.
  // The durable account governor still paces all visitors and retains cooldowns.
  const maximum = used + 64 + input.sessions.length * 32;
  if (!Number.isSafeInteger(maximum))
    throw new ApiError(503, "provider_budget_invalid");
  await env.STATE.prepare(
    "INSERT INTO native_checkout_grants(capability_hash,source_revision,contract_json,not_before_ms,expires_ms,starting_used,maximum_used,cleanup_allowed,state,available_dates_json,availability_json,read_state,ongoing) VALUES(?,?,?,?,?,?,?,0,'granted',?,?,'available',1) ON CONFLICT(capability_hash) DO NOTHING",
  )
    .bind(
      access.capability_hash,
      p.SOURCE_REVISION,
      JSON.stringify(contract),
      now,
      expires,
      used,
      maximum,
      JSON.stringify(dates),
      JSON.stringify(available),
    )
    .run();
}
