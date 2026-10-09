import { verifyConfirmation } from "../src/domain/confirmation";
import { authenticate, type Access } from "./access";
import { intentSchema, associationSchema } from "./journal";
import { ApiError, policy } from "./policy";
export type StoredAttempt = {
  id: string;
  created_ms: number;
  deadline_ms: number;
  state: string;
  intent_json: string;
  association_json: string | null;
  observation_json: string | null;
};
export async function confirmation(
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
  return decideStoredConfirmation(row, access, now, policy(env));
}
// Shared decision mapping. Caller supplies independently established authority:
// authenticated customer access, or a current bounded internal recovery claim.
export function decideStoredConfirmation(
  row: StoredAttempt,
  access: Access,
  now: number,
  p: ReturnType<typeof policy>,
) {
  if (!row.association_json || !row.observation_json)
    return {
      status: now >= row.deadline_ms ? "unresolved" : "pending",
      reason:
        row.state === "recovery_required"
          ? "recovery_required"
          : now >= row.deadline_ms
            ? "verification_window_elapsed"
            : "missing_evidence",
      pollAfterMs: p.POLL_INTERVAL_MS,
    };
  const intent = intentSchema.parse(JSON.parse(row.intent_json)),
    refs = associationSchema.parse(JSON.parse(row.association_json));
  const stored: unknown = JSON.parse(row.observation_json);
  if (
    refs.bookingIds.length !== intent.sessions.length ||
    !stored ||
    typeof stored !== "object" ||
    !("bookings" in stored) ||
    !("invoice" in stored)
  )
    return { status: "unresolved", reason: "invalid_input" };
  const scope = {
      accountId: intent.accountId,
      environmentId: "developer",
      attemptId: row.id,
    },
    subject = { kind: "guest", id: access.owner_id };
  const attempt = {
    ...scope,
    subject,
    customerId: intent.customerId,
    approvedAtMs: row.created_ms,
    invoiceId: refs.invoiceId,
    money: {
      currency: intent.currency,
      totalMinor: intent.totalMinor,
      taxMinor: intent.taxMinor,
    },
    bookings: intent.sessions.map((s, i) => ({
      session: {
        bookingId: refs.bookingIds[i],
        serviceId: s.serviceId,
        instructorId: s.instructorId,
        startMs: s.startMs,
        playEndMs: s.startMs + 40 * 60000,
        occupiedStartMs: s.startMs,
        occupiedEndMs: s.startMs + 50 * 60000,
      },
      money: {
        currency: intent.currency,
        totalMinor: s.totalMinor,
        taxMinor: s.taxMinor,
      },
    })),
  };
  return verifyConfirmation({
    nowMs: now,
    policy: {
      maxObservationAgeMs: p.OBSERVATION_MAX_AGE_MS,
      verificationDeadlineMs: row.deadline_ms,
    },
    attempt,
    access: {
      ...scope,
      subject,
      permission: "confirmation:read",
      validFromMs: access.issued_ms,
      expiresAtMs: access.expires_ms,
    },
    bookings: stored.bookings,
    invoice: stored.invoice,
  });
}
