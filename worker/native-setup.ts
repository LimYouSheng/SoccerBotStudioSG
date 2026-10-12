import { z } from "zod";
import { ApiError, digest } from "./policy";
import { bookingWallTime, providerId } from "./provider-normalization";
import type { NativeExchange } from "./provider-transport";

const time = /^([01]\d|2[0-3]):[0-5]\d:00$/;
const interval = z
  .object({
    from: z.string().regex(time),
    to: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d:00|24:00:00)$/),
  })
  .refine((value) => value.from < value.to);
const events = z.enum([
  "new_booking",
  "change_booking",
  "cancel_booking",
  "new_client",
  "change_client",
  "delete_client",
  "new_offer",
  "new_invoice",
]);

// Projection only: no callback URL, contact data, secret or arbitrary field is retained.
function shape(value: unknown) {
  return {
    kind:
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    count: Array.isArray(value)
      ? value.length
      : value !== null && typeof value === "object"
        ? Object.keys(value).length
        : null,
  };
}

export async function inspectNativeSetup(
  exchange: NativeExchange,
  from: string,
  to: string,
) {
  let stage = "company-hours",
    raw: unknown;
  try {
    const hours: Record<
      string,
      Record<string, { from: string; to: string }[]>
    > = {};
    for (const layer of [
      "company",
      "service",
      "instructor",
      "combined",
    ] as const) {
      stage = layer + "-hours";
      raw = undefined;
      raw = (
        await exchange({
          kind: "working-hours",
          from,
          to,
          serviceId: layer === "service" || layer === "combined" ? "2" : null,
          instructorId:
            layer === "instructor" || layer === "combined" ? "3" : null,
        })
      ).body;
      const dates = z
        .record(z.string(), z.array(interval).max(1440))
        .parse(raw);
      if (Object.keys(dates).length > 2)
        throw new ApiError(503, "setup_dates_invalid");
      for (const date of Object.keys(dates)) {
        bookingWallTime(date + " 00:00:00", "Asia/Singapore");
        if (date < from || date > to)
          throw new ApiError(503, "setup_dates_invalid");
      }
      hours[layer] = dates;
    }
    stage = "webhook-subscriptions";
    raw = undefined;
    raw = (await exchange({ kind: "webhook-subscriptions" })).body;
    const subscriptions = await subscriptionSnapshot(raw);
    return { verified: true as const, hours, subscriptions };
  } catch (error) {
    return {
      verified: false as const,
      stage,
      reason:
        error instanceof ApiError
          ? error.code
          : "setup_representation_unavailable",
      representation: shape(raw),
    };
  }
}

export async function subscriptionSnapshot(raw: unknown) {
  const entries = z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]),
        event: events,
        is_active: z.union([z.literal(0), z.literal(1)]),
        url: z
          .url()
          .refine((url) => ["https:", "http:"].includes(new URL(url).protocol)),
      }),
    )
    .max(64)
    .parse(raw);
  const subscriptions = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = providerId(entry.id);
    if (ids.has(id)) throw new ApiError(503, "setup_subscription_duplicate");
    ids.add(id);
    subscriptions.push({
      id,
      event: entry.event,
      active: entry.is_active === 1,
      destinationSha256: await digest(entry.url),
    });
  }
  return subscriptions;
}
