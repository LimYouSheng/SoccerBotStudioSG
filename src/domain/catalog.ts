export const LOCATION = {
  building: "Apex @ Henderson",
  street: "201 Henderson Road",
  unit: "#05-01",
  postal: "Singapore 159545",
};
export const ADDRESS = `${LOCATION.street}, ${LOCATION.unit} ${LOCATION.building}, ${LOCATION.postal}`;
export const CONTACT = {
  phone: "+6590143819",
  phoneDisplay: "+65 9014 3819",
  email: "glenna@soccerbotsg.com",
  instagram: "https://www.instagram.com/soccerbotstudiosg/",
};
export const CONTACT_METHODS = {
  email: "Email",
  phone: "Phone call",
  whatsapp: "WhatsApp",
};
export const PLAYER_APP_URL = "https://soccerbot360.com/en/player-app";
export const ENQUIRY_TYPES = [
  "Multi-session bundle",
  "Membership",
  "Academy / school visit",
  "Corporate booking",
  "Sponsorship",
  "Group reservation",
  "Event / private hire",
  "Production booking",
  "Other special arrangement",
];

// Live catalogue DTOs use provider IDs. Legacy preview IDs live in demo-catalog.
// These normalized contracts are not provider wire envelopes or write authority.
import { z } from "zod";
import { MAX_PLAYERS } from "./booking-policy";
export const CATALOGUE_MAX_AGE_MS = 60000;
export const CATALOGUE_RECORD_LIMIT = 1000;
export const providerIdentifier = z
  .string()
  .regex(/^[1-9]\d{0,14}$/)
  .refine((value) => Number.isSafeInteger(Number(value)));
export const catalogueBindingSchema = z.strictObject({
  accountId: z.string().min(1).max(128),
  environmentId: z.literal("developer"),
  companyLogin: z.string().min(1).max(128),
});
const label = z.string().trim().min(1).max(256);
export const catalogueSchema = z
  .strictObject({
    binding: catalogueBindingSchema,
    observedAtMs: z.number().int().safe().nonnegative(),
    complete: z.literal(true),
    services: z
      .array(
        z.strictObject({
          id: providerIdentifier,
          name: label,
          active: z.boolean(),
          durationMinutes: z.number().int().positive(),
          recurring: z.boolean(),
          priceMinor: z.number().int().safe().nonnegative(),
          currency: z.string().regex(/^[A-Z]{3}$/),
          // Null means the documented unrestricted relationship, never unknown data.
          instructorIds: z.array(providerIdentifier).nullable(),
        }),
      )
      .max(CATALOGUE_RECORD_LIMIT),
    instructors: z
      .array(
        z.strictObject({
          id: providerIdentifier,
          name: label,
          active: z.boolean(),
        }),
      )
      .max(CATALOGUE_RECORD_LIMIT),
  })
  .superRefine((value, ctx) => {
    for (const list of [value.services, value.instructors])
      if (new Set(list.map((item) => item.id)).size !== list.length)
        ctx.addIssue({
          code: "custom",
          message: "duplicate provider identity",
        });
    for (const service of value.services)
      if (
        service.instructorIds &&
        new Set(service.instructorIds).size !== service.instructorIds.length
      )
        ctx.addIssue({ code: "custom", message: "duplicate relationship" });
  });
export type ProviderCatalogue = z.infer<typeof catalogueSchema>;
export type CatalogueBinding = z.infer<typeof catalogueBindingSchema>;
export const providerSelectionSchema = z.strictObject({
  serviceId: providerIdentifier,
  instructorId: providerIdentifier,
  startMs: z.number().int().positive().safe(),
  players: z.number().int().min(1).max(MAX_PLAYERS),
});
export type ProviderSelection = z.infer<typeof providerSelectionSchema>;
export function catalogueSelection(
  catalogue: ProviderCatalogue,
  selection: ProviderSelection,
) {
  const service = catalogue.services.find(
    (item) => item.id === selection.serviceId,
  );
  const instructor = catalogue.instructors.find(
    (item) => item.id === selection.instructorId,
  );
  if (
    !service?.active ||
    !instructor?.active ||
    (service.instructorIds && !service.instructorIds.includes(instructor.id))
  )
    return null;
  return { service, instructor };
}
// Refresh display/review without rewriting the selected IDs, contact or committed intent.
export function catalogueReview(
  previous: ProviderCatalogue,
  current: ProviderCatalogue,
  selection: ProviderSelection,
) {
  const before = catalogueSelection(previous, selection),
    after = catalogueSelection(current, selection);
  if (JSON.stringify(previous.binding) !== JSON.stringify(current.binding))
    return { state: "unavailable" as const };
  if (!after) return { state: "selection_unavailable" as const, selection };
  const changed = !before || JSON.stringify(before) !== JSON.stringify(after);
  return {
    state: changed ? ("review_required" as const) : ("unchanged" as const),
    selection,
    ...after,
  };
}
