// Local workerd test driver; never the deployment entry point.
import worker, {
  SoccerBotAccountCoordinator,
  prepareAttempt,
  claimDispatch,
  recordObservation,
  requireRecovery,
  bindAssociation,
  orchestrateBooking,
  claimRecovery,
  completeRecovery,
  runRecoveryBatch,
  retentionPreview,
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
      recoveryClaim: import("../recovery").RecoveryClaim;
      completion: unknown;
      limit: number;
      beforeMs: number;
      scenario: string;
    };
    try {
      let result: unknown;
      const coordinator = env.COORDINATOR.getByName(
        input.coordinator || "synthetic-account",
      );
      switch (p) {
        case "/test/recovery-claim":
          result = await claimRecovery(
            env.STATE,
            input.id,
            input.owner,
            input.now,
          );
          break;
        case "/test/recovery-complete": {
          let clockReads = 0;
          result = await completeRecovery(
            env,
            input.recoveryClaim,
            input.completion,
            () =>
              input.scenario === "lease-expiry" && clockReads++ > 0
                ? input.recoveryClaim.ready_ms
                : input.now,
          );
          break;
        }
        case "/test/recovery-run": {
          let reads = 0;
          result = {
            outcomes: await runRecoveryBatch(
              env,
              {
                claimant: input.owner,
                limit: input.limit,
                now: () => input.now,
              },
              {
                mode:
                  input.scenario === "live"
                    ? "live"
                    : input.scenario === "unsupported"
                      ? "unavailable"
                      : "synthetic",
                read: async () => {
                  reads++;
                  if (input.scenario === "throw")
                    throw new Error("synthetic transport failure");
                  return input.completion;
                },
              },
            ),
            reads,
          };
          break;
        }
        case "/test/retention":
          result = await retentionPreview(
            env.STATE,
            input.now,
            input.beforeMs,
            input.limit,
          );
          break;
        case "/test/orchestrate": {
          const calls: string[] = [];
          result = {
            result: await orchestrateBooking(request, env, input.id, {
              supported: input.scenario !== "unsupported",
              hasRecoveryCapacity: async () => input.scenario !== "budget",
              revalidate: async (intent, context) => {
                calls.push(`validate:${context.sessionIndex}`);
                if (input.scenario === "revoke" && context.sessionIndex === 1)
                  await env.STATE.prepare(
                    "UPDATE guest_access SET revoked_ms=? WHERE owner_id=?",
                  )
                    .bind(Date.now(), input.owner)
                    .run();
                if (input.scenario === "fence" && context.sessionIndex === 1)
                  await requireRecovery(env.STATE, input.id, 1);
                if (input.scenario === "price" && context.sessionIndex === 1)
                  return {
                    ...intent,
                    totalMinor: intent.totalMinor + 1,
                    sessions: intent.sessions.map((s, i) =>
                      i === 0 ? { ...s, totalMinor: s.totalMinor + 1 } : s,
                    ),
                  };
                return intent;
              },
              createSession: async (session, intent, context) => {
                calls.push(`create:${context.sessionIndex}`);
                const reserved = await env.STATE.prepare(
                  "SELECT outcome FROM session_effects WHERE attempt_id=? AND step=?",
                )
                  .bind(input.id, `session:${context.sessionIndex}`)
                  .first<{ outcome: string }>();
                if (reserved?.outcome !== "unknown")
                  throw new Error("Missing durable reservation");
                if (input.scenario === "partial" && context.sessionIndex === 1)
                  throw new Error("Unknown provider outcome");
                if (input.scenario === "late-effect")
                  await claimRecovery(
                    env.STATE,
                    input.id,
                    "synthetic-recovery-owner",
                    Date.now() + 60000,
                  );
                return {
                  ...session,
                  currency: "SGD",
                  bookingId:
                    input.scenario === "duplicate"
                      ? "synthetic-booking-0"
                      : `synthetic-booking-${context.sessionIndex}`,
                  accountId: intent.accountId,
                  customerId: intent.customerId,
                  confirmed: true,
                };
              },
              finalize: async (bookingIds, intent) => {
                calls.push("finalize");
                if (input.scenario === "finalize-unknown")
                  throw new Error("Unknown finalization");
                return {
                  invoiceId: "synthetic-invoice",
                  accountId: intent.accountId,
                  customerId: intent.customerId,
                  currency: intent.currency,
                  totalMinor: intent.totalMinor,
                  taxMinor: intent.taxMinor,
                  bookingIds:
                    input.scenario === "incomplete"
                      ? bookingIds.slice(0, 1)
                      : bookingIds,
                };
              },
            }),
            calls,
          };
          break;
        }
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
