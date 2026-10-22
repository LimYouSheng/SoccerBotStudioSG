// Approved business policy, independent of provider catalogue and demo fixtures.
export const SESSION_MINUTES = 40;
export const CHANGEOVER_MINUTES = 10;
export const START_INTERVAL_MINUTES = SESSION_MINUTES + CHANGEOVER_MINUTES;
export const MAX_PLAYERS = 4;
export const STUDIO_CAPACITY = 1;
// Current customer booking rule: booking closes 240 minutes before the start.
export const BOOKING_LEAD_MINUTES = 240;
export const BOOKING_LEAD_MS = BOOKING_LEAD_MINUTES * 60 * 1000;
// Retained only for historical finite trial contracts, not customer browsing.
export const NATIVE_TRIAL_LEAD_MS = 48 * 60 * 60 * 1000;

// Singapore daily opening window. The full playing session must finish by close.
export const OPENING_MINUTE = 12 * 60;
export const CLOSING_MINUTE = 20 * 60;
/** Check whether a session start falls within studio opening hours. */
export function withinOpeningHours(startMs: number): boolean {
  if (!Number.isFinite(startMs)) return false;
  const elapsedMs = (startMs + 8 * 3600000) % 86400000;
  return (
    elapsedMs >= OPENING_MINUTE * 60000 &&
    elapsedMs + SESSION_MINUTES * 60000 <= CLOSING_MINUTE * 60000
  );
}
