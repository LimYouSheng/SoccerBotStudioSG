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
  type Session,
} from "@/domain/booking";
import { clock, clockMinutes } from "@/domain/dates";
import { SESSION_MINUTES, SESSION_STARTS, STUDIOS } from "@/domain/catalog";
import type { BookingService } from "../contracts";
import { safeRead, safeWrite, upgradeBooking } from "../storage";
import { demoSession } from "./schedule";
const RECEIPTS = "soccerbot-next-demo-receipts";
const receiptsSchema = z.record(
  z.string(),
  z.preprocess(upgradeBooking, bookingSchema),
);
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
function assign(slots: Session[]) {
  const assigned: Array<Session & { studio: string }> = [];
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
  availability(date) {
    return SESSION_STARTS.map((minute) => {
      const slot = demoSession({ date, start: clock(minute) })!;
      return { ...slot, available: availableStudios(slot).length > 0 };
    });
  },
  checkout(draft, previous) {
    if (paymentLocked(previous))
      throw new Error(
        "A payment is already in progress. Check its status before starting another.",
      );
    const error = draftError(draft);
    if (error) throw new Error(error);
    if (
      draft.slots.some((slot) => {
        const assigned = demoSession(slot);
        return (
          !assigned ||
          assigned.instructor !== slot.instructor ||
          assigned.rotationAt !== slot.rotationAt
        );
      })
    )
      throw new Error(
        "An instructor assignment has changed. Review your selected sessions.",
      );
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
      checkUntil: Date.now() + 5000,
    };
  },
  check(attempt) {
    if (attempt.status !== "pending") return attempt;
    return {
      ...attempt,
      status: "checking",
      outcome: "success",
      checkUntil: Date.now() + 5000,
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
