// Owner-supplied token-free historical native destination shape, 9 October 2026.
// Validating this initial URL does not attest downstream redirects or sandbox mode.
export function isNativeCheckoutUrl(value: string): boolean {
  return /^https:\/\/soccerbotstudiosg\.simplybook\.asia\/v2\/client\/pay-later\/id\/[A-Za-z0-9_-]+\/hash\/[A-Za-z0-9_-]+$/.test(
    value,
  );
}

// Provider-ID DTOs for the protected customer flow. Browser labels and reviewed
// totals are display/consent snapshots; the Worker revalidates provider truth.
import { z } from "zod";
import { providerIdentifier } from "./catalog";
import { contactSchema } from "./contact";
import { MAX_PLAYERS } from "./booking-policy";
export const nativeOfferSchema = z.strictObject({
  serviceId: providerIdentifier,
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
export const nativePrepareSchema = z.strictObject({
  key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  contact: contactSchema.strict(),
  accepted: z.literal(true),
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
});

export const nativeCurrentSchema = z.union([
  z.strictObject({ state: z.literal("empty") }),
  z.strictObject({
    state: z.enum(["prepared", "checking"]),
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
