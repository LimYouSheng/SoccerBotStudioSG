import { DurableObject } from "cloudflare:workers";
import { traced, measure, instrumentStorage } from "./diagnostics";
import { ApiError, policy } from "./policy";
import { ProviderSession, type ProviderControl } from "./provider-session";
// One instance per actual provider account. No booking or customer data here.
export class SoccerBotAccountCoordinator extends DurableObject<Env> {
  private provider = new ProviderSession();
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
    policy(this.env);
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
      if (budget.used >= (recovery ? 80 : 64))
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
  private providerControl(): ProviderControl {
    return {
      reserve: async () =>
        measure("coordinator", async () => {
          const admitted = this.admit(false);
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
  discoveryAccounting() {
    policy(this.env);
    return this.providerAccounting();
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
    return { used, active, ceiling: 80, recoveryReserve: 16 };
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
