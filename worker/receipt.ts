import { z } from "zod";
import { authenticate } from "./access";
import { ApiError, policy } from "./policy";
import { decideStoredConfirmation, type StoredAttempt } from "./confirmation";
import { intentSchema } from "./journal";
import { nativeAvailabilitySchema } from "../src/domain/native-checkout";
import { receiptSchema } from "../src/domain/native-checkout";

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
    decideStoredConfirmation(row, access, now, policy(env)).status !==
    "confirmed"
  )
    throw new ApiError(409, "receipt_not_verified");
  const intent = intentSchema.parse(JSON.parse(row.intent_json));
  if (!intent.contact) throw new ApiError(503, "receipt_details_unavailable");
  const snapshot = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT availability_json FROM native_checkout_grants WHERE attempt_id=?",
    )
    .bind(id)
    .first<{ availability_json: string | null }>();
  const offers = Object.values(
    z
      .record(z.string(), nativeAvailabilitySchema)
      .parse(JSON.parse(snapshot?.availability_json || "{}")),
  ).flatMap((day) => day.offers);
  const slots = intent.sessions.map((session) => {
    const offer = offers.find(
      (item) =>
        item.serviceId === session.serviceId &&
        item.instructorId === session.instructorId &&
        item.startMs === session.startMs &&
        item.priceMinor === session.totalMinor,
    );
    if (!offer) throw new ApiError(503, "receipt_details_unavailable");
    return { ...offer, players: session.players };
  });
  await authenticate(request, env, Date.now());
  return receiptSchema.parse({
    attemptId: id,
    verifiedAtMs: now,
    createdAtMs: row.created_ms,
    taxMinor: intent.taxMinor,
    totalMinor: intent.totalMinor,
    contact: intent.contact,
    sessions: slots,
  });
}
