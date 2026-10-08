import { measure } from "./diagnostics";
import { ApiError } from "./policy";
import { historicalComparison } from "./provider-normalization";
import {
  providerRequest,
  providerSecrets,
  type ProviderFamily,
} from "./provider-transport";

export type ProviderControl = {
  reserve: () => Promise<string>;
  finish: (id: string, cooldown: number) => void;
  claim: (family: ProviderFamily) => { generation: number; claim: string };
  complete: (
    family: ProviderFamily,
    claim: string,
    generation: number,
  ) => boolean;
  pause: () => void;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(503, "provider_representation_unknown");
  return value as Record<string, unknown>;
};
// Instance-owned by the account DO. Tokens never cross RPC or enter SQL/logs.
export class ProviderSession {
  private tokens = new Map<ProviderFamily, { value: string; until: number }>();
  private authentication = new Map<ProviderFamily, Promise<string>>();
  private identityRead: Promise<Record<string, unknown>> | undefined;
  private comparisonRead: Promise<Record<string, unknown>> | undefined;
  private cachedIdentity:
    { value: Record<string, unknown>; until: number } | undefined;

  async comparison(
    env: Env,
    control: ProviderControl,
  ): Promise<Record<string, unknown>> {
    const sharedComparison = this.comparisonRead;
    if (sharedComparison)
      return measure("coordinator_wait", () => sharedComparison);
    const run = async () => {
      const secrets = providerSecrets(env);
      if (secrets.company.toLowerCase() === "soccerbotstudio")
        throw new ApiError(503, "client_account_forbidden");
      const token = await this.token("admin", env, control);
      const identity = object(
        await providerRequest("identity", secrets, token, control),
      );
      if (identity.login !== secrets.company)
        throw new ApiError(503, "provider_identity_unverified");
      const booking = object(
        await providerRequest("historical-booking", secrets, token, control),
      );
      const invoice = object(
        await providerRequest("historical-invoice", secrets, token, control),
      );
      if (String(booking.id) !== "23" || String(invoice.id) !== "23")
        throw new ApiError(503, "provider_reference_unverified");
      return historicalComparison(booking, invoice);
    };
    const pending = run();
    this.comparisonRead = pending;
    try {
      return await pending;
    } catch (error) {
      this.tokens.clear();
      control.pause();
      throw error;
    } finally {
      this.comparisonRead = undefined;
    }
  }

  private async token(
    family: ProviderFamily,
    env: Env,
    control: ProviderControl,
  ) {
    const current = this.tokens.get(family);
    if (current && current.until > Date.now()) return current.value;
    const shared = this.authentication.get(family);
    if (shared) return measure("coordinator_wait", () => shared);
    const authenticate = async () => {
      const claim = control.claim(family);
      const result = await providerRequest(
        family === "public" ? "public-auth" : "admin-auth",
        providerSecrets(env),
        undefined,
        control,
      );
      if (family === "admin") {
        const challenge = object(result).require2fa;
        if (challenge !== undefined && challenge !== false)
          throw new ApiError(503, "provider_auth_representation_unknown");
      }
      const value = family === "public" ? result : object(result).token;
      if (
        typeof value !== "string" ||
        value.length < 16 ||
        value.length > 8192 ||
        /[\r\n]/.test(value)
      )
        throw new ApiError(503, "provider_auth_representation_unknown");
      if (!control.complete(family, claim.claim, claim.generation))
        throw new ApiError(503, "provider_auth_stale");
      // Local conservative retention, not an assertion of provider expiry.
      this.tokens.set(family, { value, until: Date.now() + 60000 });
      return value;
    };
    const pending = authenticate();
    this.authentication.set(family, pending);
    try {
      return await pending;
    } finally {
      this.authentication.delete(family);
    }
  }

  async identity(
    env: Env,
    control: ProviderControl,
  ): Promise<Record<string, unknown>> {
    if (this.cachedIdentity && this.cachedIdentity.until > Date.now())
      return this.cachedIdentity.value;
    const sharedIdentity = this.identityRead;
    if (sharedIdentity)
      return measure("coordinator_wait", () => sharedIdentity);
    const run = async () => {
      const secrets = providerSecrets(env);
      if (secrets.company.toLowerCase() === "soccerbotstudio")
        throw new ApiError(503, "client_account_forbidden");
      const start = performance.now();
      await this.token("public", env, control);
      const admin = await this.token("admin", env, control);
      const authMs = performance.now() - start;
      const info = object(
        await providerRequest("identity", secrets, admin, control),
      );
      // Unrecognised fields are a blocked representation, never an account match.
      if (info.login !== secrets.company)
        throw new ApiError(503, "provider_identity_unverified");
      const identityMs = performance.now() - start - authMs;
      const tariff = object(
        await providerRequest("tariff", secrets, admin, control),
      );
      const limits = Array.isArray(tariff.limits) ? tariff.limits : [];
      const allowance = limits
        .map(object)
        .find((v) => v.key === "sheduler_limit");
      const total = allowance?.total,
        remaining = allowance?.rest;
      const value = {
        verified: true,
        publicAuthenticated: true,
        adminAuthenticated: true,
        companyMatched: true,
        bookingAllowance:
          typeof total === "number" && typeof remaining === "number"
            ? { total, remaining }
            : null,
        apiQuota: "unverified",
        observedAtMs: Date.now(),
        timings: {
          authMs,
          identityMs,
          tariffMs: performance.now() - start - authMs - identityMs,
        },
      };
      this.cachedIdentity = { value, until: Date.now() + 5000 };
      return value;
    };
    const pending = run();
    this.identityRead = pending;
    try {
      return await pending;
    } catch (error) {
      this.tokens.clear();
      control.pause();
      throw error;
    } finally {
      this.identityRead = undefined;
    }
  }
}
