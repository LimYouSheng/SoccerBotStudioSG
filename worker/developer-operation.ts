import { measure, traceId } from "./diagnostics";
import { coordinatorName } from "./bindings";
import { ApiError, digest } from "./policy";

export async function developerOperation(
  request: Request,
  env: Env,
  now: number,
  operation: "provider_identity" | "historical_comparison",
) {
  const bearer = request.headers.get("authorization") || "";
  if (!/^Bearer [a-f0-9]{64}$/.test(bearer))
    throw new ApiError(401, "operator_access_denied");
  const hash = await digest(bearer.slice(7));
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT state,result_json FROM developer_operations WHERE capability_hash=? AND operation=? AND expires_ms>?",
    )
    .bind(hash, operation, now)
    .first<{ state: string; result_json: string | null }>();
  if (!row) throw new ApiError(401, "operator_access_denied");
  if (request.method === "GET" || row.state !== "granted")
    return {
      state: row.state,
      result: row.result_json ? (JSON.parse(row.result_json) as unknown) : null,
    };
  if (String(env.PROVIDER_ACCESS) !== "trusted-reads")
    throw new ApiError(503, "provider_access_disabled");
  const claimed = await env.STATE.prepare(
    "UPDATE developer_operations SET state='running' WHERE capability_hash=? AND state='granted' AND expires_ms>? RETURNING capability_hash",
  )
    .bind(hash, now)
    .first();
  if (!claimed) return { state: "running", result: null };
  let state: "complete" | "blocked" = "complete";
  let result: unknown;
  try {
    result = await measure("coordinator_rpc", () =>
      env.COORDINATOR.getByName(coordinatorName).providerRead(
        operation,
        traceId(),
      ),
    );
    if (
      !result ||
      typeof result !== "object" ||
      !("verified" in result) ||
      result.verified !== true
    )
      state = "blocked";
  } catch {
    // RPC error text can include provider details; never return or log it.
    state = "blocked";
    result = { reason: "provider_proof_incomplete" };
  }
  await env.STATE.prepare(
    "UPDATE developer_operations SET state=?,result_json=? WHERE capability_hash=? AND state='running'",
  )
    .bind(state, JSON.stringify(result), hash)
    .run();
  return { state, result };
}
