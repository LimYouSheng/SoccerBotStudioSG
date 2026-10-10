import { z } from "zod";
import { authenticate } from "./access";
import { coordinatorName } from "./bindings";
import { ApiError, policy } from "./policy";
import { traceId } from "./diagnostics";
import {
  customerCatalogueSchema,
  CATALOGUE_MAX_AGE_MS,
} from "../src/domain/catalog";
const scopeSchema = z.strictObject({
  startingUsed: z.number().int().min(0).max(58),
  maxCalls: z.literal(6),
});
export async function customerCatalogue(
  request: Request,
  env: Env,
  now: number,
) {
  const access = await authenticate(request, env, now);
  const grant = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT state,expires_ms,result_json FROM developer_operations WHERE capability_hash=? AND operation='customer_catalogue' AND expires_ms>?",
    )
    .bind(access.capability_hash, now)
    .first<{ state: string; expires_ms: number; result_json: string | null }>();
  if (!grant) throw new ApiError(503, "catalogue_unavailable");
  if (grant.state === "complete") {
    const retained = customerCatalogueSchema.parse(
      JSON.parse(grant.result_json || "null"),
    );
    if (
      retained.observedAtMs > now ||
      now - retained.observedAtMs >= CATALOGUE_MAX_AGE_MS
    )
      throw new ApiError(503, "catalogue_refresh_required");
    return retained;
  }
  if (grant.state !== "granted")
    throw new ApiError(503, "catalogue_unavailable");
  const p = policy(env);
  if (
    p.PROVIDER_ACCESS !== "trusted-reads" ||
    p.CAMPAIGN_END_MS <= now ||
    grant.expires_ms > now + 180000
  )
    throw new ApiError(503, "catalogue_unavailable");
  const scope = scopeSchema.parse(JSON.parse(grant.result_json || "null"));
  const claimed = await env.STATE.prepare(
    "UPDATE developer_operations SET state='running' WHERE capability_hash=? AND operation='customer_catalogue' AND state='granted' AND expires_ms>? RETURNING capability_hash",
  )
    .bind(access.capability_hash, now)
    .first();
  if (!claimed) throw new ApiError(503, "catalogue_unavailable");
  try {
    const result = customerCatalogueSchema.parse(
      await env.COORDINATOR.getByName(coordinatorName).customerCatalogue(
        { ...scope, expiresMs: grant.expires_ms },
        traceId(),
      ),
    );
    if (
      Date.now() >= grant.expires_ms ||
      result.observedAtMs > Date.now() ||
      Date.now() - result.observedAtMs >= CATALOGUE_MAX_AGE_MS
    )
      throw new ApiError(503, "catalogue_unavailable");
    await env.STATE.prepare(
      "UPDATE developer_operations SET state='complete',result_json=? WHERE capability_hash=? AND state='running'",
    )
      .bind(JSON.stringify(result), access.capability_hash)
      .run();
    await authenticate(request, env, Date.now());
    return result;
  } catch {
    await env.STATE.prepare(
      "UPDATE developer_operations SET state='blocked' WHERE capability_hash=? AND state='running'",
    )
      .bind(access.capability_hash)
      .run();
    throw new ApiError(503, "catalogue_unavailable");
  }
}
