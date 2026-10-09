import {
  START_INTERVAL_MINUTES,
  SESSION_MINUTES,
} from "../src/domain/booking-policy";
import { storedNativeCheckout } from "./native-adapter";
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
export type CheckingWindow = {
  deadlineMs: number;
  nextCheckMs: number;
  remaining: number;
};
export async function confirmation(
  request: Request,
  env: Env,
  id: string,
  now: number,
  report?: (window: CheckingWindow) => void,
) {
  const access = await authenticate(request, env, now);
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT id,created_ms,deadline_ms,state,intent_json,association_json,observation_json FROM attempts WHERE id=? AND owner_id=?",
    )
    .bind(id, access.owner_id)
    .first<StoredAttempt>();
  if (!row) throw new ApiError(404, "attempt_unavailable");
  const p = policy(env);
  if (now >= row.deadline_ms) {
    report?.({ deadlineMs: row.deadline_ms, nextCheckMs: now, remaining: 0 });
    return {
      status: "unresolved",
      reason:
        row.state === "recovery_required"
          ? "recovery_required"
          : "verification_window_elapsed",
      pollAfterMs: p.POLL_INTERVAL_MS,
    };
  }
  const quota = await env.STATE.prepare(
    "UPDATE attempts SET confirmation_next_ms=?,confirmation_checks=confirmation_checks+1 WHERE id=? AND owner_id=? AND confirmation_next_ms<=? AND confirmation_checks<120 RETURNING confirmation_next_ms,confirmation_checks",
  )
    .bind(now + p.POLL_INTERVAL_MS, row.id, access.owner_id, now)
    .first<{ confirmation_next_ms: number; confirmation_checks: number }>();
  if (!quota) {
    const saved = await env.STATE.withSession("first-primary")
      .prepare(
        "SELECT confirmation_next_ms,confirmation_checks FROM attempts WHERE id=? AND owner_id=?",
      )
      .bind(row.id, access.owner_id)
      .first<{ confirmation_next_ms: number; confirmation_checks: number }>();
    report?.({
      deadlineMs: row.deadline_ms,
      nextCheckMs: saved?.confirmation_next_ms ?? now + p.POLL_INTERVAL_MS,
      remaining: Math.max(0, 120 - (saved?.confirmation_checks ?? 120)),
    });
    throw new ApiError(
      429,
      saved && saved.confirmation_checks < 120
        ? "checking_throttled"
        : "checking_limit_reached",
    );
  }
  report?.({
    deadlineMs: row.deadline_ms,
    nextCheckMs: quota.confirmation_next_ms,
    remaining: 120 - quota.confirmation_checks,
  });
  return decideStoredConfirmation(row, access, now, p);
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
        playEndMs: s.startMs + SESSION_MINUTES * 60000,
        occupiedStartMs: s.startMs,
        occupiedEndMs: s.startMs + START_INTERVAL_MINUTES * 60000,
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

// A protected context/read boundary, not an invented native preparation method.
export async function checkoutContext(
  request: Request,
  env: Env,
  id: string,
  now: number,
) {
  const access = await authenticate(request, env, now);
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT intent_json,association_json,deadline_ms,confirmation_next_ms FROM attempts WHERE id=? AND owner_id=?",
    )
    .bind(id, access.owner_id)
    .first<{
      intent_json: string;
      association_json: string | null;
      deadline_ms: number;
      confirmation_next_ms: number;
    }>();
  if (!row) throw new ApiError(404, "attempt_unavailable");
  const intent = intentSchema.parse(JSON.parse(row.intent_json));
  return {
    attemptId: id,
    mode: "live" as const,
    checkout:
      row.association_json &&
      row.deadline_ms > now &&
      String(env.PROVIDER_ACCESS) === "trusted-reads"
        ? await storedNativeCheckout(
            env.STATE,
            id,
            JSON.parse(row.association_json),
            now,
          )
        : { state: "unavailable" as const },
    summary: {
      players: intent.sessions[0].players,
      totalMinor: intent.totalMinor,
      currency: intent.currency,
      sessions: intent.sessions.map((s) => ({
        startMs: s.startMs,
        players: s.players,
      })),
    },
    checking: {
      deadlineMs: row.deadline_ms,
      nextCheckMs: row.confirmation_next_ms,
      pollAfterMs: policy(env).POLL_INTERVAL_MS,
    },
  };
}
