import { z } from "zod";
import {
  attemptSchema,
  blankDraft,
  draftSchema,
  instructorSchema,
} from "@/domain/booking";
import { demoSession } from "./demo/schedule";
const storedSchema = z.object({
  version: z.literal(2),
  draft: draftSchema,
  attempt: attemptSchema.nullable(),
});
export type StoredBooking = z.infer<typeof storedSchema>;
const KEY = "soccerbot-next-demo-v2";
const LEGACY_KEY = "soccerbot-next-demo-v1";
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
function upgradeDraft(value: unknown): unknown {
  const draft = record(value);
  if (!draft || !("instructor" in draft) || !Array.isArray(draft.slots))
    return value;
  const instructor = instructorSchema.safeParse(draft.instructor);
  return {
    ...draft,
    slots: draft.slots.map((value: unknown) => {
      const slot = record(value);
      if (
        !slot ||
        typeof slot.date !== "string" ||
        typeof slot.start !== "string"
      )
        return value;
      const session = demoSession({ date: slot.date, start: slot.start });
      return session
        ? {
            ...session,
            ...(instructor.success ? { instructor: instructor.data } : {}),
          }
        : value;
    }),
  };
}
export function upgradeBooking(value: unknown): unknown {
  const booking = record(value),
    draft = record(booking?.draft);
  if (
    !booking ||
    !draft ||
    !("instructor" in draft) ||
    !Array.isArray(booking.slots)
  )
    return value;
  const next = record(upgradeDraft({ ...draft, slots: booking.slots }));
  const slots = next?.slots as unknown[] | undefined;
  return {
    ...booking,
    draft: upgradeDraft(draft),
    slots: slots?.map((slot, i) => ({
      ...record(slot),
      studio: record((booking.slots as unknown[])[i])?.studio,
    })),
  };
}
function upgradeStored(value: unknown): unknown {
  const stored = record(value);
  if (stored?.version !== 1) return value;
  const attempt = record(stored.attempt);
  return {
    ...stored,
    version: 2,
    draft: upgradeDraft(stored.draft),
    attempt: attempt
      ? {
          ...attempt,
          draft: upgradeDraft(attempt.draft),
          booking: upgradeBooking(attempt.booking),
        }
      : null,
  };
}
export function safeRead(key: string, persistent = false): unknown {
  try {
    return JSON.parse(
      (persistent ? localStorage : sessionStorage).getItem(key) || "null",
    );
  } catch {
    return null;
  }
}
export function safeWrite(
  key: string,
  value: unknown,
  persistent = false,
): void {
  try {
    (persistent ? localStorage : sessionStorage).setItem(
      key,
      JSON.stringify(value),
    );
  } catch {
    /* Private browsing may deny persistence. In-memory flow remains available. */
  }
}
export function safeRemove(key: string, persistent = false): void {
  try {
    (persistent ? localStorage : sessionStorage).removeItem(key);
  } catch {
    /* Storage can be disabled. */
  }
}
export function loadBooking(): StoredBooking {
  const parsed = storedSchema.safeParse(
    safeRead(KEY) ?? upgradeStored(safeRead(LEGACY_KEY)),
  );
  return parsed.success
    ? parsed.data
    : { version: 2, draft: blankDraft(), attempt: null };
}
export function saveBooking(value: StoredBooking) {
  safeWrite(KEY, value);
}
