import { hitpayConfirmationGuard } from "./hitpay-journal";
import { authenticate } from "./access";
import { ApiError, policy } from "./policy";
import { decideStoredConfirmation, type StoredAttempt } from "./confirmation";
import { receiptData } from "./receipt-data";

// Export authorization is rechecked for every read, independent of the UI's
// confirmed state. No provider calls, cookie forwarding or draft authority.
export async function bookingReceipt(
  request: Request,
  env: Env,
  id: string,
  now: number,
) {
  const access = await authenticate(request, env, now);
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT id,created_ms,deadline_ms,state,intent_json,association_json,observation_json FROM attempts WHERE id=? AND owner_id=?",
    )
    .bind(id, access.owner_id)
    .first<StoredAttempt>();
  if (!row) throw new ApiError(404, "attempt_unavailable");
  if (
    (await hitpayConfirmationGuard(env, id)) ||
    decideStoredConfirmation(row, access, now, policy(env)).status !==
      "confirmed"
  )
    throw new ApiError(409, "receipt_not_verified");
  const receipt = await receiptData(env, row, now);
  await authenticate(request, env, Date.now());
  return receipt;
}
