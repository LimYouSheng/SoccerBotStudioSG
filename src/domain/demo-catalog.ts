import { SESSION_MINUTES, START_INTERVAL_MINUTES } from "./booking-policy";
export {
  SESSION_MINUTES,
  START_INTERVAL_MINUTES,
  MAX_PLAYERS,
} from "./booking-policy";
import { z } from "zod";
// Explicit Preview fixtures; never a live catalogue or fallback.
export const PRICE_CENTS = 8800;
export const SERVICE_NAME = "Kickoff Special (Trial Price)";
export const OPENING_MINUTE = 9 * 60;
export const CLOSING_MINUTE = 21 * 60;
export const SESSION_STARTS = Array.from(
  {
    length:
      Math.floor(
        (CLOSING_MINUTE - OPENING_MINUTE - SESSION_MINUTES) /
          START_INTERVAL_MINUTES,
      ) + 1,
  },
  (_, i) => OPENING_MINUTE + i * START_INTERVAL_MINUTES,
);
export const STUDIOS = ["Studio 1"] as const;
export const INSTRUCTORS = {
  faisal: {
    name: "Faisal Shahril",
    initials: "FS",
    role: "Main instructor",
    bio: "A football player, trainer and coach, Faisal is SOCCERBOTSTUDIO Singapore’s main instructor and has the most hands-on experience with the studio’s SoccerBot360 system. He runs sessions for players at every level, guides coaches and trains the studio’s other instructors.",
  },
  daniel: {
    name: "Daniel Tan",
    initials: "DT",
    role: "Demo instructor",
    bio: "Demonstration profile. Guides players through ball control, passing and shooting drills, adapting each session to the group’s experience and goals.",
  },
  instructor3: {
    name: "Instructor 3",
    initials: "I3",
    role: "Demo instructor",
    bio: "Preview profile. Final instructor details will be provided by the studio.",
  },
  instructor4: {
    name: "Instructor 4",
    initials: "I4",
    role: "Demo instructor",
    bio: "Preview profile. Final instructor details will be provided by the studio.",
  },
} as const;
export type InstructorId = keyof typeof INSTRUCTORS;

export const demoInstructorSchema = z.enum([
  "faisal",
  "daniel",
  "instructor3",
  "instructor4",
]);
