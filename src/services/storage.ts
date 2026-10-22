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
/** Migrate a stored draft into the current client schema. */
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
/** Migrate a stored booking into the current client schema. */
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
/** Validate and upgrade the persisted client booking state. */
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
/** Read local storage without propagating unavailable-storage errors. */
export function safeRead(key: string, persistent = false): unknown {
  try {
    return JSON.parse(
      (persistent ? localStorage : sessionStorage).getItem(key) || "null",
    );
  } catch {
    return null;
  }
}
/** Write local state while tolerating unavailable browser storage. */
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
/** Remove local state while tolerating unavailable browser storage. */
export function safeRemove(key: string, persistent = false): void {
  try {
    (persistent ? localStorage : sessionStorage).removeItem(key);
  } catch {
    /* Storage can be disabled. */
  }
}
/** Load validated persisted booking state. */
export function loadBooking(): StoredBooking {
  const parsed = storedSchema.safeParse(
    safeRead(KEY) ?? upgradeStored(safeRead(LEGACY_KEY)),
  );
  return parsed.success
    ? parsed.data
    : { version: 2, draft: blankDraft(), attempt: null };
}
/** Persist the permitted booking state fields. */
export function saveBooking(value: StoredBooking) {
  safeWrite(KEY, value);
}

// An editable live draft is display data only. Attempts and payment authority
// are always restored from the authenticated server, never browser storage.
/** Load the client draft without treating it as server authority. */
export function loadLiveDraft() {
  const parsed = draftSchema.safeParse(safeRead("soccerbot-live-draft"));
  return parsed.success ? { ...parsed.data, accepted: false } : blankDraft();
}
/** Persist the live booking draft for browser continuity. */
export function saveLiveDraft(draft: StoredBooking["draft"]) {
  safeWrite("soccerbot-live-draft", { ...draft, accepted: false });
}
