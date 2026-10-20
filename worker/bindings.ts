import { ApiError } from "./policy";
export const coordinatorName = "simplybook-developer-account";
// Management-owned metadata. Never self-register against an arbitrary binding.
export function assertBindingShape(env: Env) {
  if (
    typeof env.STATE?.withSession !== "function" ||
    typeof env.COORDINATOR?.idFromName !== "function" ||
    typeof env.ASSETS?.fetch !== "function"
  )
    throw new ApiError(503, "environment_unavailable");
}
export function foundationStatement(env: Env) {
  return env.STATE.withSession("first-primary").prepare(
    "SELECT account_id,environment,database_id,coordinator_id FROM foundation_identity WHERE singleton=1",
  );
}
export function assertFoundation(
  env: Env,
  identity:
    | {
        account_id: string;
        environment: string;
        database_id: string;
        coordinator_id: string;
      }
    | null
    | undefined,
) {
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

export async function verifyBindings(env: Env) {
  assertBindingShape(env);
  assertFoundation(env, await foundationStatement(env).first());
}
