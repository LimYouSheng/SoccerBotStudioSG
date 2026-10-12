import { manageWebhookSubscription } from "./webhook-subscriptions";
import {
  executeNativeCheckout,
  customerNativeAvailability,
} from "./native-checkout";
import { z } from "zod";
import { intentSchema, associationSchema } from "./journal";
import { runNativeReadback } from "./recovery";
import {
  storedNativeSignature,
  recoverNativeAssociation,
} from "./native-adapter";
import { providerSecrets } from "./provider-transport";
import { bookingWallTime } from "./provider-normalization";
import { offeredStarts } from "./prebooking";
import {
  inspectNativeSetup,
  webhookSubscriptionStructure,
} from "./native-setup";
import {
  residualGrant,
  recoverNativeResidual,
  type ResidualAuthority,
} from "./native-residual";
import { DurableObject } from "cloudflare:workers";
import { traced, measure, instrumentStorage } from "./diagnostics";
import { ApiError, policy, rpcOutcome } from "./policy";
import { ProviderSession, type ProviderControl } from "./provider-session";
// One instance per actual provider account. No booking or customer data here.
export class SoccerBotAccountCoordinator extends DurableObject<Env> {
  private provider = new ProviderSession();
  private nativeAvailabilityQueue: Promise<unknown> = Promise.resolve();
  private get sql() {
    return instrumentStorage(this.ctx.storage.sql);
  }
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS budget (campaign TEXT PRIMARY KEY, used INTEGER NOT NULL, cooldown_ms INTEGER NOT NULL DEFAULT 0)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS refreshes (key TEXT PRIMARY KEY, generation INTEGER NOT NULL, claim TEXT NOT NULL, expires_ms INTEGER NOT NULL, completed_ms INTEGER)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS admissions (id TEXT PRIMARY KEY, campaign TEXT NOT NULL, started_ms INTEGER NOT NULL, finished INTEGER NOT NULL DEFAULT 0)",
    );
  }
  admit(recovery: boolean) {
    const p = policy(this.env);
    const now = Date.now();
    if (!["disabled", "trusted-reads"].includes(this.env.PROVIDER_ACCESS))
      throw new Error("Unsupported provider mode");
    // Synthetic admission exercises accounting only. No outbound provider path is enabled.
    if (
      !Number.isSafeInteger(Number(this.env.CAMPAIGN_END_MS)) ||
      now >= Number(this.env.CAMPAIGN_END_MS)
    )
      return { allowed: false, reason: "campaign_closed" };
    const sql = this.sql;
    return this.ctx.storage.transactionSync(() => {
      sql.exec(
        "INSERT OR IGNORE INTO budget(campaign,used) VALUES(?,0)",
        this.env.CAMPAIGN_ID,
      );
      const budget = sql
        .exec<{ used: number; cooldown_ms: number }>(
          "SELECT used,cooldown_ms FROM budget WHERE campaign=?",
          this.env.CAMPAIGN_ID,
        )
        .one();
      if (budget.used >= p.PROVIDER_CALL_CEILING - (recovery ? 0 : 16))
        return { allowed: false, reason: "budget_exhausted" };
      if (budget.cooldown_ms > now)
        return { allowed: false, reason: "cooldown" };
      // Unknown in-flight requests survive restart and hold admission closed.
      if (
        sql
          .exec<{ n: number }>(
            "SELECT count(*) n FROM admissions WHERE finished=0",
          )
          .one().n >= 2
      )
        return { allowed: false, reason: "concurrency" };
      if (
        sql
          .exec<{ n: number }>(
            "SELECT count(*) n FROM admissions WHERE started_ms>?",
            now - 1000,
          )
          .one().n >= 4
      )
        return { allowed: false, reason: "rate" };
      const id = crypto.randomUUID();
      sql.exec(
        "INSERT INTO admissions(id,campaign,started_ms) VALUES(?,?,?)",
        id,
        this.env.CAMPAIGN_ID,
        now,
      );
      sql.exec(
        "UPDATE budget SET used=used+1 WHERE campaign=?",
        this.env.CAMPAIGN_ID,
      );
      return { allowed: true, id, used: budget.used + 1 };
    });
  }
  private providerControl(recovery = false): ProviderControl {
    return {
      reserve: async () =>
        measure("coordinator", async () => {
          const admitted = this.admit(recovery);
          if (!admitted.allowed || !admitted.id)
            throw new ApiError(
              503,
              admitted.reason || "provider_admission_denied",
            );
          await measure("storage", () => this.ctx.storage.sync());
          return admitted.id;
        }),
      finish: (id, cooldown) => this.finish(id, cooldown),
      claim: (family) => {
        const row = this.sql
          .exec<{
            generation: number;
            expires_ms: number;
            completed_ms: number | null;
          }>(
            "SELECT generation,expires_ms,completed_ms FROM refreshes WHERE key=?",
            `token:${family}`,
          )
          .toArray()[0];
        if (row && row.completed_ms === null && row.expires_ms > Date.now())
          throw new ApiError(503, "provider_refresh_busy");
        const generation = (row?.generation ?? 0) + 1;
        const claimed = this.claimRefresh(`token:${family}`, generation);
        if (!claimed.granted || !claimed.claim)
          throw new ApiError(503, "provider_refresh_busy");
        return { generation, claim: claimed.claim };
      },
      complete: (family, claim, generation) =>
        this.completeRefresh(`token:${family}`, claim, generation),
      pause: () => this.finish("", 60000),
    };
  }
  async providerRead(
    operation:
      "provider_identity" | "historical_comparison" | "native_field_discovery",
    correlationId: string,
    expiresMs?: number,
  ) {
    return traced(correlationId, "coordinator", async () => {
      policy(this.env);
      if (String(this.env.PROVIDER_ACCESS) !== "trusted-reads")
        throw new ApiError(503, "provider_access_disabled");
      try {
        if (
          operation !== "provider_identity" &&
          operation !== "historical_comparison" &&
          operation !== "native_field_discovery"
        )
          throw new ApiError(503, "provider_operation_unavailable");
        const control = this.providerControl();
        if (operation === "native_field_discovery") {
          const now = Date.now();
          if (
            !Number.isSafeInteger(expiresMs) ||
            !expiresMs ||
            expiresMs <= now ||
            expiresMs > now + 180000
          )
            throw new ApiError(503, "discovery_window_invalid");
          const initial = this.providerAccounting();
          if (initial.used !== 8 || initial.active !== 0)
            throw new ApiError(503, "discovery_accounting_changed");
          let reserved = 0;
          let lastDispatch = 0;
          const bounded = {
            ...control,
            reserve: async () => {
              const delay = Math.max(0, lastDispatch + 300 - Date.now());
              if (delay)
                await new Promise((resolve) => setTimeout(resolve, delay));
              if (
                Date.now() + 15000 >= expiresMs ||
                reserved >= 5 ||
                this.providerAccounting().used >= 13
              )
                throw new ApiError(503, "discovery_limit_reached");
              reserved++;
              lastDispatch = Date.now();
              return control.reserve();
            },
          };
          const result = await this.provider.discoverFields(this.env, bounded);
          if (Date.now() >= expiresMs)
            throw new ApiError(503, "discovery_expired");
          return { ...result, accounting: this.providerAccounting() };
        }
        const result =
          operation === "provider_identity"
            ? await this.provider.identity(this.env, control)
            : await this.provider.comparison(this.env, control);
        return { ...result, accounting: this.providerAccounting() };
      } catch (error) {
        return {
          verified: false,
          reason:
            error instanceof ApiError
              ? error.code
              : "provider_proof_incomplete",
          accounting: this.providerAccounting(),
        };
      }
    });
  }
  // A one-use operator grant owns this read-only calendar range. Customer
  // grants still admit only their two exact dates after operator selection.
  async webhookSubscription(
    capabilityHash: string,
    action: "create" | "cleanup",
    correlationId: string,
  ) {
    return traced(correlationId, "coordinator", () =>
      rpcOutcome(() =>
        manageWebhookSubscription(
          this.env,
          this.provider,
          this.providerControl(),
          () => this.providerAccounting(),
          capabilityHash,
          action,
        ),
      ),
    );
  }
  async nativeDiscoveryProbe(
    rawScope: unknown,
    expiresMs: number,
    correlationId: string,
  ) {
    return traced(correlationId, "coordinator", async () => {
      const p = policy(this.env),
        now = Date.now();
      const webhookScope = z
        .strictObject({
          kind: z.literal("native-webhook-structure"),
          sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
          accountId: z.string().min(1).max(128),
          startingUsed: z.number().int().nonnegative().safe(),
          maxCalls: z.literal(6),
        })
        .safeParse(rawScope);
      if (webhookScope.success) {
        const scope = webhookScope.data,
          initial = this.providerAccounting();
        if (
          p.PROVIDER_ACCESS !== "trusted-reads" ||
          p.CAMPAIGN_END_MS <= now ||
          scope.sourceRevision !== p.SOURCE_REVISION ||
          scope.accountId !== p.DEPLOYMENT_ACCOUNT_ID ||
          !Number.isSafeInteger(expiresMs) ||
          expiresMs <= now ||
          expiresMs > now + 180000 ||
          expiresMs > p.CAMPAIGN_END_MS ||
          initial.used !== scope.startingUsed ||
          initial.active !== 0 ||
          scope.startingUsed + 6 > p.PROVIDER_CALL_CEILING - 16
        ) {
          throw new ApiError(503, "webhook_inspection_scope_unavailable");
        }
        const control = this.providerControl();
        let count = 0,
          last = Date.now();
        const bounded: ProviderControl = {
          ...control,
          reserve: async () => {
            const delay = Math.max(0, last + 300 - Date.now());
            if (delay)
              await new Promise((resolve) => setTimeout(resolve, delay));
            if (
              Date.now() + 15000 >= Math.min(expiresMs, p.CAMPAIGN_END_MS) ||
              count >= 6 ||
              this.providerAccounting().used >= scope.startingUsed + 6
            )
              throw new ApiError(503, "webhook_inspection_exhausted");
            count++;
            last = Date.now();
            return control.reserve();
          },
        };
        await this.provider.identity(this.env, bounded);
        const response = await this.provider.nativeRead(this.env, bounded, {
          kind: "webhook-subscriptions",
        });
        if (Date.now() >= expiresMs)
          throw new ApiError(503, "webhook_inspection_expired");
        return {
          verified: true,
          evidence: "subscription_structure_only",
          normalized: false,
          representation: webhookSubscriptionStructure(response.body),
          accounting: this.providerAccounting(),
        };
      }
      const parsed = z
        .strictObject({
          kind: z.enum(["native-calendar", "native-setup"]),
          sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
          accountId: z.string().min(1).max(128),
          serviceId: z.literal("2"),
          instructorId: z.literal("3"),
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          startingUsed: z.number().int().nonnegative().safe(),
          maxCalls: z.union([z.literal(6), z.literal(16)]),
        })
        .refine(
          (value) =>
            value.maxCalls === (value.kind === "native-calendar" ? 6 : 16),
        )
        .safeParse(rawScope);
      if (!parsed.success)
        throw new ApiError(503, "calendar_scope_unavailable");
      const scope = parsed.data;
      const from = bookingWallTime(scope.from + " 00:00:00", "Asia/Singapore");
      const to = bookingWallTime(scope.to + " 00:00:00", "Asia/Singapore");
      const initial = this.providerAccounting();
      if (
        p.ENVIRONMENT !== "developer" ||
        p.PROVIDER_ACCESS !== "trusted-reads" ||
        p.CAMPAIGN_END_MS <= now ||
        scope.sourceRevision !== String(this.env.SOURCE_REVISION) ||
        scope.accountId !== p.DEPLOYMENT_ACCOUNT_ID ||
        !Number.isSafeInteger(expiresMs) ||
        expiresMs <= now ||
        expiresMs > now + 180000 ||
        expiresMs > p.CAMPAIGN_END_MS ||
        from - now < 48 * 3600000 ||
        to < from ||
        to - from > 14 * 86400000 ||
        (scope.kind === "native-setup" && to - from > 86400000) ||
        initial.used !== scope.startingUsed ||
        initial.active !== 0 ||
        scope.startingUsed + scope.maxCalls > p.PROVIDER_CALL_CEILING - 16
      )
        throw new ApiError(503, "calendar_scope_unavailable");
      const control = this.providerControl();
      let count = 0,
        last = 0;
      const bounded = {
        ...control,
        reserve: async () => {
          const delay = Math.max(0, last + 300 - Date.now());
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          if (
            Date.now() + 15000 >= Math.min(expiresMs, p.CAMPAIGN_END_MS) ||
            count >= scope.maxCalls ||
            this.providerAccounting().used >=
              scope.startingUsed + scope.maxCalls
          )
            throw new ApiError(503, "calendar_scope_exhausted");
          count++;
          last = Date.now();
          return control.reserve();
        },
      };
      try {
        if (scope.kind === "native-setup") {
          const result = await inspectNativeSetup(
            async (request) => {
              await this.provider.identity(this.env, bounded);
              return this.provider.nativeRead(this.env, bounded, request);
            },
            scope.from,
            scope.to,
          );
          if (Date.now() >= expiresMs)
            throw new ApiError(503, "calendar_scope_expired");
          return {
            ...result,
            kind: scope.kind,
            from: scope.from,
            to: scope.to,
            serviceId: scope.serviceId,
            instructorId: scope.instructorId,
            accounting: this.providerAccounting(),
          };
        }
        await this.provider.identity(this.env, bounded);
        const response = await this.provider.nativeRead(this.env, bounded, {
          kind: "availability-range",
          serviceId: scope.serviceId,
          instructorId: scope.instructorId,
          from: scope.from,
          to: scope.to,
        });
        if (Date.now() >= expiresMs)
          throw new ApiError(503, "calendar_scope_expired");
        const matrix = z.record(z.string(), z.unknown()).parse(response.body);
        if (Object.keys(matrix).length > 15)
          throw new ApiError(503, "calendar_representation_unavailable");
        const dates = Object.keys(matrix)
          .sort()
          .map((date) => {
            const start = bookingWallTime(date + " 00:00:00", "Asia/Singapore");
            if (start < from || start > to)
              throw new ApiError(503, "calendar_representation_unavailable");
            return {
              date,
              starts: offeredStarts({ [date]: matrix[date] }, date).sort(),
            };
          })
          .filter((entry) => entry.starts.length > 0);
        return {
          verified: true,
          kind: scope.kind,
          from: scope.from,
          to: scope.to,
          serviceId: scope.serviceId,
          instructorId: scope.instructorId,
          dates,
          accounting: this.providerAccounting(),
        };
      } catch (error) {
        return {
          verified: false,
          reason:
            error instanceof ApiError
              ? error.code
              : "calendar_proof_incomplete",
          accounting: this.providerAccounting(),
        };
      }
    });
  }
  async customerCatalogue(
    scope: { startingUsed: number; maxCalls: number; expiresMs: number },
    correlationId: string,
  ) {
    return traced(correlationId, "coordinator", async () => {
      const p = policy(this.env),
        initial = this.providerAccounting();
      if (
        p.PROVIDER_ACCESS !== "trusted-reads" ||
        Date.now() >= p.CAMPAIGN_END_MS ||
        !Number.isSafeInteger(scope.expiresMs) ||
        scope.expiresMs <= Date.now() ||
        scope.expiresMs > Date.now() + 180000 ||
        scope.maxCalls !== 6 ||
        !Number.isSafeInteger(scope.startingUsed) ||
        scope.startingUsed < 0 ||
        scope.startingUsed > 58 ||
        initial.used !== scope.startingUsed ||
        initial.active !== 0
      )
        throw new ApiError(503, "catalogue_scope_unavailable");
      const control = this.providerControl();
      let count = 0,
        last = 0;
      const bounded = {
        ...control,
        reserve: async () => {
          const delay = Math.max(0, last + 300 - Date.now());
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          if (
            Date.now() + 15000 >=
              Math.min(scope.expiresMs, p.CAMPAIGN_END_MS) ||
            count >= 6 ||
            this.providerAccounting().used >= scope.startingUsed + 6
          )
            throw new ApiError(503, "catalogue_scope_exhausted");
          count++;
          last = Date.now();
          return control.reserve();
        },
      };
      await this.provider.identity(this.env, bounded);
      const result = await this.provider.catalogue(this.env, bounded, true);
      return {
        environment: result.binding.environmentId,
        observedAtMs: result.observedAtMs,
        complete: result.complete,
        services: result.services,
        instructors: result.instructors,
      };
    });
  }
  async nativeAvailability(
    scope: { date: string; serviceId: string; cookie: string },
    correlationId: string,
  ) {
    const pending = this.nativeAvailabilityQueue.then(() =>
      traced(correlationId, "coordinator", () =>
        customerNativeAvailability({
          request: new Request(this.env.APP_ORIGIN, {
            headers: { cookie: scope.cookie },
          }),
          env: this.env,
          date: scope.date,
          serviceId: scope.serviceId,
          provider: this.provider,
          control: this.providerControl(),
          accounting: () => this.providerAccounting(),
        }),
      ),
    );
    this.nativeAvailabilityQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return rpcOutcome(() => pending);
  }
  async nativeCheckout(
    scope: { attemptId: string; cookie: string },
    correlationId: string,
  ) {
    return rpcOutcome(() =>
      traced(correlationId, "coordinator", () =>
        executeNativeCheckout({
          request: new Request(this.env.APP_ORIGIN, {
            headers: { cookie: scope.cookie },
          }),
          env: this.env,
          attemptId: scope.attemptId,
          provider: this.provider,
          control: this.providerControl(),
          recoveryControl: this.providerControl(true),
          accounting: () => this.providerAccounting(),
        }),
      ),
    );
  }
  async nativeRecovery(
    scope: {
      attemptId: string;
      startingUsed: number;
      maximumUsed: number;
      expiresMs: number;
      invocationId: string;
      useRecoveryReserve?: boolean;
      residual?: ResidualAuthority;
    },
    correlationId: string,
  ) {
    return traced(correlationId, "coordinator", async () => {
      const p = policy(this.env),
        initial = this.providerAccounting(),
        now = Date.now();
      z.string().uuid().parse(scope.attemptId);
      z.string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(scope.invocationId);
      if (
        p.PROVIDER_ACCESS !== "trusted-reads" ||
        now >= p.CAMPAIGN_END_MS ||
        !Number.isSafeInteger(scope.expiresMs) ||
        scope.expiresMs <= now ||
        scope.expiresMs > now + 180000 ||
        !Number.isSafeInteger(scope.startingUsed) ||
        !Number.isSafeInteger(scope.maximumUsed) ||
        scope.startingUsed < 0 ||
        scope.maximumUsed >
          p.PROVIDER_CALL_CEILING -
            (scope.useRecoveryReserve === true ? 0 : 16) ||
        (scope.useRecoveryReserve === true &&
          scope.maximumUsed - scope.startingUsed > 16) ||
        scope.maximumUsed - scope.startingUsed > 30 ||
        scope.maximumUsed - scope.startingUsed < 6 ||
        initial.used < scope.startingUsed ||
        initial.used + 6 > scope.maximumUsed ||
        (scope.residual?.mode === "inspect" &&
          (scope.useRecoveryReserve === true ||
            scope.maximumUsed - scope.startingUsed !== 6)) ||
        initial.active !== 0
      )
        throw new ApiError(503, "recovery_window_unavailable");
      const row = await this.env.STATE.withSession("first-primary")
        .prepare(
          scope.residual?.mode === "inspect"
            ? "SELECT intent_json,association_json FROM attempts WHERE id=? AND state='recovery_required' AND association_json IS NULL AND ?>0"
            : "SELECT a.intent_json,a.association_json FROM attempts a JOIN recovery_work r ON r.attempt_id=a.id WHERE a.id=? AND a.state IN ('dispatching','observed','recovery_required') AND r.state IN ('due','claimed') AND r.ready_ms<=? AND r.tries<5",
        )
        .bind(scope.attemptId, now)
        .first<{ intent_json: string; association_json: string | null }>();
      if (!row) return { outcomes: [], reads: 0 };
      const intent = intentSchema.parse(JSON.parse(row.intent_json)),
        refs = row.association_json
          ? associationSchema.parse(JSON.parse(row.association_json))
          : null;
      if (
        intent.accountId !== p.DEPLOYMENT_ACCOUNT_ID ||
        intent.environmentId !== p.ENVIRONMENT ||
        (refs !== null && refs.bookingIds.length !== intent.sessions.length)
      )
        throw new ApiError(503, "native_recovery_scope_mismatch");
      const secret: unknown = Reflect.get(
        this.env,
        "SIMPLYBOOK_DEV_SIGNING_SECRET",
      );
      if (typeof secret !== "string")
        throw new ApiError(503, "native_signing_unavailable");
      const maximumCalls = scope.residual
        ? Math.min(16, scope.maximumUsed - initial.used)
        : intent.sessions.length + 5;
      if (initial.used + maximumCalls > scope.maximumUsed)
        throw new ApiError(503, "recovery_window_unavailable");
      const control = this.providerControl(scope.useRecoveryReserve === true);
      let count = 0,
        last = 0;
      const bounded = {
        ...control,
        reserve: async () => {
          if (scope.residual)
            await residualGrant(this.env, {
              ...scope,
              residual: scope.residual,
            });
          const delay = Math.max(0, last + 300 - Date.now());
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          if (
            Date.now() + 15000 >=
              Math.min(scope.expiresMs, p.CAMPAIGN_END_MS) ||
            count >= maximumCalls ||
            this.providerAccounting().used >= scope.maximumUsed
          )
            throw new ApiError(503, "recovery_window_exhausted");
          count++;
          last = Date.now();
          return control.reserve();
        },
      };
      if (scope.residual) {
        const authority = scope.residual;
        const assertGranted = () =>
          residualGrant(this.env, { ...scope, residual: authority });
        await assertGranted();
        return recoverNativeResidual({
          db: this.env.STATE,
          scope: {
            attemptId: scope.attemptId,
            companyLogin: providerSecrets(this.env).company,
            timezone: "Asia/Singapore",
            intent,
          },
          authority,
          expiresMs: scope.expiresMs,
          signingSecret: secret,
          assertGranted,
          invalidate: () => this.provider.invalidateCatalogue(this.env),
          exchange: async (operation, signal) => {
            await assertGranted();
            signal?.throwIfAborted();
            if (
              authority.mode === "inspect" &&
              operation.kind !== "booking-read"
            )
              throw new ApiError(
                503,
                "native_inspection_operation_unavailable",
              );
            if (operation.kind === "booking-cancel")
              return this.provider.nativeWrite(
                this.env,
                bounded,
                operation,
                assertGranted,
              );
            if (
              operation.kind !== "booking-read" &&
              operation.kind !== "invoice-read"
            )
              throw new ApiError(503, "native_residual_operation_unavailable");
            await this.provider.identity(this.env, bounded);
            return this.provider.nativeRead(
              this.env,
              bounded,
              operation,
              signal,
            );
          },
        });
      }
      await this.provider.identity(this.env, bounded);
      const company = providerSecrets(this.env).company;
      if (!refs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const recovered = await recoverNativeAssociation({
            db: this.env.STATE,
            scope: {
              attemptId: scope.attemptId,
              companyLogin: company,
              timezone: "Asia/Singapore",
              intent,
            },
            exchange: (operation, signal) =>
              this.provider.nativeRead(this.env, bounded, operation, signal),
            signingSecret: secret,
            signal: controller.signal,
          });
          return {
            outcomes: [
              {
                attemptId: scope.attemptId,
                state: "observed",
                reason: "association_reconciled",
              },
            ],
            reads: recovered.reads,
          };
        } finally {
          clearTimeout(timer);
          controller.abort();
        }
      }
      return runNativeReadback(this.env, {
        scope: {
          attemptId: scope.attemptId,
          companyLogin: company,
          timezone: "Asia/Singapore",
          intent,
        },
        claimant: `background-${scope.invocationId.slice(0, 32)}`,
        phase: "background",
        invocationId: scope.invocationId,
        grantExpiresMs: scope.expiresMs,
        exchange: (operation, signal) =>
          this.provider.nativeRead(this.env, bounded, operation, signal),
        signature: async (bookingId) => {
          if (!refs.bookingIds.includes(bookingId))
            throw new ApiError(503, "native_recovery_scope_mismatch");
          return storedNativeSignature(
            this.env.STATE,
            scope.attemptId,
            bookingId,
            secret,
          );
        },
      });
    });
  }
  // Retain the earlier RPC during rolling deployment; it grants no authority.
  discoveryAccounting() {
    policy(this.env);
    return this.providerAccounting();
  }
  discoveryReadiness() {
    const p = policy(this.env),
      now = Date.now();
    // Only exposed through the authenticated, existing operator grant. Read the
    // coordinator's own bindings: Worker health cannot establish RPC readiness.
    return {
      accounting: this.providerAccounting(),
      coordinator: {
        revision: p.SOURCE_REVISION,
        versionId: this.env.CF_VERSION_METADATA?.id ?? null,
        providerAccess: p.PROVIDER_ACCESS,
        campaignEndMs: p.CAMPAIGN_END_MS,
        effectiveProviderAccess:
          p.PROVIDER_ACCESS === "trusted-reads" && now < p.CAMPAIGN_END_MS
            ? "trusted-reads"
            : "disabled",
      },
    };
  }
  private providerAccounting() {
    const used =
      this.sql
        .exec<{ used: number }>(
          "SELECT used FROM budget WHERE campaign=?",
          this.env.CAMPAIGN_ID,
        )
        .toArray()[0]?.used ?? 0;
    const active = this.sql
      .exec<{ n: number }>("SELECT count(*) n FROM admissions WHERE finished=0")
      .one().n;
    return {
      used,
      active,
      ceiling: policy(this.env).PROVIDER_CALL_CEILING,
      recoveryReserve: 16,
    };
  }
  finish(id: string, cooldownMs = 0) {
    if (!Number.isInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 3600000)
      throw new Error("Invalid cooldown");
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "UPDATE admissions SET finished=1 WHERE id=? AND finished=0",
        id,
      );
      this.sql.exec(
        "UPDATE budget SET cooldown_ms=max(cooldown_ms,?) WHERE campaign=?",
        Date.now() + cooldownMs,
        this.env.CAMPAIGN_ID,
      );
    });
  }
  claimRefresh(key: string, generation: number) {
    if (
      !/^(confirmation:[a-f0-9-]{36}|token:(public|admin))$/.test(key) ||
      !Number.isSafeInteger(generation) ||
      generation < 0
    )
      throw new Error("Invalid refresh identity");
    const now = Date.now(),
      sql = this.sql;
    return this.ctx.storage.transactionSync(() => {
      const row = sql
        .exec<{
          generation: number;
          expires_ms: number;
          completed_ms: number | null;
        }>(
          "SELECT generation,expires_ms,completed_ms FROM refreshes WHERE key=?",
          key,
        )
        .toArray()[0];
      if (row && generation < row.generation)
        return { granted: false, reason: "stale_generation" };
      if (
        row &&
        generation === row.generation &&
        (row.expires_ms > now ||
          (row.completed_ms !== null && now - row.completed_ms < 5000))
      )
        return { granted: false, reason: "shared_refresh" };
      const claim = crypto.randomUUID();
      sql.exec(
        "INSERT INTO refreshes(key,generation,claim,expires_ms) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET generation=excluded.generation,claim=excluded.claim,expires_ms=excluded.expires_ms,completed_ms=NULL",
        key,
        generation,
        claim,
        now + 30000,
      );
      return { granted: true, claim };
    });
  }
  completeRefresh(key: string, claim: string, generation: number) {
    const now = Date.now();
    this.sql.exec(
      "UPDATE refreshes SET completed_ms=?,expires_ms=? WHERE key=? AND claim=? AND generation=? AND expires_ms>?",
      now,
      now,
      key,
      claim,
      generation,
      now,
    );
    return this.sql.exec<{ n: number }>("SELECT changes() n").one().n === 1;
  }
}
