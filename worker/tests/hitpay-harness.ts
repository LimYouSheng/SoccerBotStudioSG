import { intentSchema } from "../journal";
// Synthetic-only harness. This entry is excluded from deployed routing.
import worker, {
  SoccerBotAccountCoordinator as ProductionCoordinator,
} from "../index";
import { prepareHitpay, claimHitpay } from "../hitpay-journal";
export class SoccerBotAccountCoordinator extends ProductionCoordinator {
  expireSyntheticCooldown() {
    this.ctx.storage.sql.exec("UPDATE budget SET cooldown_ms=0");
  }
}
const harness = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
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
