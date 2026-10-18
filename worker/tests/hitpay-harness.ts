import { checkoutContext } from "../confirmation";
import { ApiError } from "../policy";
import { intentSchema } from "../journal";
// Synthetic-only harness. This entry is excluded from deployed routing.
import worker, {
  SoccerBotAccountCoordinator as ProductionCoordinator,
} from "../index";
import { prepareHitpay, claimHitpay } from "../hitpay-journal";
export class SoccerBotAccountCoordinator extends ProductionCoordinator {
  // Existing recovery fixtures explicitly control interleaving. Production
  // enqueue/setAlarm still execute; tests invoke the real handler separately.
  async alarm() {}
  async drainSyntheticAlarm() {
    await super.alarm();
  }
  syntheticWakeups() {
    return this.ctx.storage.sql
      .exec("SELECT attempt_id,generation FROM payment_wakeups ORDER BY rowid")
      .toArray();
  }

  expireSyntheticCooldown() {
    this.ctx.storage.sql.exec("UPDATE budget SET cooldown_ms=0");
  }
}
const harness = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (
      ["/test/late-checkout", "/test/foreign-checkout"].includes(url.pathname)
    ) {
      const readEnv =
        url.pathname === "/test/foreign-checkout"
          ? { ...env, SIMPLYBOOK_DEV_COMPANY_LOGIN: "foreign-company" }
          : env;
      try {
        return Response.json(
          await checkoutContext(
            request,
            readEnv,
            "00000000-0000-4000-8000-000000000001",
            Date.now() + 1200000,
          ),
        );
      } catch (error) {
        if (error instanceof ApiError)
          return Response.json({ code: error.code }, { status: error.status });
        throw error;
      }
    }
    if (["/test/wakeups", "/test/alarm"].includes(url.pathname)) {
      const stub = env.COORDINATOR.getByName(
        "simplybook-developer-account",
      ) as unknown as DurableObjectStub<SoccerBotAccountCoordinator>;
      if (url.pathname === "/test/alarm") await stub.drainSyntheticAlarm();
      return Response.json(await stub.syntheticWakeups());
    }
    if (url.pathname === "/test/elapsed-cooldown") {
      const stub = env.COORDINATOR.getByName(
        "simplybook-developer-account",
      ) as unknown as DurableObjectStub<SoccerBotAccountCoordinator>;
      await stub.expireSyntheticCooldown();
      return Response.json({ done: true });
    }
    if (url.pathname === "/test/create") {
      const id = "00000000-0000-4000-8000-000000000001";
      const row = await env.STATE.prepare(
        "SELECT intent_json,intent_hash,association_json FROM attempts WHERE id=?",
      )
        .bind(id)
        .first<{
          intent_json: string;
          intent_hash: string;
          association_json: string;
        }>();
      if (!row) return new Response(null, { status: 404 });
      try {
        await prepareHitpay(
          env,
          {
            attemptId: id,
            companyLogin: "synthetic-developer",
            timezone: "Asia/Singapore",
            intent: intentSchema.parse(JSON.parse(row.intent_json)),
          },
          row.association_json,
          row.intent_hash,
          Date.now() + 300000,
          async () => {},
        );
        return Response.json({ done: true });
      } catch {
        return Response.json({ unknown: true }, { status: 409 });
      }
    }
    if (url.pathname === "/test/recover") {
      await env.COORDINATOR.getByName(
        "simplybook-developer-account",
      ).hitpayRecovery(
        "00000000-0000-4000-8000-000000000001",
        crypto.randomUUID(),
      );
      return Response.json({ done: true });
    }
    if (url.pathname === "/test/claim")
      return Response.json(
        await claimHitpay(
          env,
          "00000000-0000-4000-8000-000000000001",
          Date.now(),
        ),
      );
    return worker.fetch(request, env);
  },
};

export default harness;
