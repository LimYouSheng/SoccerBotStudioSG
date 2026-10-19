import { z } from "zod";
import { validDisplayDeadline } from "./catalog";
import { providerReferencesSchema } from "./provider-references";
// Initial sandbox checkout URL only; the server binds merchant and request ID.
export function isHitpayCheckoutUrl(value: string): boolean {
  return (
    value === value.trim() &&
    /^https:\/\/(?:securecheckout|checkout)\.sandbox\.hit-pay\.com\/payment-request\/@[A-Za-z0-9_-]{1,80}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/checkout$/.test(
      value,
    )
  );
}

export const hitpayHandoffSchema = z.strictObject({
  url: z.string().max(2048).refine(isHitpayCheckoutUrl),
  expiresAtMs: z.number().int().positive().safe(),
});

// Owner-supplied token-free historical native destination shape, 9 October 2026.
// Validating this initial URL does not attest downstream redirects or sandbox mode.
export function isNativeCheckoutUrl(value: string): boolean {
  return /^https:\/\/soccerbotstudiosg\.simplybook\.asia\/v2\/client\/pay-later\/id\/[A-Za-z0-9_-]+\/hash\/[A-Za-z0-9_-]+$/.test(
    value,
  );
}

// Provider-ID DTOs for the protected customer flow. Browser labels and reviewed
// totals are display/consent snapshots; the Worker revalidates provider truth.
import { isDate } from "./dates";
import { providerIdentifier } from "./catalog";
import { contactSchema } from "./contact";
import { MAX_PLAYERS } from "./booking-policy";
export const nativeOfferSchema = z.strictObject({
  serviceId: providerIdentifier,
  productServiceId: providerIdentifier.optional(),
  serviceName: z.string().min(1).max(256),
  instructorId: providerIdentifier,
  instructorName: z.string().min(1).max(256),
  startMs: z.number().int().positive().safe(),
  priceMinor: z.number().int().nonnegative().safe(),
  currency: z.literal("SGD"),
});
export const nativeAvailabilitySchema = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observedAtMs: z.number().int().nonnegative().safe(),
  offers: z.array(nativeOfferSchema).max(100),
});
export const publicCalendarSchema = z
  .strictObject({
    displayExpiresAtMs: z.number().int().nonnegative().safe().optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    serviceId: providerIdentifier,
    observedAtMs: z.number().int().nonnegative().safe(),
    dates: z
      .array(
        z.strictObject({
          date: z.string().refine(isDate),
          available: z.boolean(),
          offers: z.array(nativeOfferSchema).max(100).optional(),
        }),
      )
      .max(31),
  })
  .refine(validDisplayDeadline)
  .refine(
    (value) =>
      new Set(value.dates.map((day) => day.date)).size === value.dates.length &&
      value.dates.every(
        (day) =>
          day.date.startsWith(value.month + "-") &&
          (!day.offers ||
            (day.available === day.offers.length > 0 &&
              new Set(day.offers.map((offer) => offer.startMs)).size ===
                day.offers.length &&
              day.offers.every(
                (offer) =>
                  (offer.productServiceId ?? offer.serviceId) ===
                    value.serviceId &&
                  new Date(offer.startMs + 28800000)
                    .toISOString()
                    .slice(0, 10) === day.date,
              ))),
      ),
  );

export const nativeCalendarSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  observedAtMs: z.number().int().nonnegative().safe(),
  dates: z.array(nativeAvailabilitySchema).max(31),
});
export const nativePrepareSchema = z
  .strictObject({
    key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    contact: contactSchema.strict(),
    accepted: z.boolean(),
    holding: z.literal(true).optional(),
    sessions: z
      .array(
        z.strictObject({
          serviceId: providerIdentifier,
          instructorId: providerIdentifier,
          startMs: z.number().int().positive().safe(),
          players: z.number().int().min(1).max(MAX_PLAYERS),
          totalMinor: z.number().int().nonnegative().safe(),
        }),
      )
      .min(1)
      .max(12),
  })
  .refine((value) => value.accepted || value.holding === true);

export const nativeCurrentSchema = z.union([
  z.strictObject({ state: z.literal("empty") }),
  z.strictObject({
    state: z.enum(["prepared", "held", "checking"]),
    attemptId: z.string().uuid(),
    contact: contactSchema.strict(),
    sessions: z
      .array(
        nativeOfferSchema.extend({
          players: z.number().int().min(1).max(MAX_PLAYERS),
        }),
      )
      .min(1)
      .max(12),
  }),
]);

export const bookingDetailsSchema = z
  .strictObject({
    providerReferences: providerReferencesSchema.optional(),
    attemptId: z.string().uuid(),
    createdAtMs: z.number().int().nonnegative().safe(),
    totalMinor: z.number().int().nonnegative().safe(),
    taxMinor: z.number().int().nonnegative().safe(),
    contact: contactSchema.strict(),
    sessions: z
      .array(
        nativeOfferSchema.extend({
          players: z.number().int().min(1).max(MAX_PLAYERS),
        }),
      )
      .min(1)
      .max(12),
  })
  .refine(
    (value) =>
      value.taxMinor <= value.totalMinor &&
      value.sessions.reduce((sum, session) => sum + session.priceMinor, 0) ===
        value.totalMinor,
  );

// Display details carry no payment/confirmation authority or verification time.
export const receiptSchema = bookingDetailsSchema.safeExtend({
  verifiedAtMs: z.number().int().nonnegative().safe(),
});

// Display-only conversion shared by calendar prefetch and fresh daily reads.
export function nativeDisplaySlots(
  date: string,
  offers: z.infer<typeof nativeOfferSchema>[],
) {
  return offers.map((offer) => ({
    date,
    start: new Date(offer.startMs + 28800000).toISOString().slice(11, 16),
    instructor: offer.instructorId,
    available: true,
    native: {
      serviceId: offer.serviceId,
      ...(offer.productServiceId
        ? { productServiceId: offer.productServiceId }
        : {}),
      serviceName: offer.serviceName,
      instructorName: offer.instructorName,
      priceMinor: offer.priceMinor,
      currency: offer.currency,
    },
  }));
}
export const BROWSER_CALENDAR_MAX_AGE_MS = 5 * 60_000;
