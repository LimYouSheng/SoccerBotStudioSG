import { z } from "zod";
import { authenticate } from "./access";
import { ApiError, digest } from "./policy";
import {
  intentSchema,
  associationSchema,
  claimDispatch,
  bindAssociation,
  requireRecovery,
} from "./journal";

type Intent = z.infer<typeof intentSchema>;
type Session = Intent["sessions"][number];
type Context = { attemptId: string; sessionIndex: number };
const reference = z.string().min(1).max(128);
const acceptedSession = z.strictObject({
  bookingId: reference,
  accountId: reference,
  customerId: reference,
  serviceId: reference,
  instructorId: reference,
  startMs: z.number().int().safe(),
  players: z.number().int().min(1).max(4),
  currency: z.literal("SGD"),
  totalMinor: z.number().int().nonnegative().safe(),
  taxMinor: z.number().int().nonnegative().safe(),
  confirmed: z.literal(true),
});
const finalizedInvoice = z.strictObject({
  invoiceId: reference,
  accountId: reference,
  customerId: reference,
  currency: z.literal("SGD"),
  totalMinor: z.number().int().nonnegative().safe(),
  taxMinor: z.number().int().nonnegative().safe(),
  bookingIds: z.array(reference).min(1).max(12),
});

// Application contract, NOT a claim that a SimplyBook batch adapter exists.
// No production implementation or HTTP booking route supplies this interface.
export type BookingOperations = {
  supported: boolean;
  hasRecoveryCapacity: (sessions: number) => Promise<boolean>;
  revalidate: (intent: Intent, context: Context) => Promise<unknown>;
  createSession: (
    session: Session,
    intent: Intent,
    context: Context,
  ) => Promise<unknown>;
  finalize: (
    bookingIds: string[],
    intent: Intent,
    attemptId: string,
  ) => Promise<unknown>;
};

export async function orchestrateBooking(
  request: Request,
  env: Env,
  id: string,
  operations: BookingOperations,
) {
  const access = await authenticate(request, env, Date.now());
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT intent_json,intent_hash,state,version,deadline_ms,association_json FROM attempts WHERE id=? AND owner_id=?",
    )
    .bind(id, access.owner_id)
    .first<{
      intent_json: string;
      intent_hash: string;
      state: string;
      version: number;
      deadline_ms: number;
      association_json: string | null;
    }>();
  if (!row) throw new ApiError(404, "attempt_unavailable");
  if (!operations.supported)
    return { state: "contracts_unavailable", paymentAvailable: false };
  if (row.association_json) {
    associationSchema.parse(JSON.parse(row.association_json));
    return { state: "associated", paymentAvailable: false };
  }
  if (row.state !== "prepared")
    return { state: "recovery_required", paymentAvailable: false };
  const intent = intentSchema.parse(JSON.parse(row.intent_json));
  if (
    row.deadline_ms <= Date.now() ||
    intent.sessions.some((s) => s.startMs <= Date.now()) ||
    !(await operations.hasRecoveryCapacity(intent.sessions.length))
  )
    return { state: "prerequisites_unavailable", paymentAvailable: false };
  // Single atomic winner. A second click or resumed process cannot replay writes.
  let fence: number;
  try {
    fence = (await claimDispatch(env.STATE, id, row.version, Date.now())).fence;
  } catch (error) {
    if (error instanceof ApiError && error.code === "dispatch_not_claimed")
      return { state: "recovery_required", paymentAvailable: false };
    throw error;
  }
  const reserve = async (step: string) => {
    const now = Date.now();
    const result = await env.STATE.prepare(
      "INSERT INTO session_effects(attempt_id,step,outcome) SELECT id,?,'unknown' FROM attempts WHERE id=? AND version=? AND state='dispatching' AND deadline_ms>? AND EXISTS (SELECT 1 FROM guest_access WHERE capability_hash=? AND owner_id=? AND revoked_ms IS NULL AND issued_ms<=? AND expires_ms>?)",
    )
      .bind(
        step,
        id,
        fence,
        now,
        access.capability_hash,
        access.owner_id,
        now,
        now,
      )
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(409, "effect_not_claimed");
  };
  const observed = async (step: string, referenceId: string) => {
    const result = await env.STATE.prepare(
      "UPDATE session_effects SET outcome='observed',reference_id=? WHERE attempt_id=? AND step=? AND outcome='unknown' AND EXISTS (SELECT 1 FROM attempts WHERE id=? AND version=? AND state='dispatching')",
    )
      .bind(referenceId, id, step, id, fence)
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(409, "effect_completion_conflict");
  };
  try {
    const ids: string[] = [];
    for (const [sessionIndex, session] of intent.sessions.entries()) {
      const context = { attemptId: id, sessionIndex };
      // The eventual live adapter must verify identity, eligible instructor,
      // timetable, shared slot, exact price/tax and persisted player mapping.
      const fresh = intentSchema.parse(
        await operations.revalidate(intent, context),
      );
      if (
        (await digest(JSON.stringify(fresh))) !== row.intent_hash ||
        session.startMs <= Date.now() ||
        row.deadline_ms <= Date.now()
      )
        throw new ApiError(409, "approved_intent_changed");
      const step = `session:${sessionIndex}`;
      await reserve(step);
      const raw = await operations.createSession(session, intent, context);
      // Preserve an observed reference even if its association is invalid.
      if (
        raw &&
        typeof raw === "object" &&
        "bookingId" in raw &&
        reference.safeParse(raw.bookingId).success
      )
        await observed(step, reference.parse(raw.bookingId));
      const accepted = acceptedSession.parse(raw);
      if (
        accepted.accountId !== intent.accountId ||
        accepted.customerId !== intent.customerId ||
        accepted.serviceId !== session.serviceId ||
        accepted.instructorId !== session.instructorId ||
        accepted.startMs !== session.startMs ||
        accepted.players !== session.players ||
        accepted.totalMinor !== session.totalMinor ||
        accepted.taxMinor !== session.taxMinor ||
        ids.includes(accepted.bookingId)
      )
        throw new ApiError(409, "booking_association_invalid");
      ids.push(accepted.bookingId);
    }
    await reserve("finalize");
    const raw = await operations.finalize(ids, intent, id);
    if (
      raw &&
      typeof raw === "object" &&
      "invoiceId" in raw &&
      reference.safeParse(raw.invoiceId).success
    )
      await observed("finalize", reference.parse(raw.invoiceId));
    const invoice = finalizedInvoice.parse(raw);
    if (
      invoice.accountId !== intent.accountId ||
      invoice.customerId !== intent.customerId ||
      invoice.totalMinor !== intent.totalMinor ||
      invoice.taxMinor !== intent.taxMinor ||
      invoice.bookingIds.length !== ids.length ||
      new Set(invoice.bookingIds).size !== ids.length ||
      !ids.every((bookingId) => invoice.bookingIds.includes(bookingId))
    )
      throw new ApiError(409, "invoice_association_invalid");
    await bindAssociation(env.STATE, id, fence, {
      invoiceId: invoice.invoiceId,
      bookingIds: ids,
    });
    // Native checkout/return contract is separately unavailable. Association is
    // not payment, confirmation, a provider settlement or permission to retry.
    return { state: "associated", paymentAvailable: false };
  } catch {
    await requireRecovery(env.STATE, id, fence);
    return { state: "recovery_required", paymentAvailable: false };
  }
}
