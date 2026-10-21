import {
  createConfirmationTrace,
  confirmationTraceKey,
  runConfirmationTrace,
  finishConfirmationTrace,
} from "./confirmation-tracing";
import {
  createCheckoutTrace,
  runCheckoutTrace,
  finishCheckoutTrace,
} from "./checkout-tracing";
import { annotatePendingBooking } from "./native-comments";
import { DisplaySnapshots } from "./display-snapshots";
import { expireCheckout } from "./checkout-progress";
import { dismissCompletedCheckout } from "./completed-checkout";
import {
  BOOKING_LEAD_MS,
  withinOpeningHours,
} from "../src/domain/booking-policy";
import { ProviderQueue } from "./provider-queue";
import { payHitpayHold } from "./hitpay-hold";
import { hitpayRecoveryEnabled } from "./hitpay-contract";
import { recoverHitpay } from "./hitpay-recovery";
import { ongoingReadbackDue } from "./ongoing-readback";
import {
  authorizeCustomerCheckout,
  rejectedCheckoutReadback,
} from "./customer-authority";
import {
  publicCalendar,
  calendarWindow,
  hasPublicCalendarWindow,
  windowCatalogue,
  windowCalendar,
  windowAvailability,
} from "./public-calendar";
import { authenticate } from "./access";
import { NativeCalendarReads } from "./native-calendar";
import { manageWebhookSubscription } from "./webhook-subscriptions";
import {
  prepareCustomerNative,
  executeNativeCheckout,
  customerNativeAvailability,
  customerNativeCalendar,
} from "./native-checkout";
import { z } from "zod";
import { nativePrepareSchema } from "../src/domain/native-checkout";
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
import { ApiError, policy, rpcOutcome, liveCustomerAccess } from "./policy";
import { ProviderSession, type ProviderControl } from "./provider-session";
// One instance per actual provider account. No booking or customer data here.
export class SoccerBotAccountCoordinator extends DurableObject<Env> {
  private readonly instanceId = crypto.randomUUID();
  private provider: ProviderSession;
  private calendarReads = new NativeCalendarReads();
  private providerQueue = new ProviderQueue();
  private admissionTurn: Promise<void> = Promise.resolve();
  private async reserveInOrder<T>(reserve: () => Promise<T>): Promise<T> {
    const previous = this.admissionTurn;
    let release!: () => void;
    this.admissionTurn = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await reserve();
    } finally {
      release();
    }
  }
  private get sql() {
    return instrumentStorage(this.ctx.storage.sql);
  }
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.provider = new ProviderSession(this.sql);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS budget (campaign TEXT PRIMARY KEY, used INTEGER NOT NULL, cooldown_ms INTEGER NOT NULL DEFAULT 0)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS refreshes (key TEXT PRIMARY KEY, generation INTEGER NOT NULL, claim TEXT NOT NULL, expires_ms INTEGER NOT NULL, completed_ms INTEGER)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS admissions (id TEXT PRIMARY KEY, campaign TEXT NOT NULL, started_ms INTEGER NOT NULL, finished INTEGER NOT NULL DEFAULT 0)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS admission_releases (id TEXT PRIMARY KEY, campaign TEXT NOT NULL, started_ms INTEGER NOT NULL, reason TEXT NOT NULL CHECK(reason IN ('read_transport_ended','reviewed_historical_read_timeout')), recorded_ms INTEGER NOT NULL, evidence TEXT)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS financial_releases(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,recorded_ms INTEGER NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS payment_wakeups(attempt_id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL, generation INTEGER NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS provider_request_admissions(id TEXT PRIMARY KEY,operation TEXT NOT NULL,read_only INTEGER NOT NULL CHECK(read_only IN (0,1)),instance_id TEXT NOT NULL,expires_ms INTEGER NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS provider_transport_releases(id TEXT PRIMARY KEY,operation TEXT NOT NULL,read_only INTEGER NOT NULL,recorded_ms INTEGER NOT NULL,reason TEXT NOT NULL)",
    );
    // Keep pacing/rate reads independent of retained admission history. The
    // partial index contains only reservations that still hold concurrency.
    ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS admissions_started_ms ON admissions(started_ms)",
    );
    ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS admissions_unfinished ON admissions(finished) WHERE finished=0",
    );
  }
  private recoverInterruptedTransports() {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO admission_releases(id,campaign,started_ms,reason,recorded_ms,evidence) SELECT a.id,a.campaign,a.started_ms,'read_transport_ended',?,r.operation FROM admissions a INDEXED BY admissions_unfinished JOIN provider_request_admissions r ON r.id=a.id WHERE a.finished=0 AND r.expires_ms<=? AND r.instance_id<>? AND r.read_only=1 ON CONFLICT(id) DO NOTHING",
        now,
        now,
        this.instanceId,
      );
      this.sql.exec(
        "INSERT INTO provider_transport_releases SELECT a.id,r.operation,r.read_only,?,'instance_ended' FROM admissions a INDEXED BY admissions_unfinished JOIN provider_request_admissions r ON r.id=a.id WHERE a.finished=0 AND r.expires_ms<=? AND r.instance_id<>? ON CONFLICT(id) DO NOTHING",
        now,
        now,
        this.instanceId,
      );
      this.sql.exec(
        "UPDATE admissions SET finished=1 WHERE id IN (SELECT a.id FROM admissions a INDEXED BY admissions_unfinished JOIN provider_request_admissions r ON r.id=a.id WHERE a.finished=0 AND r.expires_ms<=? AND r.instance_id<>?)",
        now,
        this.instanceId,
      );
    });
  }
  admit(
    recovery: boolean,
    customer = false,
    financial = false,
    metadata?: { operation: string; readOnly: boolean },
  ) {
    this.recoverInterruptedTransports();
    const p = policy(this.env);
    const now = Date.now();
    const ongoing =
      (customer && liveCustomerAccess(this.env)) ||
      (financial && recovery && hitpayRecoveryEnabled(this.env));
    if (!["disabled", "trusted-reads"].includes(this.env.PROVIDER_ACCESS))
      throw new Error("Unsupported provider mode");
    // Synthetic admission exercises accounting only. No outbound provider path is enabled.
    if (
      !ongoing &&
      (!Number.isSafeInteger(Number(this.env.CAMPAIGN_END_MS)) ||
        now >= Number(this.env.CAMPAIGN_END_MS))
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
      if (
        !ongoing &&
        budget.used >= p.PROVIDER_CALL_CEILING - (recovery ? 0 : 16)
      )
        return { allowed: false, reason: "budget_exhausted" };
      if (budget.cooldown_ms > now)
        return { allowed: false, reason: "cooldown" };
      // Active transports and unidentified legacy reservations retain their slots.
      // Identified ended transports are independent of durable write outcomes.
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
      if (metadata)
        sql.exec(
          "INSERT INTO provider_request_admissions(id,operation,read_only,instance_id,expires_ms) VALUES(?,?,?,?,?)",
          id,
          metadata.operation,
          metadata.readOnly ? 1 : 0,
          this.instanceId,
          now + 30000,
        );
      sql.exec(
        "UPDATE budget SET used=used+1 WHERE campaign=?",
        this.env.CAMPAIGN_ID,
      );
      return { allowed: true, id, used: budget.used + 1 };
    });
  }
  private providerControl(
    recovery = false,
    customer = false,
    financial = false,
  ): ProviderControl {
    this.recoverInterruptedTransports();
    return {
      liveCustomer: customer,
      // A retained unknown request still owns its physical slot. Use the one
      // remaining slot sequentially rather than launching a two-read burst.
      parallelReads: this.providerAccounting().active === 0,
      financialRecovery: financial,
      reconciled: (id, attemptId) => {
        if (!financial || !recovery)
          throw new ApiError(403, "financial_recovery_required");
        this.ctx.storage.transactionSync(() => {
          this.sql.exec(
            "INSERT INTO financial_releases SELECT id,?,? FROM admissions WHERE id=? AND finished=0 ON CONFLICT(id) DO NOTHING",
            attemptId,
            Date.now(),
            id,
          );
          this.sql.exec(
            "UPDATE admissions SET finished=1 WHERE id=? AND finished=0",
            id,
          );
        });
      },
      reserve: async (metadata) =>
        this.reserveInOrder(() =>
          measure("coordinator", async () => {
            if (
              (customer && liveCustomerAccess(this.env)) ||
              (financial && recovery && hitpayRecoveryEnabled(this.env))
            ) {
              const last =
                this.sql
                  .exec<{ latest: number | null }>(
                    "SELECT MAX(started_ms) AS latest FROM admissions",
                  )
                  .one().latest ?? 0;
              const delay = Math.max(0, last + 300 - Date.now());
              if (delay)
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            const admitted = this.admit(
              recovery,
              customer,
              financial,
              metadata,
            );
            if (!admitted.allowed || !admitted.id)
              throw new ApiError(
                503,
                admitted.reason || "provider_admission_denied",
              );
            await measure("storage", () => this.ctx.storage.sync());
            return admitted.id;
          }),
        ),
      finish: (id, cooldown, reason) => this.finish(id, cooldown, reason),
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
        if (Date.now() >= Number(this.env.CAMPAIGN_END_MS))
          throw new ApiError(503, "campaign_closed");
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
          const bounded: ProviderControl = {
            ...control,
            reserve: async (metadata) => {
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
              return control.reserve(metadata);
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
          reserve: async (metadata) => {
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
            return control.reserve(metadata);
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
      const bounded: ProviderControl = {
        ...control,
        reserve: async (metadata) => {
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
          return control.reserve(metadata);
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
      const bounded: ProviderControl = {
        ...control,
        reserve: async (metadata) => {
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
          return control.reserve(metadata);
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
    scope: { date: string; serviceId: string; cookie: string; fresh?: boolean },
    correlationId: string,
  ) {
    const pending = this.providerQueue.run("foreground", () =>
      traced(correlationId, "coordinator", async () => {
        if (hasPublicCalendarWindow(this.env)) {
          await authenticate(
            new Request(this.env.APP_ORIGIN, {
              headers: { cookie: scope.cookie },
            }),
            this.env,
            Date.now(),
          );
          if (scope.fresh && this.displayWarmingEnabled())
            this.snapshots().invalidateCalendars();
          const result = await windowAvailability({
            ...this.calendarReadOptions(),
            ...scope,
          });
          await authenticate(
            new Request(this.env.APP_ORIGIN, {
              headers: { cookie: scope.cookie },
            }),
            this.env,
            Date.now(),
          );
          return result;
        }
        return customerNativeAvailability({
          request: new Request(this.env.APP_ORIGIN, {
            headers: { cookie: scope.cookie },
          }),
          env: this.env,
          date: scope.date,
          fresh: scope.fresh,
          invalidate: () => this.calendarReads.invalidateDate(scope.date),
          serviceId: scope.serviceId,
          provider: this.provider,
          control: this.providerControl(),
          accounting: () => this.providerAccounting(),
        });
      }),
    );
    return rpcOutcome(() => pending);
  }
  private displayWarmingEnabled() {
    return (
      liveCustomerAccess(this.env) &&
      policy(this.env).PUBLIC_DISPLAY_WARMING === "enabled"
    );
  }
  private snapshots() {
    const { binding, p } = calendarWindow(this.calendarReadOptions());
    return new DisplaySnapshots(
      this.sql,
      JSON.stringify([binding, p.SOURCE_REVISION, p.PREMIUM_SERVICE_ID]),
    );
  }
  async publicCalendar(month: string, correlationId: string) {
    return rpcOutcome(() =>
      traced(correlationId, "coordinator", async () => {
        const store = this.displayWarmingEnabled()
          ? this.snapshots()
          : undefined;
        const cached = store?.read("calendar", `calendar:${month}`);
        if (cached && store?.months().includes(month))
          return this.filterDisplayCalendar(cached);
        const generation = store?.generation() ?? 0;
        const value = await this.displayRead((cacheOnly) =>
          publicCalendar({ ...this.calendarReadOptions(), month, cacheOnly }),
        );
        store?.save("calendar", `calendar:${month}`, value, generation);
        return store?.read("calendar", `calendar:${month}`) ?? value;
      }),
    );
  }
  private filterDisplayCalendar(
    value: Awaited<ReturnType<typeof publicCalendar>>,
  ) {
    const now = Date.now();
    return {
      ...value,
      dates: value.dates
        .filter(
          (day) =>
            day.date >= new Date(now + 28800000).toISOString().slice(0, 10),
        )
        .map((day) => {
          const offers = day.offers?.filter(
            (offer) =>
              withinOpeningHours(offer.startMs) &&
              offer.startMs - now >= BOOKING_LEAD_MS,
          );
          return {
            ...day,
            ...(offers ? { offers, available: offers.length > 0 } : {}),
          };
        }),
    };
  }
  private invalidateDisplay() {
    this.calendarReads.invalidate();
    if (this.displayWarmingEnabled()) this.snapshots().invalidateCalendars();
  }
  private refreshDisplayAfterWrite() {
    this.invalidateDisplay();
    // Queue behind the current financial operation; do not wait before redirect.
    this.ctx.waitUntil(
      this.warmDisplay().catch(() => {
        console.error(JSON.stringify({ event: "display_refresh_unavailable" }));
      }),
    );
  }
  async warmDisplay() {
    if (!this.displayWarmingEnabled()) return;
    const store = this.snapshots();
    const months = store.months();
    if (!store.claimRefresh(Date.now())) return;
    for (const month of months)
      await this.providerQueue.run("display", async () => {
        const generation = store.generation();
        // Force fresh range evidence without discarding the last retained display.
        this.calendarReads.invalidate();
        const calendar = await publicCalendar({
          ...this.calendarReadOptions(),
          month,
        });
        const catalogue = await windowCatalogue(this.calendarReadOptions());
        store.save("calendar", `calendar:${month}`, calendar, generation);
        store.save("catalogue", "catalogue", catalogue, generation);
      });
  }
  private async displayRead<T>(
    read: (cacheOnly: boolean) => Promise<T>,
  ): Promise<T> {
    try {
      // Valid public display snapshots need no provider runner. A miss may not
      // dispatch or wait for provider I/O outside the existing bounded admission.
      return await read(true);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "display_cache_miss")
        throw error;
      return this.providerQueue.run("display", () => read(false));
    }
  }

  private calendarReadOptions() {
    return {
      env: this.env,
      cache: this.calendarReads,
      provider: this.provider,
      control: this.providerControl(false, true),
      accounting: () => this.providerAccounting(),
      // Carry pacing across consecutive month/day requests and DO restarts.
      lastDispatchMs: () =>
        this.sql
          .exec<{ latest: number | null }>(
            "SELECT MAX(started_ms) AS latest FROM admissions",
          )
          .one().latest ?? 0,
    };
  }
  async expireCheckout(scope: { attemptId: string; cookie: string }) {
    return rpcOutcome(() =>
      this.providerQueue.run("foreground", () =>
        expireCheckout(
          new Request(this.env.APP_ORIGIN, {
            headers: { cookie: scope.cookie },
          }),
          this.env,
          scope.attemptId,
        ),
      ),
    );
  }
  async dismissCompleted(
    scope: { attemptId: string; cookie: string },
    correlationId: string,
  ) {
    return rpcOutcome(() =>
      this.providerQueue.run("foreground", () =>
        traced(correlationId, "coordinator", () =>
          dismissCompletedCheckout(
            new Request(this.env.APP_ORIGIN, {
              headers: { cookie: scope.cookie },
            }),
            this.env,
            scope.attemptId,
          ),
        ),
      ),
    );
  }
  async windowCatalogue(correlationId: string) {
    return rpcOutcome(() =>
      traced(correlationId, "coordinator", async () => {
        const store = this.displayWarmingEnabled()
          ? this.snapshots()
          : undefined;
        const cached = store?.read("catalogue", "catalogue");
        if (cached) return cached;
        const generation = store?.generation() ?? 0;
        const value = await this.displayRead((cacheOnly) =>
          windowCatalogue({ ...this.calendarReadOptions(), cacheOnly }),
        );
        store?.save("catalogue", "catalogue", value, generation);
        return store?.read("catalogue", "catalogue") ?? value;
      }),
    );
  }

  async nativeCalendar(
    scope: { month: string; serviceId: string; cookie: string },
    correlationId: string,
  ) {
    const pending = this.providerQueue.run("display", () =>
      traced(correlationId, "coordinator", async () => {
        if (hasPublicCalendarWindow(this.env)) {
          await authenticate(
            new Request(this.env.APP_ORIGIN, {
              headers: { cookie: scope.cookie },
            }),
            this.env,
            Date.now(),
          );
          const result = await windowCalendar({
            ...this.calendarReadOptions(),
            ...scope,
          });
          await authenticate(
            new Request(this.env.APP_ORIGIN, {
              headers: { cookie: scope.cookie },
            }),
            this.env,
            Date.now(),
          );
          return result;
        }
        return customerNativeCalendar({
          request: new Request(this.env.APP_ORIGIN, {
            headers: { cookie: scope.cookie },
          }),
          env: this.env,
          month: scope.month,
          serviceId: scope.serviceId,
          provider: this.provider,
          control: this.providerControl(),
          accounting: () => this.providerAccounting(),
          cache: this.calendarReads,
        });
      }),
    );
    return rpcOutcome(() => pending);
  }
  async prepareCustomer(
    scope: { cookie: string; value: unknown },
    correlationId: string,
  ) {
    const pending = this.providerQueue.run("foreground", () =>
      traced(correlationId, "coordinator", async () => {
        const request = new Request(this.env.APP_ORIGIN, {
          headers: { cookie: scope.cookie },
        });
        if (liveCustomerAccess(this.env))
          await authorizeCustomerCheckout(
            request,
            scope.value,
            this.calendarReadOptions(),
          );
        return prepareCustomerNative(request, this.env, scope.value);
      }),
    );
    return rpcOutcome(() => pending);
  }
  async holdCustomer(
    scope: {
      attemptId: string;
      cookie: string;
      value: unknown;
      checkout?: boolean;
      checkoutAccess?: import("./access").Access;
    },
    correlationId: string,
  ) {
    const attemptId = z.string().uuid().parse(scope.attemptId);
    const checkoutTrace = scope.checkout
      ? createCheckoutTrace(correlationId)
      : undefined;
    const pending = this.providerQueue.run("foreground", () =>
      runCheckoutTrace(checkoutTrace, () =>
        traced(correlationId, "coordinator", async () => {
          const request = new Request(this.env.APP_ORIGIN, {
            headers: { cookie: scope.cookie },
          });
          const input = nativePrepareSchema.parse(scope.value);
          if (
            !liveCustomerAccess(this.env) ||
            !input.holding ||
            input.key !== attemptId ||
            (scope.checkout && !input.accepted)
          )
            throw new ApiError(400, "combined_hold_unavailable");
          const env = {
            ...this.env,
            STATE: instrumentStorage(this.env.STATE, "d1"),
          };
          const creationOnly = !!scope.checkout;
          const access =
            scope.checkoutAccess ??
            (await authenticate(request, env, Date.now()));
          const retainedGrant = await authorizeCustomerCheckout(
            request,
            input,
            { ...this.calendarReadOptions(), env },
            true,
            access,
            !!scope.checkout,
            !!scope.checkout && access.fresh_checkout === 1,
          );
          const preparation = await prepareCustomerNative(
            request,
            env,
            input,
            attemptId,
            () =>
              creationOnly
                ? this.provider.checkoutToken(
                    env,
                    this.providerControl(false, true),
                  )
                : this.provider.identity(
                    env,
                    this.providerControl(false, true),
                  ),
            access,
            retainedGrant,
          ).catch(async (error: unknown) => {
            if (
              !(error instanceof ApiError) ||
              error.code !== "native_customer_window_unavailable"
            )
              throw error;
            const code = await rejectedCheckoutReadback(request, input, {
              ...this.calendarReadOptions(),
              env,
            }).catch(() => "checkout_window_unresolved");
            throw new ApiError(503, code);
          });
          this.invalidateDisplay();
          return executeNativeCheckout({
            request,
            env,
            attemptId,
            holding: true,
            combinedHold: true,
            creationOnly,
            prepared:
              "snapshot" in preparation ? preparation.snapshot : undefined,
            access,
            onVerifiedHold: scope.checkout
              ? (proof) =>
                  payHitpayHold(
                    request,
                    env,
                    attemptId,
                    this.provider,
                    this.providerControl(false, true),
                    proof,
                  )
              : undefined,
            provider: this.provider,
            control: this.providerControl(false, true),
            recoveryControl: this.providerControl(true, true),
            accounting: () => this.providerAccounting(),
          }).finally(() => {
            if (scope.checkout)
              this.ctx.waitUntil(
                this.bookingComments(attemptId).catch(() => {
                  console.error(
                    JSON.stringify({ event: "booking_comments_deferred" }),
                  );
                }),
              );
            this.refreshDisplayAfterWrite();
          });
        }),
      ),
    );
    let serverTiming: string | undefined;
    const outcome = await rpcOutcome(() => pending).finally(() => {
      serverTiming = finishCheckoutTrace(checkoutTrace);
    });
    return { ...outcome, serverTiming };
  }
  async bookingComments(attemptId?: string) {
    return this.providerQueue.run("display", () =>
      annotatePendingBooking(
        this.env,
        this.provider,
        this.providerControl(false, true),
        attemptId,
      ),
    );
  }
  async nativeCheckout(
    scope: { attemptId: string; cookie: string; holding?: boolean },
    correlationId: string,
  ) {
    this.invalidateDisplay();
    const pending = this.providerQueue.run("foreground", () =>
      traced(correlationId, "coordinator", () =>
        executeNativeCheckout({
          request: new Request(this.env.APP_ORIGIN, {
            headers: { cookie: scope.cookie },
          }),
          env: { ...this.env, STATE: instrumentStorage(this.env.STATE, "d1") },
          attemptId: scope.attemptId,
          holding: scope.holding,
          provider: this.provider,
          control: this.providerControl(false, true),
          recoveryControl: this.providerControl(true, true),
          accounting: () => this.providerAccounting(),
        }).finally(() => this.refreshDisplayAfterWrite()),
      ),
    );
    return rpcOutcome(() => pending);
  }
  async hitpayPayment(
    scope: { attemptId: string; cookie: string },
    correlationId: string,
  ) {
    const pending = this.providerQueue.run("foreground", () =>
      traced(correlationId, "coordinator", () =>
        payHitpayHold(
          new Request(this.env.APP_ORIGIN, {
            headers: { cookie: scope.cookie },
          }),
          this.env,
          scope.attemptId,
          this.provider,
          this.providerControl(false, true),
        ),
      ),
    );
    return rpcOutcome(() => pending);
  }
  // Only authenticated, account-bound webhook ingress calls this RPC. Persist
  // the wake-up before acknowledging; the minute cron remains the fallback.
  async wakeHitpayRecovery(attemptId: string, correlationId: string) {
    z.string().uuid().parse(attemptId);
    z.string().uuid().parse(correlationId);
    if (!hitpayRecoveryEnabled(this.env)) return;
    this.sql.exec(
      "INSERT INTO payment_wakeups(attempt_id,correlation_id,generation) VALUES(?,?,1) ON CONFLICT(attempt_id) DO UPDATE SET correlation_id=excluded.correlation_id,generation=payment_wakeups.generation+1",
      attemptId,
      correlationId,
    );
    await this.ctx.storage.setAlarm(Date.now());
  }
  async alarm() {
    const wake = this.sql
      .exec<{
        attempt_id: string;
        correlation_id: string;
        generation: number;
      }>(
        "SELECT attempt_id,correlation_id,generation FROM payment_wakeups ORDER BY rowid LIMIT 1",
      )
      .toArray()[0];
    if (!wake) return;
    await this.hitpayRecovery(wake.attempt_id, wake.correlation_id);
    // A receipt arriving during recovery retains its newer wake-up. Recovery
    // itself owns the durable payment lease, retry budget and effect journal.
    this.sql.exec(
      "DELETE FROM payment_wakeups WHERE attempt_id=? AND generation=?",
      wake.attempt_id,
      wake.generation,
    );
    if (this.sql.exec("SELECT 1 FROM payment_wakeups LIMIT 1").toArray().length)
      await this.ctx.storage.setAlarm(Date.now());
  }
  async hitpayRecovery(attemptId: string, correlationId: string) {
    const key = await confirmationTraceKey(attemptId);
    const trace = createConfirmationTrace(correlationId);
    let failed = false;
    try {
      return await this.providerQueue.run("recovery", () =>
        runConfirmationTrace(trace, "claim", () =>
          traced(correlationId, "coordinator", () =>
            recoverHitpay(
              { ...this.env, STATE: instrumentStorage(this.env.STATE, "d1") },
              attemptId,
              this.provider,
              this.providerControl(true, false, true),
            ),
          ),
        ),
      );
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      finishConfirmationTrace(trace, key, "recovery", failed);
    }
  }
  async ongoingRecovery(attemptId: string, correlationId: string) {
    const run = this.providerQueue.run("recovery", async () => {
      const due = await ongoingReadbackDue(this.env, Date.now(), attemptId);
      if (!due) return { outcomes: [], reads: 0 };
      const used = this.providerAccounting().used;
      return this.nativeRecovery(
        {
          attemptId,
          startingUsed: used,
          maximumUsed: used + 30,
          expiresMs: Date.now() + 90000,
          invocationId:
            crypto.randomUUID().replaceAll("-", "") +
            crypto.randomUUID().replaceAll("-", ""),
          ongoing: true,
        },
        correlationId,
      );
    });
    return run;
  }
  async nativeRecovery(
    scope: {
      attemptId: string;
      startingUsed: number;
      maximumUsed: number;
      expiresMs: number;
      invocationId: string;
      ongoing?: boolean;
      useRecoveryReserve?: boolean;
      residual?: ResidualAuthority;
    },
    correlationId: string,
  ) {
    return traced(correlationId, "coordinator", async () => {
      const p = policy(this.env),
        initial = this.providerAccounting(),
        now = Date.now();
      const ongoing = scope.ongoing === true;
      if (
        ongoing &&
        (scope.residual ||
          scope.useRecoveryReserve ||
          !(await ongoingReadbackDue(this.env, now, scope.attemptId)))
      )
        return { outcomes: [], reads: 0 };
      z.string().uuid().parse(scope.attemptId);
      z.string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(scope.invocationId);
      if (
        p.PROVIDER_ACCESS !== "trusted-reads" ||
        (!ongoing && now >= p.CAMPAIGN_END_MS) ||
        !Number.isSafeInteger(scope.expiresMs) ||
        scope.expiresMs <= now ||
        scope.expiresMs > now + 180000 ||
        !Number.isSafeInteger(scope.startingUsed) ||
        !Number.isSafeInteger(scope.maximumUsed) ||
        scope.startingUsed < 0 ||
        (!ongoing &&
          scope.maximumUsed >
            p.PROVIDER_CALL_CEILING -
              (scope.useRecoveryReserve === true ? 0 : 16)) ||
        (scope.useRecoveryReserve === true &&
          scope.maximumUsed - scope.startingUsed > 16) ||
        scope.maximumUsed - scope.startingUsed > 30 ||
        scope.maximumUsed - scope.startingUsed < 6 ||
        initial.used < scope.startingUsed ||
        initial.used + 6 > scope.maximumUsed ||
        (scope.residual?.mode === "inspect" &&
          (scope.useRecoveryReserve === true ||
            scope.maximumUsed - scope.startingUsed !== 6)) ||
        (ongoing ? initial.active >= 2 : initial.active !== 0)
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
      const control = this.providerControl(
        scope.useRecoveryReserve === true,
        ongoing,
      );
      let count = 0,
        last = 0;
      const bounded: ProviderControl = {
        ...control,
        reserve: async (metadata) => {
          if (scope.residual)
            await residualGrant(this.env, {
              ...scope,
              residual: scope.residual,
            });
          const delay = Math.max(0, last + 300 - Date.now());
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          if (
            Date.now() + 15000 >=
              Math.min(
                scope.expiresMs,
                ongoing ? scope.expiresMs : p.CAMPAIGN_END_MS,
              ) ||
            count >= maximumCalls ||
            this.providerAccounting().used >= scope.maximumUsed
          )
            throw new ApiError(503, "recovery_window_exhausted");
          count++;
          last = Date.now();
          return control.reserve(metadata);
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
      if (!ongoing) await this.provider.identity(this.env, bounded);
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
        ongoing,
        // Claim the durable try before setup; stop new dispatches after timeout.
        prepare: ongoing
          ? (signal) =>
              this.provider.identity(this.env, {
                ...bounded,
                reserve: (metadata) => {
                  signal.throwIfAborted();
                  return bounded.reserve(metadata);
                },
              })
          : undefined,
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
  finish(
    id: string,
    cooldownMs = 0,
    reason?: "read_transport_ended" | "write_transport_ended",
  ) {
    if (!Number.isInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 3600000)
      throw new Error("Invalid cooldown");
    if (reason !== undefined)
      z.enum(["read_transport_ended", "write_transport_ended"]).parse(reason);
    this.ctx.storage.transactionSync(() => {
      if (reason === "read_transport_ended")
        this.sql.exec(
          "INSERT INTO admission_releases(id,campaign,started_ms,reason,recorded_ms) SELECT id,campaign,started_ms,?,? FROM admissions WHERE id=? AND finished=0 ON CONFLICT(id) DO NOTHING",
          reason,
          Date.now(),
          id,
        );
      if (reason)
        this.sql.exec(
          "INSERT INTO provider_transport_releases SELECT id,operation,read_only,?,? FROM provider_request_admissions WHERE id=? ON CONFLICT(id) DO NOTHING",
          Date.now(),
          reason,
          id,
        );
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
