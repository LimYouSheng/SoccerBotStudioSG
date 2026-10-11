import { z } from "zod";
import { blankContact } from "@/domain/contact";
import type { CustomerIdentityService, VerifiedIdentity } from "./contracts";

const identitySchema = z.strictObject({
  email: z.email(),
  expiresAt: z.number().int().positive().safe(),
  remember: z.boolean().optional(),
});
const challengeSchema = z.strictObject({
  challengeId: z.string().uuid(),
  expiresAt: z.number().int().positive().safe(),
  resendAfter: z.number().int().nonnegative().safe(),
});
const profileSchema = z.strictObject({
  email: z.email(),
  contact: z
    .strictObject({
      name: z.string().min(2).max(80),
      phone: z.string().min(8).max(24),
    })
    .nullable(),
});
const savedSchema = z.strictObject({
  email: z.email(),
  saved: z.literal(true),
});
const unavailable = () =>
  new Error("Email verification is unavailable. You can continue as a guest.");
async function identityRequest(
  path: string,
  method: "GET" | "POST" | "DELETE",
  signal: AbortSignal,
  body?: unknown,
) {
  const response = await fetch(path, {
    method,
    signal,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (path === "/api/identity/all-devices" && response.status === 401)
      throw new Error(
        "Verify your email again before signing out all devices.",
      );
    throw unavailable();
  }
  if (!response.body) throw unavailable();
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let text = "",
    size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 4096) throw unavailable();
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
// Display cache only. The server cookie/challenge remains authoritative, and no
// browser storage can establish verified ownership or a provider client binding.
export function createLiveIdentityService(): CustomerIdentityService {
  let current: VerifiedIdentity | null = null,
    generation = 0;
  const read = async (signal: AbortSignal) => {
    const own = ++generation;
    try {
      const raw = await identityRequest("/api/identity", "GET", signal);
      const value = identitySchema.nullable().parse(raw);
      if (signal.aborted || own !== generation) throw unavailable();
      current = value && value.expiresAt > Date.now() ? value : null;
      return current;
    } catch (error) {
      if (own === generation) current = null;
      throw error;
    }
  };
  return {
    mode: "live",
    current: () => (current && current.expiresAt > Date.now() ? current : null),
    refresh: async (signal) => {
      const own = ++generation;
      current = null;
      const check = () => {
        if (signal.aborted || own !== generation) throw unavailable();
      };
      await identityRequest("/api/access", "POST", signal);
      check();
      let value = identitySchema
        .nullable()
        .parse(await identityRequest("/api/identity", "GET", signal));
      check();
      if (!value || value.expiresAt <= Date.now()) {
        await identityRequest("/api/identity/restore", "POST", signal);
        check();
        value = identitySchema
          .nullable()
          .parse(await identityRequest("/api/identity", "GET", signal));
        check();
      }
      current = value && value.expiresAt > Date.now() ? value : null;
      return current;
    },
    guest: async (signal) => {
      await identityRequest("/api/access", "POST", signal);
    },
    challenge: async (email, signal, botToken) => {
      const normalized = z.email().parse(email.trim().toLowerCase());
      if (!botToken || botToken.length > 2048) throw unavailable();
      ++generation;
      current = null;
      await identityRequest("/api/access", "POST", signal);
      const response = challengeSchema.parse(
        await identityRequest("/api/identity/challenges", "POST", signal, {
          email: normalized,
          botToken,
        }),
      );
      if (signal.aborted || response.expiresAt <= Date.now())
        throw unavailable();
      return { ...response, email: normalized };
    },
    verify: async (challenge, code, remember, signal) => {
      const own = ++generation;
      current = null;
      const value = identitySchema.parse(
        await identityRequest("/api/identity/verify", "POST", signal, {
          challengeId: challenge.challengeId,
          email: challenge.email,
          code,
          remember,
        }),
      );
      // Verification response is not cached: a subsequent authenticated read
      // detects session revocation/replacement during the in-flight operation.
      if (
        signal.aborted ||
        own !== generation ||
        value.email !== challenge.email ||
        value.expiresAt <= Date.now()
      )
        throw unavailable();
      const verified = await read(signal);
      if (!verified || verified.email !== challenge.email) throw unavailable();
      return verified;
    },
    profile: async (email, signal) => {
      if (
        !current ||
        current.expiresAt <= Date.now() ||
        current.email !== email
      )
        return null;
      const own = generation;
      const value = profileSchema.parse(
        await identityRequest("/api/identity/contact", "GET", signal),
      );
      if (
        signal.aborted ||
        own !== generation ||
        !current ||
        current.expiresAt <= Date.now() ||
        current.email !== email ||
        value.email !== email
      )
        throw unavailable();
      return value.contact
        ? { ...blankContact(), email, ...value.contact }
        : null;
    },
    saveProfile: async (contact, signal) => {
      if (
        !current ||
        current.remember !== true ||
        current.expiresAt <= Date.now() ||
        current.email !== contact.email
      )
        throw unavailable();
      const own = generation;
      const value = savedSchema.parse(
        await identityRequest("/api/identity/contact", "POST", signal, {
          email: contact.email,
          name: contact.name,
          phone: contact.phone,
        }),
      );
      if (
        signal.aborted ||
        own !== generation ||
        !current ||
        current.expiresAt <= Date.now() ||
        current.email !== contact.email ||
        value.email !== contact.email
      )
        throw unavailable();
    },
    signOut: async (signal, allDevices = false) => {
      ++generation;
      current = null;
      await identityRequest(
        allDevices ? "/api/identity/all-devices" : "/api/access",
        "DELETE",
        signal,
      );
    },
  };
}
export const liveCustomerIdentity = createLiveIdentityService();
