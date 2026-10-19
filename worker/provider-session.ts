import { hitpayRecoveryEnabled } from "./hitpay-contract";
import { discoveryFields } from "./field-discovery";
import { CatalogueReads } from "./catalogue";
import { NativePrebooking, type NativeAccountContract } from "./prebooking";
import { measure } from "./diagnostics";
import { ApiError, policy, liveCustomerAccess } from "./policy";
import { historicalComparison } from "./provider-normalization";
import {
  providerRequest,
  providerSecrets,
  type ProviderFamily,
  type NativeRequest,
} from "./provider-transport";

export type ProviderControl = {
  liveCustomer?: boolean;
  financialRecovery?: boolean;
  reconciled?: (id: string, attemptId: string) => void;
  reserve: () => Promise<string>;
  finish: (
    id: string,
    cooldown: number,
    reason?: "read_transport_ended",
  ) => void;
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
// No physical request failed when local admission/refresh coordination refused
// a read. Preserve its existing deadline and valid tokens instead of turning
// each visitor retry into another minute of account-wide unavailability.
const locallyBlocked = (error: unknown) =>
  error instanceof ApiError &&
  ["cooldown", "provider_refresh_busy", "concurrency", "rate"].includes(
    error.code,
  );
// Instance-owned by the account DO. Tokens never cross RPC or enter SQL/logs.
export class ProviderSession {
  private catalogueReads = new CatalogueReads();
  private boundScope: string | undefined;
  invalidateCatalogue(env: Env) {
    const p = policy(env),
      secrets = this.bindScope(env);
    this.catalogueReads.invalidate({
      accountId: p.DEPLOYMENT_ACCOUNT_ID,
      environmentId: p.ENVIRONMENT,
      companyLogin: secrets.company,
    });
  }
  private bindScope(env: Env) {
    const secrets = providerSecrets(env);
    const key = JSON.stringify([
      env.ENVIRONMENT,
      env.DEPLOYMENT_ACCOUNT_ID,
      secrets.company,
    ]);
    if (this.boundScope !== undefined && key !== this.boundScope)
      throw new ApiError(503, "provider_scope_changed");
    this.boundScope = key;
    return secrets;
  }
  async catalogue(env: Env, control: ProviderControl, fresh = false) {
    const p = policy(env),
      secrets = this.bindScope(env);
    if (
      p.PROVIDER_ACCESS !== "trusted-reads" ||
      (p.CAMPAIGN_END_MS <= Date.now() &&
        !(control.liveCustomer && liveCustomerAccess(env)))
    )
      throw new ApiError(503, "provider_access_disabled");
    return this.catalogueReads.read(
      {
        accountId: p.DEPLOYMENT_ACCOUNT_ID,
        environmentId: p.ENVIRONMENT,
        companyLogin: secrets.company,
      },
      async (request, signal) => {
        signal?.throwIfAborted();
        await this.identity(env, control);
        return this.nativeRead(env, control, request, signal);
      },
      fresh,
      !!control.liveCustomer && liveCustomerAccess(env),
    );
  }
  prebooking(
    env: Env,
    control: ProviderControl,
    contract?: NativeAccountContract,
    observe?: (operation: NativeRequest["kind"], body?: unknown) => void,
  ) {
    const p = policy(env),
      secrets = this.bindScope(env);
    return new NativePrebooking(
      {
        accountId: p.DEPLOYMENT_ACCOUNT_ID,
        environmentId: p.ENVIRONMENT,
        companyLogin: secrets.company,
      },
      this.catalogueReads,
      async (request, signal) => {
        observe?.(request.kind);
        signal?.throwIfAborted();
        // A multi-read review can outlast identity freshness. Refresh explicitly
        // through the same finite admission owner, never inside nativeRead.
        await this.identity(env, control);
        const response = await this.nativeRead(env, control, request, signal);
        observe?.(request.kind, response.body);
        return response;
      },
      contract,
      !!control.liveCustomer && liveCustomerAccess(env),
    );
  }
  // One named discovery only. Caller supplies the existing durable admission owner,
  // never a URL, method, service ID or a browser assertion of verification.
  async discoverFields(env: Env, control: ProviderControl) {
    const p = policy(env);
    if (
      p.PROVIDER_ACCESS !== "trusted-reads" ||
      (p.CAMPAIGN_END_MS <= Date.now() &&
        !(control.liveCustomer && liveCustomerAccess(env)))
    )
      throw new ApiError(503, "provider_access_disabled");
    await this.identity(env, control);
    const receipt = await this.nativeRead(env, control, {
      kind: "required-fields",
      serviceId: "2",
    });
    return {
      verified: true,
      evidence: "field_configuration_only",
      serviceId: "2",
      observedAtMs: receipt.receivedAtMs,
      fields: discoveryFields(receipt.body),
      persistenceVerified: false,
    };
  }
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
    this.bindScope(env);
    const sharedComparison = this.comparisonRead;
    if (sharedComparison)
      return measure("coordinator_wait", () => sharedComparison);
    const run = async () => {
      const secrets = this.bindScope(env);
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
      if (!locallyBlocked(error)) {
        this.tokens.clear();
        control.pause();
      }
      throw error;
    } finally {
      this.comparisonRead = undefined;
    }
  }

  // Read-only internal transport. Finite checkout uses the separate nativeWrite
  // entry with durable grant validation; a read grant can never dispatch writes.
  async nativeRead(
    env: Env,
    control: ProviderControl,
    request: NativeRequest,
    signal?: AbortSignal,
  ) {
    if (
      String(env.PROVIDER_ACCESS) !== "trusted-reads" ||
      (Number(env.CAMPAIGN_END_MS) <= Date.now() &&
        !(control.liveCustomer && liveCustomerAccess(env)) &&
        !(control.financialRecovery && hitpayRecoveryEnabled(env)))
    )
      throw new ApiError(503, "provider_access_disabled");
    if (
      request.kind === "invoice-external-payment" ||
      request.kind === "booking-comment" ||
      request.kind === "book" ||
      request.kind === "payment-link" ||
      request.kind === "batch-create" ||
      request.kind === "batch-close" ||
      request.kind === "booking-cancel" ||
      request.kind === "webhook-create" ||
      request.kind === "webhook-delete"
    )
      throw new ApiError(503, "native_write_grant_unavailable");
    if (
      control.financialRecovery &&
      !["booking-read", "invoice-read"].includes(request.kind)
    )
      throw new ApiError(503, "provider_operation_unavailable");
    signal?.throwIfAborted();
    const secrets = this.bindScope(env);
    if (secrets.company.toLowerCase() === "soccerbotstudio")
      throw new ApiError(503, "client_account_forbidden");
    // Only previously authenticated, identity-verified sessions may read; no
    // automatic reauthentication may consume the two-read recovery reserve.
    if (!this.cachedIdentity || this.cachedIdentity.until <= Date.now())
      throw new ApiError(503, "provider_identity_expired");
    const family =
      request.kind === "invoice-read" ||
      request.kind === "webhook-subscriptions"
        ? "admin"
        : "public";
    const token = this.tokens.get(family);
    if (!token || token.until <= Date.now())
      throw new ApiError(503, "provider_auth_expired");
    const body = await providerRequest(
      "native",
      secrets,
      token.value,
      control,
      request,
      signal,
    ).catch((error: unknown) => this.rejectAuthentication(error));
    return { body, receivedAtMs: Date.now() };
  }

  // Trusted finite-grant composition only. The callback checks the durable
  // grant, guest capability, attempt and budget immediately before each write.
  async nativeWrite(
    env: Env,
    control: ProviderControl,
    request: NativeRequest,
    authority:
      | (() => Promise<void>)
      | {
          beforeIdentity: () => Promise<void>;
          beforeWrite: () => Promise<void>;
        },
    onReserved?: (id: string) => Promise<void>,
  ) {
    const p = policy(env);
    if (
      p.PROVIDER_ACCESS !== "trusted-reads" ||
      (p.CAMPAIGN_END_MS <= Date.now() &&
        !(control.liveCustomer && liveCustomerAccess(env)) &&
        !(control.financialRecovery && hitpayRecoveryEnabled(env)))
    )
      throw new ApiError(503, "provider_access_disabled");
    if (
      ![
        "invoice-external-payment",
        "booking-comment",
        "book",
        "batch-create",
        "batch-close",
        "payment-link",
        "booking-cancel",
        "webhook-create",
        "webhook-delete",
      ].includes(request.kind)
    )
      throw new ApiError(503, "provider_operation_unavailable");
    if (
      control.financialRecovery &&
      request.kind !== "invoice-external-payment"
    )
      throw new ApiError(503, "provider_operation_unavailable");
    if (
      request.kind === "invoice-external-payment" &&
      !control.financialRecovery
    )
      throw new ApiError(503, "financial_recovery_required");
    await (typeof authority === "function"
      ? authority()
      : authority.beforeIdentity());
    await this.identity(env, control);
    const secrets = this.bindScope(env);
    const family = [
      "invoice-external-payment",
      "booking-comment",
      "payment-link",
      "webhook-create",
      "webhook-delete",
    ].includes(request.kind)
      ? "admin"
      : "public";
    const token = this.tokens.get(family);
    if (!token || token.until <= Date.now())
      throw new ApiError(503, "provider_auth_expired");
    await (typeof authority === "function"
      ? authority()
      : authority.beforeWrite());
    const body = await providerRequest(
      "native",
      secrets,
      token.value,
      onReserved
        ? {
            ...control,
            reserve: async () => {
              const id = await control.reserve();
              await onReserved(id);
              return id;
            },
          }
        : control,
      request,
    ).catch((error: unknown) => this.rejectAuthentication(error));
    return { body, receivedAtMs: Date.now() };
  }

  private rejectAuthentication(error: unknown): never {
    if (error instanceof ApiError && error.code === "provider_auth_failed") {
      this.tokens.clear();
      this.cachedIdentity = undefined;
    }
    throw error;
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
      // Public tokens have a documented one-hour lifetime; retain for 50
      // minutes. Admin lifetime can be account-configured, so keep its
      // conservative minute until an explicit expiry contract is verified.
      this.tokens.set(family, {
        value,
        until: Date.now() + (family === "public" ? 50 * 60000 : 60000),
      });
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
    this.bindScope(env);
    if (this.cachedIdentity && this.cachedIdentity.until > Date.now())
      return this.cachedIdentity.value;
    const sharedIdentity = this.identityRead;
    if (sharedIdentity)
      return measure("coordinator_wait", () => sharedIdentity);
    const run = async () => {
      const secrets = this.bindScope(env);
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
      // Identity reads can cross our local token-retention boundary. Renew an
      // expired family through this explicit, accounted identity operation;
      // nativeRead still never reauthenticates or retries a request implicitly.
      await this.token("public", env, control);
      await this.token("admin", env, control);
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
      this.cachedIdentity = {
        value,
        until: Math.min(
          Date.now() + 30000,
          this.tokens.get("public")!.until,
          this.tokens.get("admin")!.until,
        ),
      };
      return value;
    };
    const pending = run();
    this.identityRead = pending;
    try {
      return await pending;
    } catch (error) {
      if (!locallyBlocked(error)) {
        this.tokens.clear();
        control.pause();
      }
      throw error;
    } finally {
      this.identityRead = undefined;
    }
  }
}
