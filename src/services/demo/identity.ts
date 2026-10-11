import { z } from "zod";
import { blankContact, normalizeContact, validEmail } from "@/domain/contact";
import type {
  IdentityService,
  CustomerIdentityService,
  AuthChallenge,
} from "../contracts";
import { safeRead, safeRemove, safeWrite } from "../storage";
const KEY = "soccerbot-next-demo-identity";
const PROFILES = "soccerbot-next-demo-profiles";
const identitySchema = z.object({
  email: z.email(),
  expiresAt: z.number(),
  remember: z.boolean().optional(),
});
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
function saveContact(
  contact: Parameters<CustomerIdentityService["saveProfile"]>[0],
) {
  const parsed = profilesSchema.safeParse(safeRead(PROFILES));
  const normalized = normalizeContact(contact);
  safeWrite(PROFILES, {
    ...(parsed.success ? parsed.data : {}),
    [normalized.email]: { name: normalized.name, phone: normalized.phone },
  });
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
      remember,
      expiresAt: Date.now() + (remember ? 90 * 86400_000 : 12 * 3600_000),
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
    if (
      draft.mode !== "member" ||
      read()?.email !== draft.accountEmail ||
      read()?.remember !== true
    )
      return;
    saveContact({ ...draft.contact, email: draft.accountEmail });
  },
};

// Preview remains explicitly separate; no demo code enters the live adapter.
const previewChallenges = new Map<string, AuthChallenge>();
export const demoCustomerIdentity: CustomerIdentityService = {
  mode: "demo",
  current: demoIdentityService.read,
  refresh: async () => demoIdentityService.read(),
  guest: async () => {},
  challenge: async (email) => {
    const value = demoIdentityService.challenge(email),
      id = crypto.randomUUID();
    previewChallenges.clear();
    previewChallenges.set(id, value);
    return {
      email: value.email,
      expiresAt: value.expiresAt,
      challengeId: id,
      resendAfter: 0,
    };
  },
  verify: async (challenge, code, remember) => {
    const value = previewChallenges.get(challenge.challengeId);
    if (!value || value.email !== challenge.email)
      throw new Error("Request a new verification code.");
    return demoIdentityService.verify(value, code, remember);
  },
  profile: async (email) => demoIdentityService.profile(email),
  saveProfile: async (contact, signal) => {
    if (
      signal.aborted ||
      read()?.email !== contact.email ||
      read()?.remember !== true
    )
      throw new Error("Verify your email again.");
    saveContact(contact);
  },
  signOut: async () => {
    previewChallenges.clear();
    demoIdentityService.signOut();
  },
};
