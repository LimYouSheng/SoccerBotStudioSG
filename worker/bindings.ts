import { ApiError } from "./policy";
export const coordinatorName = "simplybook-developer-account";
// Management-owned metadata. Never self-register against an arbitrary binding.
export async function verifyBindings(env: Env) {
  if (
    typeof env.STATE?.withSession !== "function" ||
    typeof env.COORDINATOR?.idFromName !== "function" ||
    typeof env.ASSETS?.fetch !== "function"
  )
    throw new ApiError(503, "environment_unavailable");
  const identity = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT account_id,environment,database_id,coordinator_id FROM foundation_identity WHERE singleton=1",
    )
    .first<{
      account_id: string;
      environment: string;
      database_id: string;
      coordinator_id: string;
    }>();
  if (
    !identity ||
    identity.account_id !== env.DEPLOYMENT_ACCOUNT_ID ||
    identity.environment !== env.ENVIRONMENT ||
    identity.database_id !== env.STATE_DATABASE_ID ||
    identity.coordinator_id !==
      env.COORDINATOR.idFromName(coordinatorName).toString()
  )
    throw new ApiError(503, "environment_unavailable");
}
