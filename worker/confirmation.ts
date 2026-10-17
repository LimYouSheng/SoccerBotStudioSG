import {
  storedHitpayCheckout,
  recordedHitpayPayment,
  hitpayConfirmationGuard,
} from "./hitpay-journal";
import {
  START_INTERVAL_MINUTES,
  SESSION_MINUTES,
} from "../src/domain/booking-policy";
import { receiptData } from "./receipt-data";
import { storedNativeCheckout } from "./native-adapter";
import {
  verifyConfirmation,
  verifyRecordedConfirmation,
} from "../src/domain/confirmation";
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
    // The deadline ends checking, not the validity of fresh authoritative proof.
    // Preserve the shared booking/money/paid decision without reopening polls.
    return (
      (await hitpayConfirmationGuard(env, id)) ??
      decideStoredConfirmation(row, access, now, p)
    );
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
  const guard = await hitpayConfirmationGuard(env, id);
  if (guard) return guard;
  const decision = decideStoredConfirmation(row, access, now, p);
  if (decision.reason === "stale_observation") {
    // A completed payment is not permanently fresh booking evidence. Reuse the
    // original bounded financial claim; never reset its tries or expiry.
    const queued = await env.STATE.prepare(
      "UPDATE hitpay_payments SET state='due',reason='booking_refresh_pending',ready_ms=? WHERE attempt_id=? AND state='complete' AND paid_ms IS NOT NULL AND external_state='observed' AND tries<retry_limit AND recovery_end_ms>? RETURNING attempt_id",
    )
      .bind(now, id, now)
      .first();
    if (queued)
      return { status: "pending", reason: "payment_received_booking_pending" };
  }
  return decision;
}
// Shared decision mapping. Caller supplies independently established authority:
// authenticated customer access, or a current bounded internal recovery claim.
export function decideStoredConfirmation(
  row: StoredAttempt,
  access: Access,
  now: number,
  p: ReturnType<typeof policy>,
  recordedAtMs?: number,
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
  const input = {
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
  };
  return recordedAtMs === undefined
    ? verifyConfirmation(input)
    : verifyRecordedConfirmation(input, recordedAtMs);
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
      "SELECT id,created_ms,state,observation_json,intent_json,intent_hash,association_json,deadline_ms,confirmation_next_ms FROM attempts WHERE id=? AND owner_id=?",
    )
    .bind(id, access.owner_id)
    .first<
      StoredAttempt & {
        intent_json: string;
        intent_hash: string;
        association_json: string | null;
        deadline_ms: number;
        confirmation_next_ms: number;
      }
    >();
  if (!row) throw new ApiError(404, "attempt_unavailable");
  const intent = intentSchema.parse(JSON.parse(row.intent_json));
  const hitpayCheckout = await storedHitpayCheckout(env, id, now);
  const payment =
    hitpayCheckout === null
      ? undefined
      : await recordedHitpayPayment(
          env,
          id,
          row.intent_hash,
          row.association_json,
          row.intent_json,
        );
  let savedConfirmation;
  if (payment && row.observation_json) {
    const evidence = JSON.parse(row.observation_json);
    const times = [
      evidence.invoice?.observedAtMs,
      ...(Array.isArray(evidence.bookings)
        ? evidence.bookings.map(
            (booking: { observedAtMs?: number }) => booking.observedAtMs,
          )
        : []),
    ];
    const recordedAt = times.every(Number.isSafeInteger)
      ? Math.max(...times)
      : NaN;
    if (
      decideStoredConfirmation(row, access, now, policy(env), recordedAt)
        .status === "confirmed"
    )
      try {
        savedConfirmation = await receiptData(env, row, recordedAt);
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.code !== "receipt_details_unavailable"
        )
          throw error;
      }
  }
  await authenticate(request, env, Date.now());
  return {
    attemptId: id,
    mode: "live" as const,
    payment,
    confirmation: savedConfirmation,
    checkout:
      hitpayCheckout ??
      (row.association_json &&
      row.deadline_ms > now &&
      String(env.PROVIDER_ACCESS) === "trusted-reads"
        ? await storedNativeCheckout(
            env.STATE,
            id,
            JSON.parse(row.association_json),
            now,
          )
        : { state: "unavailable" as const }),
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
