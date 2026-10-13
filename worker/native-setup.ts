import { z } from "zod";
import { ApiError, digest } from "./policy";
import {
  bookingWallTime,
  providerFlag,
  providerId,
} from "./provider-normalization";
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
  const parsed = z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]),
        event: events,
        is_active: z.union([
          z.literal(0),
          z.literal(1),
          z.literal("0"),
          z.literal("1"),
        ]),
        url: z
          .url()
          .refine((url) => ["https:", "http:"].includes(new URL(url).protocol)),
      }),
    )
    .max(64)
    .safeParse(raw);
  if (!parsed.success) {
    // Only fixed field codes leave this boundary; never echo Zod messages,
    // provider values, arbitrary keys, URLs or response bodies.
    const field = parsed.error.issues[0]?.path[1];
    const code =
      field === "is_active"
        ? "setup_subscription_is_active_invalid"
        : field === "id"
          ? "setup_subscription_id_invalid"
          : field === "event"
            ? "setup_subscription_event_invalid"
            : field === "url"
              ? "setup_subscription_url_invalid"
              : "setup_subscription_representation_invalid";
    throw new ApiError(503, code);
  }
  const subscriptions = [];
  const ids = new Set<string>();
  for (const entry of parsed.data) {
    const id = providerId(entry.id);
    if (ids.has(id)) throw new ApiError(503, "setup_subscription_duplicate");
    ids.add(id);
    subscriptions.push({
      id,
      event: entry.event,
      active: providerFlag(entry.is_active) === true,
      destinationSha256: await digest(entry.url),
    });
  }
  return subscriptions;
}

// Account response diagnostics only. Retain field names/types, never IDs, URLs,
// event values, secrets or contacts. This is not normalized subscription proof.
export function webhookSubscriptionStructure(raw: unknown): unknown {
  const known = new Set([
    "id",
    "url",
    "event",
    "is_active",
    "changed",
    "items",
    "data",
    "results",
    "total",
    "count",
    "page",
  ]);
  let remaining = 64;
  const inspect = (value: unknown, depth: number): unknown => {
    remaining--;
    if (value === null) return { type: "null" };
    if (Array.isArray(value)) {
      const entries: unknown[] = [];
      if (depth < 2)
        for (const entry of value.slice(0, 8)) {
          if (remaining <= 0) break;
          entries.push(inspect(entry, depth + 1));
        }
      return { type: "array", count: value.length, entries };
    }
    if (typeof value !== "object") return { type: typeof value };
    const entries = Object.entries(value),
      fields: { key: string; value: unknown }[] = [];
    if (depth < 3)
      for (const [key, child] of entries.slice(0, 16)) {
        if (remaining <= 0) break;
        fields.push({
          key: known.has(key) ? key : "redacted",
          value: inspect(child, depth + 1),
        });
      }
    return { type: "object", count: entries.length, fields };
  };
  return inspect(raw, 0);
}
