import { z } from "zod";
import { attemptSchema, blankDraft, draftSchema } from "@/domain/booking";
const storedSchema = z.object({
  version: z.literal(1),
  draft: draftSchema,
  attempt: attemptSchema.nullable(),
});
export type StoredBooking = z.infer<typeof storedSchema>;
const KEY = "soccerbot-next-demo-v1";
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
  const parsed = storedSchema.safeParse(safeRead(KEY));
  return parsed.success
    ? parsed.data
    : { version: 1, draft: blankDraft(), attempt: null };
}
export function saveBooking(value: StoredBooking) {
  safeWrite(KEY, value);
}
