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
  const ids = raw.map(providerId);
  if (new Set(ids).size !== ids.length)
    throw new ApiError(503, "eligibility_representation_unavailable");
  return ids;
}
// Server-owned pre-write implementation. Reads documented current catalogue,
// service relationship, exact slot/eligibility and required fields; never trusts
// browser snapshots and never infers shared capacity, tax or player persistence.
export class NativePrebooking {
  constructor(
    private binding: CatalogueBinding,
    private catalogue: CatalogueReads,
    private exchange: NativeExchange,
  ) {}
  invalidate() {
    this.catalogue.invalidate(this.binding);
  }
  async review(value: unknown) {
    const intent = intentSchema.parse(value),
      now = Date.now();
    if (
      intent.accountId !== this.binding.accountId ||
      intent.environmentId !== this.binding.environmentId
    )
      throw new ApiError(403, "native_account_mismatch");
    if (intent.sessions.length !== 1)
      throw new ApiError(503, "native_single_session_only");
    const session = intent.sessions[0];
    providerSelectionSchema.parse(sessionSelection(session));
    if (session.startMs - now < NATIVE_TRIAL_LEAD_MS)
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
    if (session.startMs - completed < NATIVE_TRIAL_LEAD_MS)
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
      priceMinor: service.priceMinor,
      currency: service.currency,
      taxMinor: null,
    };
    if (service.priceMinor !== intent.totalMinor)
      return { state: "review_required" as const, review, intent };
    // Remaining upstream mappings cannot be manufactured from a response schema.
    // An empty intake is not evidence that player persistence is unnecessary.
    return {
      state: "unavailable" as const,
      review,
      intent,
      reasons: [
        "native_customer_binding_unavailable",
        "native_quote_tax_unavailable",
        "native_shared_capacity_unverified",
        "native_player_mapping_unavailable",
        ...(ids.length > 1 ? ["native_assignment_policy_unavailable"] : []),
      ],
    };
  }
  async revalidate(value: Intent): Promise<Intent> {
    const result = await this.review(value);
    // No supported player/customer/tax/capacity mapping currently permits commit.
    throw new ApiError(
      result.state === "unavailable" ? 503 : 409,
      result.state === "review_required"
        ? "native_review_required"
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
