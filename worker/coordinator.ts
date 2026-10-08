import { DurableObject } from "cloudflare:workers";
// One instance per actual provider account. No booking or customer data here.
export class SoccerBotAccountCoordinator extends DurableObject<Env> {
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
    const now = Date.now();
    if (this.env.PROVIDER_ACCESS !== "disabled")
      throw new Error("Unsupported provider mode");
    // Synthetic admission exercises accounting only. No outbound provider path is enabled.
    if (now >= Number(this.env.CAMPAIGN_END_MS))
      return { allowed: false, reason: "campaign_closed" };
    const sql = this.ctx.storage.sql;
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
  finish(id: string, cooldownMs = 0) {
    if (!Number.isInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 3600000)
      throw new Error("Invalid cooldown");
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE admissions SET finished=1 WHERE id=? AND finished=0",
        id,
      );
      this.ctx.storage.sql.exec(
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
      sql = this.ctx.storage.sql;
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
    this.ctx.storage.sql.exec(
      "UPDATE refreshes SET completed_ms=?,expires_ms=? WHERE key=? AND claim=? AND generation=? AND expires_ms>?",
      now,
      now,
      key,
      claim,
      generation,
      now,
    );
    return (
      this.ctx.storage.sql.exec<{ n: number }>("SELECT changes() n").one().n ===
      1
    );
  }
}
