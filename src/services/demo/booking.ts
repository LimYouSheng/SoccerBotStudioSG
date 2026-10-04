import { z } from "zod";
import {
  bookingSchema,
  draftError,
  orderedSlots,
  paymentLocked,
  slotKey,
  snapshot,
  totalCents,
  type Slot,
} from "@/domain/booking";
import { clock, clockMinutes } from "@/domain/dates";
import {
  INSTRUCTORS,
  SESSION_MINUTES,
  SESSION_STARTS,
  STUDIOS,
  type InstructorId,
} from "@/domain/catalog";
import type { BookingService } from "../contracts";
import { safeRead, safeWrite } from "../storage";
const RECEIPTS = "soccerbot-next-demo-receipts";
const receiptsSchema = z.record(z.string(), bookingSchema);
const INVENTORY = "soccerbot-next-demo-inventory";
const inventorySchema = z.array(z.string());
function blocked() {
  const parsed = inventorySchema.safeParse(safeRead(INVENTORY));
  return new Set(parsed.success ? parsed.data : []);
}
function studioKey(slot: Slot, studio: string) {
  return `${studio}|${slotKey(slot)}`;
}
function availableStudios(slot: Slot): string[] {
  const unavailable = blocked();
  const weekday = new Date(`${slot.date}T12:00:00Z`).getUTCDay();
  const from = clockMinutes(slot.start);
  return STUDIOS.filter((studio, index) => {
    if (unavailable.has(studioKey(slot, studio))) return false;
    const occupied = SESSION_STARTS.filter(
      (_, i) => i > 0 && (weekday + i + index * 3) % 7 === 0,
    );
    return !occupied.some(
      (time) => from < time + SESSION_MINUTES && from + SESSION_MINUTES > time,
    );
  });
}
function assign(slots: Slot[]) {
  const assigned: Array<Slot & { studio: string }> = [];
  let previous: string | null = null;
  for (const slot of orderedSlots(slots)) {
    const options = availableStudios(slot);
    const studio: string | undefined =
      previous && options.includes(previous) ? previous : options[0];
    if (!studio) return null;
    assigned.push({ ...slot, studio });
    previous = studio;
  }
  return assigned;
}
export const demoBookingService: BookingService = {
  instructors(slots) {
    if (!slots.length) return [];
    return (Object.keys(INSTRUCTORS) as InstructorId[]).filter(
      (_, index) =>
        index === 0 ||
        slots.every(
          (slot) =>
            (clockMinutes(slot.start) / 50 +
              new Date(`${slot.date}T12:00:00Z`).getUTCDay() +
              index) %
              3 !==
            0,
        ),
    );
  },
  availability(date) {
    return SESSION_STARTS.map((minute) => {
      const slot = { date, start: clock(minute) };
      return { ...slot, available: availableStudios(slot).length > 0 };
    });
  },
  checkout(draft, previous, simulateConflict = false) {
    if (paymentLocked(previous))
      throw new Error(
        "A payment is already in progress. Check its status before starting another.",
      );
    const error = draftError(draft);
    if (error) throw new Error(error);
    if (
      !draft.instructor ||
      !demoBookingService.instructors(draft.slots).includes(draft.instructor)
    )
      throw new Error(
        "Choose an instructor available for all selected sessions.",
      );
    if (simulateConflict) {
      const unavailable = blocked();
      STUDIOS.forEach((studio) =>
        unavailable.add(studioKey(draft.slots[0], studio)),
      );
      safeWrite(INVENTORY, [...unavailable]);
    }
    if (!draft.slots.every((slot) => availableStudios(slot).length > 0))
      throw new Error(
        "A selected session is no longer available. No sessions were booked. Please review your selections.",
      );
    return {
      id: `SB360-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      status: "ready",
      draft: snapshot(draft),
      outcome: "success",
      checkUntil: 0,
      booking: null,
    };
  },
  pay(attempt, outcome) {
    if (!["ready", "declined"].includes(attempt.status)) return attempt;
    return {
      ...attempt,
      status: "checking",
      outcome,
      checkUntil: Date.now() + 1000,
    };
  },
  check(attempt) {
    if (attempt.status !== "pending") return attempt;
    return {
      ...attempt,
      status: "checking",
      outcome: "success",
      checkUntil: Date.now() + 1000,
    };
  },
  resolve(attempt, now = Date.now()) {
    if (attempt.status !== "checking" || now < attempt.checkUntil)
      return attempt;
    if (attempt.outcome !== "success")
      return { ...attempt, status: attempt.outcome };
    const existing = receiptsSchema.safeParse(safeRead(RECEIPTS));
    if (existing.success && existing.data[attempt.id])
      return { ...attempt, status: "paid", booking: existing.data[attempt.id] };
    const slots = assign(attempt.draft.slots);
    if (!slots) return { ...attempt, status: "late" };
    const inventory = blocked();
    slots.forEach((slot) => inventory.add(studioKey(slot, slot.studio)));
    safeWrite(INVENTORY, [...inventory]);
    const booking = {
      reference: attempt.id,
      createdAt: new Date(now).toISOString(),
      draft: snapshot(attempt.draft),
      slots,
      totalCents: totalCents(attempt.draft),
    };
    safeWrite(RECEIPTS, {
      ...(existing.success ? existing.data : {}),
      [attempt.id]: booking,
    });
    return { ...attempt, status: "paid", booking };
  },
};
