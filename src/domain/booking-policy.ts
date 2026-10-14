// Approved business policy, independent of provider catalogue and demo fixtures.
export const SESSION_MINUTES = 40;
export const CHANGEOVER_MINUTES = 10;
export const START_INTERVAL_MINUTES = SESSION_MINUTES + CHANGEOVER_MINUTES;
export const MAX_PLAYERS = 4;
export const STUDIO_CAPACITY = 1;
// Current customer booking rule: booking closes 150 minutes before the start.
export const BOOKING_LEAD_MINUTES = 150;
export const BOOKING_LEAD_MS = BOOKING_LEAD_MINUTES * 60 * 1000;
// Retained only for historical finite trial contracts, not customer browsing.
export const NATIVE_TRIAL_LEAD_MS = 48 * 60 * 60 * 1000;
