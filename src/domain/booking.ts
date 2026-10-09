import { z } from "zod";
import {
  contactSchema,
  blankContact,
  contactErrors,
  normalizeContact,
} from "./contact";
import { MAX_PLAYERS, SESSION_MINUTES } from "./booking-policy";
import { PRICE_CENTS, SESSION_STARTS } from "./demo-catalog";
import { clockMinutes, isDate, todaySG } from "./dates";
export const slotSchema = z.object({
  date: z.string().refine(isDate),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export type Slot = z.infer<typeof slotSchema>;
export { demoInstructorSchema as instructorSchema } from "./demo-catalog";
import { demoInstructorSchema as instructorSchema } from "./demo-catalog";
export const sessionSchema = slotSchema.extend({
  instructor: instructorSchema,
  rotationAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
});
export type Session = z.infer<typeof sessionSchema>;
export const assignedSlotSchema = sessionSchema.extend({ studio: z.string() });
export const draftSchema = z.object({
  mode: z.enum(["guest", "member"]).nullable(),
  accountEmail: z.string(),
  players: z.number().int().min(1).max(MAX_PLAYERS),
  slots: z.array(sessionSchema).max(100),
  contact: contactSchema,
  accepted: z.boolean(),
});
export type BookingDraft = z.infer<typeof draftSchema>;
export const bookingSchema = z.object({
  reference: z.string(),
  createdAt: z.string(),
  draft: draftSchema,
  slots: z.array(assignedSlotSchema),
  totalCents: z.number().int().nonnegative(),
});
export type Booking = z.infer<typeof bookingSchema>;
export const outcomeSchema = z.enum(["success", "declined", "pending", "late"]);
export type Outcome = z.infer<typeof outcomeSchema>;
export const attemptSchema = z.object({
  id: z.string(),
  status: z.enum(["ready", "checking", "declined", "pending", "late", "paid"]),
  draft: draftSchema,
  outcome: outcomeSchema,
  checkUntil: z.number(),
  booking: bookingSchema.nullable(),
});
export type Attempt = z.infer<typeof attemptSchema>;
export const blankDraft = (): BookingDraft => ({
  mode: null,
  accountEmail: "",
  players: 1,
  slots: [],
  contact: blankContact(),
  accepted: false,
});
export const slotKey = (slot: Slot) => `${slot.date}|${slot.start}`;
export const orderedSlots = <T extends Slot>(slots: T[]) =>
  [...slots].sort((a, b) => slotKey(a).localeCompare(slotKey(b)));
export const totalCents = (draft: BookingDraft) =>
  draft.slots.length * PRICE_CENTS;
export const paymentLocked = (attempt: Attempt | null) =>
  !!attempt && ["checking", "pending", "late", "paid"].includes(attempt.status);
export function overlaps(a: Slot, b: Slot) {
  return (
    a.date === b.date &&
    clockMinutes(a.start) < clockMinutes(b.start) + SESSION_MINUTES &&
    clockMinutes(b.start) < clockMinutes(a.start) + SESSION_MINUTES
  );
}
// Slots are Singapore wall times regardless of the device timezone. Browser time
// is a demo clock only; a live adapter must revalidate with trusted server time.
export function isElapsed(slot: Slot, now = Date.now()): boolean {
  return Date.parse(`${slot.date}T${slot.start}:00+08:00`) <= now;
}
export function selectionErrors(slots: Slot[], now = Date.now()): string[] {
  const today = todaySG(new Date(now));
  if (!slots.length) return ["Choose at least one session."];
  const max = new Date(`${today}T12:00:00Z`);
  max.setUTCMonth(max.getUTCMonth() + 12, 0);
  if (
    slots.some(
      (slot) =>
        !slotSchema.safeParse(slot).success ||
        slot.date > max.toISOString().slice(0, 10) ||
        !SESSION_STARTS.includes(clockMinutes(slot.start)),
    )
  )
    return ["Choose a valid session within the booking window."];
  if (slots.some((slot) => isElapsed(slot, now)))
    return [
      "A selected session has started. Remove it and choose a future time.",
    ];
  if (
    slots.some((slot, i) =>
      slots.slice(0, i).some((other) => overlaps(slot, other)),
    )
  )
    return ["Selected sessions must not overlap."];
  return [];
}
export function draftError(draft: BookingDraft): string | null {
  if (!draftSchema.safeParse(draft).success || !draft.mode)
    return "Review your booking options.";
  if (draft.mode === "member" && !draft.accountEmail)
    return "Verify your email again.";
  const errors = selectionErrors(draft.slots);
  if (errors.length) return errors[0];
  if (
    Object.keys(
      contactErrors(
        draft.contact,
        draft.mode === "member" ? draft.accountEmail : undefined,
      ),
    ).length
  )
    return "Review your contact details.";
  if (!draft.accepted) return "Review and accept the booking information.";
  return null;
}
export function snapshot(draft: BookingDraft): BookingDraft {
  return structuredClone({
    ...draft,
    slots: orderedSlots(draft.slots),
    contact: normalizeContact(draft.contact),
  });
}
export const BOOKING_STEPS = [
  "account",
  "session",
  "time",
  "details",
  "review",
  "payment",
  "confirmation",
] as const;
export type BookingStep = (typeof BOOKING_STEPS)[number];
export function guardedStep(
  requested: BookingStep,
  draft: BookingDraft,
  attempt: Attempt | null,
  now = Date.now(),
): BookingStep {
  if (attempt?.status === "paid") return "confirmation";
  if (paymentLocked(attempt)) return "payment";
  if (requested === "confirmation") return "account";
  if (requested !== "account" && !draft.mode) return "account";
  if (
    ["details", "review", "payment"].includes(requested) &&
    (!draft.slots.length ||
      !z.array(sessionSchema).safeParse(draft.slots).success ||
      selectionErrors(draft.slots, now).length > 0)
  )
    return "time";
  if (
    ["review", "payment"].includes(requested) &&
    Object.keys(
      contactErrors(
        draft.contact,
        draft.mode === "member" ? draft.accountEmail : undefined,
      ),
    ).length
  )
    return "details";
  if (requested === "payment" && (!attempt || !draft.accepted)) return "review";
  return requested;
}
