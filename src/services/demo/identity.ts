import { z } from "zod";
import { blankContact, normalizeContact, validEmail } from "@/domain/contact";
import type { IdentityService } from "../contracts";
import { safeRead, safeRemove, safeWrite } from "../storage";
const KEY = "soccerbot-next-demo-identity";
const PROFILES = "soccerbot-next-demo-profiles";
const identitySchema = z.object({ email: z.email(), expiresAt: z.number() });
const profilesSchema = z.record(
  z.string(),
  z.object({ name: z.string(), phone: z.string() }),
);
export const DEMO_CODE = "360360";
function read() {
  for (const persistent of [false, true]) {
    const parsed = identitySchema.safeParse(safeRead(KEY, persistent));
    if (parsed.success && parsed.data.expiresAt > Date.now())
      return parsed.data;
  }
  return null;
}
export const demoIdentityService: IdentityService = {
  read,
  challenge(email) {
    const normalized = email.trim().toLowerCase();
    if (!validEmail(normalized))
      throw new Error("Enter a valid email address.");
    return {
      email: normalized,
      expiresAt: Date.now() + 600_000,
      used: false,
      attempts: 0,
    };
  },
  verify(challenge, code, remember) {
    if (
      challenge.used ||
      challenge.expiresAt <= Date.now() ||
      challenge.attempts >= 5
    )
      throw new Error("This code has expired. Request a new code.");
    challenge.attempts++;
    if (code !== DEMO_CODE)
      throw new Error("The verification code is incorrect.");
    challenge.used = true;
    const identity = {
      email: challenge.email,
      expiresAt: Date.now() + (remember ? 30 * 86400_000 : 12 * 3600_000),
    };
    safeRemove(KEY, true);
    safeWrite(KEY, identity);
    if (remember) safeWrite(KEY, identity, true);
    return identity;
  },
  signOut() {
    safeRemove(KEY);
    safeRemove(KEY, true);
  },
  profile(email) {
    if (read()?.email !== email) return null;
    const parsed = profilesSchema.safeParse(safeRead(PROFILES));
    return parsed.success && parsed.data[email]
      ? { ...blankContact(), email, ...parsed.data[email] }
      : null;
  },
  saveProfile(draft) {
    if (draft.mode !== "member" || read()?.email !== draft.accountEmail) return;
    const parsed = profilesSchema.safeParse(safeRead(PROFILES));
    const contact = normalizeContact(draft.contact);
    safeWrite(PROFILES, {
      ...(parsed.success ? parsed.data : {}),
      [draft.accountEmail]: { name: contact.name, phone: contact.phone },
    });
  },
};
