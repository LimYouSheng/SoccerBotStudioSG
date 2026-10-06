import type { Session, Slot } from "@/domain/booking";
import {
  CLOSING_MINUTE,
  OPENING_MINUTE,
  SESSION_MINUTES,
  SESSION_STARTS,
  type InstructorId,
} from "@/domain/catalog";
import { clock, clockMinutes } from "@/domain/dates";
const ROTATION: InstructorId[] = [
  "faisal",
  "daniel",
  "instructor3",
  "instructor4",
];
// The starting instructor remains for the full session, including a crossing.
export function demoSession(slot: Slot): Session | null {
  const minute = clockMinutes(slot.start);
  if (
    minute < OPENING_MINUTE ||
    minute + SESSION_MINUTES > CLOSING_MINUTE ||
    !SESSION_STARTS.includes(minute)
  )
    return null;
  const block = Math.floor((minute - OPENING_MINUTE) / 180);
  const boundary = OPENING_MINUTE + (block + 1) * 180;
  return {
    ...slot,
    instructor: ROTATION[block],
    ...(minute + SESSION_MINUTES > boundary
      ? { rotationAt: clock(boundary) }
      : {}),
  };
}
