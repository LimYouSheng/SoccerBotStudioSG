import { BOOKING_LEAD_MINUTES } from "../src/domain/booking-policy";
import { authenticate, type Access } from "./access";
import { ApiError, liveCustomerAccess, policy } from "./policy";
import { nativePrepareSchema } from "../src/domain/native-checkout";
import { nativeAccountContractSchema } from "./prebooking";
import {
  calendarWindow,
  windowAvailability,
  type ReadOptions,
} from "./public-calendar";
import { providerSecrets } from "./provider-transport";

// Ordinary customer consent creates one short-lived, immutable checkout grant.
// The site stays open; a grant is never renewed or replayed after dispatch.
export async function authorizeCustomerCheckout(
  request: Request,
  value: unknown,
  options: ReadOptions,
  combinedHold = false,
  verifiedAccess?: Access,
) {
  const { env } = options;
  if (!liveCustomerAccess(env))
    throw new ApiError(503, "provider_access_disabled");
  const input = nativePrepareSchema.parse(value);
  const p = policy(env);
  const access =
    verifiedAccess ?? (await authenticate(request, env, Date.now()));
  const existing = await archiveRejectedCustomerGrant(
    env,
    access.capability_hash,
  );
  if (existing) return;
  const dates = [
    ...new Set(
      input.sessions.map((session) =>
        new Date(session.startMs + 28800000).toISOString().slice(0, 10),
      ),
    ),
  ].sort();
  if (
    input.sessions.some(
      (session) =>
        session.serviceId !== "2" && session.serviceId !== p.PREMIUM_SERVICE_ID,
    )
  )
    throw new ApiError(409, "native_selection_changed");
  if (
    combinedHold &&
    dates.some((date) => !calendarWindow(options).window.dates.includes(date))
  )
    throw new ApiError(409, "native_selection_changed");
  const available: Record<
    string,
    Awaited<ReturnType<typeof windowAvailability>>
  > = {};
  for (const date of combinedHold ? [] : dates) {
    available[date] = await windowAvailability({
      ...options,
      date,
      serviceId: "2",
      fresh: true,
    });
  }
  if (
    !combinedHold &&
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
  if (!verifiedAccess) await authenticate(request, env, now);
  const expires = Math.min(now + 1200000, access.expires_ms);
  if (expires <= now + 180000) throw new ApiError(401, "access_expiring");
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
    bookingLeadMinutes: BOOKING_LEAD_MINUTES,
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

export async function archiveRejectedCustomerGrant(
  env: Env,
  capabilityHash: string,
) {
  // The account coordinator serializes this rollover. Archive only a proven
  // preflight rejection with no dispatch or effect; never renew uncertain writes.
  const rejected =
    "capability_hash=? AND ongoing=1 AND state='blocked' AND json_extract(result_json,'$.state') IN ('selection_unavailable','restart_required','checkout_not_started') AND EXISTS(SELECT 1 FROM attempts a WHERE a.id=native_checkout_grants.attempt_id AND a.state='prepared' AND a.association_json IS NULL) AND NOT EXISTS(SELECT 1 FROM dispatches d WHERE d.attempt_id=native_checkout_grants.attempt_id) AND NOT EXISTS(SELECT 1 FROM session_effects e WHERE e.attempt_id=native_checkout_grants.attempt_id)";
  const db = env.STATE.withSession("first-primary");
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO rejected_native_checkout_grants SELECT * FROM native_checkout_grants WHERE ${rejected}`,
      )
      .bind(capabilityHash),
    db
      .prepare(
        `DELETE FROM native_checkout_grants WHERE ${rejected} AND EXISTS(SELECT 1 FROM rejected_native_checkout_grants h WHERE h.attempt_id=native_checkout_grants.attempt_id AND h.capability_hash=native_checkout_grants.capability_hash)`,
      )
      .bind(capabilityHash),
    db
      .prepare("SELECT 1 FROM native_checkout_grants WHERE capability_hash=?")
      .bind(capabilityHash),
  ]);
  return results[2].results.length > 0;
}
