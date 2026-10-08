// Local workerd test driver; never the deployment entry point.
import worker, {
  SoccerBotAccountCoordinator,
  prepareAttempt,
  claimDispatch,
  recordObservation,
  requireRecovery,
  bindAssociation,
} from "../index";
export { SoccerBotAccountCoordinator };
const harness = {
  async fetch(request: Request, env: Env) {
    const p = new URL(request.url).pathname;
    if (!p.startsWith("/test/")) return worker.fetch(request, env);
    const input = (await request.json()) as {
      owner: string;
      key: string;
      intent: unknown;
      now: number;
      id: string;
      fence: number;
      observation: unknown;
      references: unknown;
      recovery: boolean;
      cooldown: number;
      coordinator: string;
      generation: number;
      claim: string;
    };
    try {
      let result: unknown;
      const coordinator = env.COORDINATOR.getByName(
        input.coordinator || "synthetic-account",
      );
      switch (p) {
        case "/test/prepare":
          result = await prepareAttempt(
            env.STATE,
            input.owner,
            input.key,
            input.intent,
            input.now,
            600000,
          );
          break;
        case "/test/claim":
          result = await claimDispatch(
            env.STATE,
            input.id,
            input.fence,
            input.now,
          );
          break;
        case "/test/associate":
          result = await bindAssociation(
            env.STATE,
            input.id,
            input.fence,
            input.references,
          );
          break;
        case "/test/observe":
          result = await recordObservation(
            env.STATE,
            input.id,
            input.fence,
            input.observation,
            input.now,
          );
          break;
        case "/test/recovery":
          result = await requireRecovery(env.STATE, input.id, input.fence);
          break;
        case "/test/refresh":
          result = await coordinator.claimRefresh(input.key, input.generation);
          break;
        case "/test/complete-refresh":
          result = await coordinator.completeRefresh(
            input.key,
            input.claim,
            input.generation,
          );
          break;
        case "/test/admit":
          result = await coordinator.admit(input.recovery);
          break;
        case "/test/finish":
          result = await coordinator.finish(input.id, input.cooldown);
          break;
        default:
          return new Response(null, { status: 404 });
      }
      return Response.json({ result: result ?? null });
    } catch {
      return Response.json({ error: "test_operation_failed" }, { status: 409 });
    }
  },
};

export default harness;
