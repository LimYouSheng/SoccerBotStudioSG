import { z } from "zod";
import {
  CATALOGUE_RECORD_LIMIT,
  catalogueSelection,
  providerSelectionSchema,
  type CatalogueBinding,
} from "../src/domain/catalog";
import {
  NATIVE_TRIAL_LEAD_MS,
  SESSION_MINUTES,
} from "../src/domain/booking-policy";
import { ApiError } from "./policy";
import { intentSchema } from "./journal";
import { CatalogueReads, freshReceipt } from "./catalogue";
import { providerId } from "./provider-normalization";
import type { NativeExchange } from "./provider-transport";
type Intent = z.infer<typeof intentSchema>;
export function nativeBookingComment(value: unknown, sessionIndex: number) {
  const intent = intentSchema.parse(value);
  const session = intent.sessions[sessionIndex];
  if (!Number.isInteger(sessionIndex) || !session)
    throw new ApiError(409, "native_session_missing");
  const school = intent.contact?.academy;
  return (
    `Number of players: ${session.players}` +
    (school ? `\nSchool / organisation: ${school}` : "")
  );
}
const record = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ApiError(503, "availability_representation_unavailable");
  return raw as Record<string, unknown>;
};
export function offeredStarts(raw: unknown, date: string): string[] {
  const map = record(raw),
    starts = map[date];
  if (
    Object.keys(map).some((key) => key !== date) ||
    !Array.isArray(starts) ||
    starts.length > 1440 ||
    starts.some(
      (value) =>
        typeof value !== "string" ||
        !/^([01]\d|2[0-3]):[0-5]\d:00$/.test(value),
    ) ||
    new Set(starts).size !== starts.length
  )
    throw new ApiError(503, "availability_representation_unavailable");
  return starts;
}
export function eligibleInstructors(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > CATALOGUE_RECORD_LIMIT)
    throw new ApiError(503, "eligibility_representation_unavailable");
  const ids = raw.map((value) => providerId(value));
  if (new Set(ids).size !== ids.length)
    throw new ApiError(503, "eligibility_representation_unavailable");
  return ids;
}
// This is an owner declaration installed by the trusted finite developer
// composition, never a customer input or proof of a completed provider trial.
export const nativeAccountContractSchema = z
  .strictObject({
    accountId: z.string().min(1).max(128),
    environmentId: z.literal("developer"),
    companyLogin: z.string().min(1).max(128),
    serviceId: z.string().regex(/^[1-9]\d{0,14}$/),
    priceMinor: z.literal(8800),
    currency: z.literal("SGD"),
    taxMinor: z.literal(0),
    durationMinutes: z.literal(40),
    bufferAfterMinutes: z.literal(10),
    clientLoginRequired: z.literal(false),
    providerSchedules: z.literal("non-overlapping"),
    trialLeadTimeException: z.literal("owner-2026-10-14-15").optional(),
    confirmedAtMs: z.number().int().positive().safe(),
    expiresAtMs: z.number().int().positive().safe(),
  })
  .refine((value) => value.expiresAtMs > value.confirmedAtMs);
export type NativeAccountContract = z.infer<typeof nativeAccountContractSchema>;
// This date-specific owner exception exists only in an externally installed
// developer contract. Customer DTOs cannot supply it; all other trials retain48h.
export function nativeTrialLeadMs(
  contractValue: unknown,
  binding: CatalogueBinding,
  session: { serviceId: string; instructorId: string; startMs: number },
  now: number,
) {
  const parsed = nativeAccountContractSchema.safeParse(contractValue);
  if (!parsed.success) return NATIVE_TRIAL_LEAD_MS;
  const contract = parsed.data;
  const date = new Date(session.startMs + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  if (
    contract.trialLeadTimeException === "owner-2026-10-14-15" &&
    contract.accountId === binding.accountId &&
    contract.environmentId === binding.environmentId &&
    contract.companyLogin === binding.companyLogin &&
    contract.serviceId === "2" &&
    session.serviceId === "2" &&
    session.instructorId === "3" &&
    (date === "2026-10-14" || date === "2026-10-15") &&
    contract.confirmedAtMs <= now &&
    contract.expiresAtMs > now &&
    contract.expiresAtMs <= Date.parse("2026-10-14T00:00:00+08:00")
  )
    return 24 * 3600000;
  return NATIVE_TRIAL_LEAD_MS;
}
// Server-owned pre-write implementation. Reads documented current catalogue,
// service relationship, exact slot/eligibility and required fields; never trusts
// browser snapshots and never infers shared capacity or tax. The owner-approved
// native allocation is one studio; group size is automatic, non-blocking booking-comment information.
export class NativePrebooking {
  constructor(
    private binding: CatalogueBinding,
    private catalogue: CatalogueReads,
    private exchange: NativeExchange,
    private accountContract?: NativeAccountContract,
  ) {}
  invalidate() {
    this.catalogue.invalidate(this.binding);
  }
  async review(value: unknown, sessionIndex = 0) {
    const intent = intentSchema.parse(value),
      now = Date.now();
    if (
      intent.accountId !== this.binding.accountId ||
      intent.environmentId !== this.binding.environmentId
    )
      throw new ApiError(403, "native_account_mismatch");
    const session = intent.sessions[sessionIndex];
    if (!Number.isInteger(sessionIndex) || !session)
      throw new ApiError(409, "native_session_missing");
    providerSelectionSchema.parse(sessionSelection(session));
    if (
      session.startMs - now <
      nativeTrialLeadMs(this.accountContract, this.binding, session, now)
    )
      throw new ApiError(409, "native_trial_lead_time");
    if (session.startMs % 60000 !== 0)
      throw new ApiError(409, "native_start_precision_unsupported");
    const current = await this.catalogue.read(
      this.binding,
      this.exchange,
      true,
    );
    const selected = catalogueSelection(current, sessionSelection(session));
    if (!selected) return { state: "selection_unavailable" as const, intent };
    const { service, instructor } = selected;
    if (
      service.durationMinutes !== SESSION_MINUTES ||
      service.recurring ||
      service.currency !== intent.currency ||
      intent.taxMinor !== 0
    )
      return {
        state: "unavailable" as const,
        reasons: ["native_service_profile_unsupported"],
        intent,
      };
    const wall = new Date(session.startMs + 8 * 3600000).toISOString();
    const date = wall.slice(0, 10),
      time = wall.slice(11, 19);
    const fields = await this.exchange({
      kind: "required-fields",
      serviceId: service.id,
    });
    if (!Array.isArray(fields.body) || fields.body.length !== 0)
      return {
        state: "unavailable" as const,
        reasons: ["native_required_fields_unsupported"],
        intent,
      };
    const eligible = await this.exchange({
      kind: "eligible-instructors",
      serviceId: service.id,
      date,
      time,
    });
    const ids = eligibleInstructors(eligible.body);
    if (
      ids.some(
        (id) =>
          !current.instructors.some(
            (person) => person.id === id && person.active,
          ),
      )
    )
      throw new ApiError(503, "eligibility_catalogue_conflict");
    // The owner configures non-overlapping provider schedules for one studio.
    // Unexpected overlap is configuration drift, never a name/order tie-break.
    if (ids.length > 1)
      return {
        state: "unavailable" as const,
        reasons: ["native_provider_schedule_overlap"],
        intent,
      };
    const slot = await this.exchange({
      kind: "availability",
      serviceId: service.id,
      instructorId: instructor.id,
      date,
    });
    const completed = Date.now();
    for (const receipt of [
      current.observedAtMs,
      fields.receivedAtMs,
      eligible.receivedAtMs,
      slot.receivedAtMs,
    ])
      freshReceipt(receipt, completed);
    if (
      session.startMs - completed <
      nativeTrialLeadMs(this.accountContract, this.binding, session, completed)
    )
      throw new ApiError(409, "native_trial_lead_time");
    if (
      !ids.includes(instructor.id) ||
      !offeredStarts(slot.body, date).includes(time)
    )
      return { state: "selection_unavailable" as const, intent };
    const review = {
      serviceId: service.id,
      serviceName: service.name,
      instructorId: instructor.id,
      instructorName: instructor.name,
      startMs: session.startMs,
      players: session.players,
      bookingComment: nativeBookingComment(intent, sessionIndex),
      priceMinor: service.priceMinor,
      currency: service.currency,
      taxMinor: null,
    };
    if (service.priceMinor !== session.totalMinor)
      return { state: "restart_required" as const, review, intent };
    const declared = nativeAccountContractSchema.safeParse(
      this.accountContract,
    );
    if (declared.success) {
      const contract = declared.data;
      if (
        contract.accountId !== this.binding.accountId ||
        contract.environmentId !== this.binding.environmentId ||
        contract.companyLogin !== this.binding.companyLogin ||
        contract.serviceId !== service.id ||
        contract.confirmedAtMs > completed ||
        contract.expiresAtMs <= completed
      )
        throw new ApiError(503, "native_account_contract_unavailable");
      if (service.priceMinor !== contract.priceMinor)
        return { state: "restart_required" as const, review, intent };
      if (intent.customerMode === "booking-contact" && intent.contact)
        return {
          state: "ready" as const,
          review: { ...review, taxMinor: 0 },
          intent,
        };
    }
    // Remaining upstream mappings cannot be manufactured from a response schema.
    // Count1 allocates the studio. Comment delivery is automatic but non-blocking;
    // its failure must not prevent payment or trigger booking retries.
    return {
      state: "unavailable" as const,
      review,
      intent,
      reasons: [
        "native_customer_binding_unavailable",
        "native_quote_tax_unavailable",
        "native_shared_capacity_unverified",
      ],
    };
  }
  async revalidate(value: Intent, sessionIndex = 0): Promise<Intent> {
    const result = await this.review(value, sessionIndex);
    if (result.state === "ready") return result.intent;
    // Missing or expired declarations never open native creation.
    throw new ApiError(
      result.state === "unavailable" ? 503 : 409,
      result.state === "restart_required"
        ? "native_restart_required"
        : result.state === "selection_unavailable"
          ? "native_selection_changed"
          : "native_prebooking_unavailable",
    );
  }
}
function sessionSelection(session: Intent["sessions"][number]) {
  return {
    serviceId: session.serviceId,
    instructorId: session.instructorId,
    startMs: session.startMs,
    players: session.players,
  };
}
