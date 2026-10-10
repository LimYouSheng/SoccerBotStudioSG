import { z } from "zod";
import { coordinatorName, verifyBindings } from "./bindings";
import { policy } from "./policy";
import { traced } from "./diagnostics";
const windowSchema = z.strictObject({
  attemptId: z.string().uuid(),
  notBeforeMs: z.number().int().nonnegative().safe(),
  startingUsed: z.number().int().min(0).max(58),
  maximumUsed: z.number().int().min(6).max(64),
});
// No browser trigger, callback guess, draining loop, cron config or self-grant.
// Each installed one-use window permits one known-attempt readback, six physical
// calls maximum including cold setup. Aggregate ceiling stays in the account DO.
export async function runScheduledRecovery(
  env: Env,
  clock: () => number = Date.now,
) {
  const p = policy(env),
    now = clock();
  if (p.PROVIDER_ACCESS !== "trusted-reads" || now >= p.CAMPAIGN_END_MS)
    return { state: "closed" };
  await verifyBindings(env);
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT capability_hash,expires_ms,result_json FROM developer_operations WHERE operation='native_recovery_window' AND state='granted' AND expires_ms>? AND json_valid(result_json) AND json_extract(result_json,'$.notBeforeMs')<=? ORDER BY expires_ms,capability_hash LIMIT 1",
    )
    .bind(now, now)
    .first<{
      capability_hash: string;
      expires_ms: number;
      result_json: string;
    }>();
  if (!row) return { state: "idle" };
  const claimed = await env.STATE.prepare(
    "UPDATE developer_operations SET state='running' WHERE capability_hash=? AND operation='native_recovery_window' AND state='granted' AND expires_ms>? RETURNING capability_hash",
  )
    .bind(row.capability_hash, clock())
    .first();
  if (!claimed) return { state: "idle" };
  let result: unknown = { reason: "recovery_window_unavailable" },
    state = "blocked";
  try {
    const scope = windowSchema.parse(JSON.parse(row.result_json));
    if (
      row.expires_ms > scope.notBeforeMs + 180000 ||
      clock() < scope.notBeforeMs ||
      clock() + 90000 >= row.expires_ms
    )
      throw new Error("window_invalid");
    const correlationId = crypto.randomUUID();
    result = await traced(correlationId, "scheduled", () =>
      env.COORDINATOR.getByName(coordinatorName).nativeRecovery(
        {
          ...scope,
          expiresMs: row.expires_ms,
          invocationId: row.capability_hash,
        },
        correlationId,
      ),
    );
    state = "complete";
  } catch {
    /* Retain only a fixed reason; no native signature or raw error. */
  }
  await env.STATE.prepare(
    "UPDATE developer_operations SET state=?,result_json=? WHERE capability_hash=? AND state='running'",
  )
    .bind(state, JSON.stringify(result), row.capability_hash)
    .run();
  return { state };
}
