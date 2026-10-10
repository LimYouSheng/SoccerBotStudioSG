import { z } from "zod";
import type { CustomerIdentityService, VerifiedIdentity } from "./contracts";

const identitySchema = z.strictObject({
  email: z.email(),
  expiresAt: z.number().int().positive().safe(),
});
const challengeSchema = z.strictObject({
  challengeId: z.string().uuid(),
  expiresAt: z.number().int().positive().safe(),
  resendAfter: z.number().int().nonnegative().safe(),
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
    profile: async () => null, // Actual private provider lookup remains unavailable.
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
