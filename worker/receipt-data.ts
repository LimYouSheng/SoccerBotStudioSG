import { z } from "zod";
import { ApiError } from "./policy";
import { associationSchema, intentSchema } from "./journal";
import {
  nativeAvailabilitySchema,
  receiptSchema,
  bookingDetailsSchema,
} from "../src/domain/native-checkout";
export async function bookingDetailsData(
  env: Env,
  row: {
    id: string;
    intent_json: string;
    created_ms: number;
    association_json: string | null;
  },
) {
  const intent = intentSchema.parse(JSON.parse(row.intent_json));
  if (!intent.contact) throw new ApiError(503, "receipt_details_unavailable");
  const snapshot = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT availability_json FROM native_checkout_grants WHERE attempt_id=? UNION ALL SELECT availability_json FROM completed_native_checkout_grants WHERE attempt_id=? UNION ALL SELECT availability_json FROM expired_native_checkout_grants WHERE attempt_id=?",
    )
    .bind(row.id, row.id, row.id)
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
  const association = associationSchema.parse(
    JSON.parse(row.association_json || "null"),
  );
  if (association.bookingIds.length !== slots.length)
    throw new ApiError(503, "receipt_details_unavailable");
  return bookingDetailsSchema.parse({
    providerReferences: {
      bookingIds: association.bookingIds,
      invoiceId: association.invoiceId,
    },
    attemptId: row.id,
    createdAtMs: row.created_ms,
    taxMinor: intent.taxMinor,
    totalMinor: intent.totalMinor,
    contact: intent.contact,
    sessions: slots,
  });
}

export async function receiptData(
  env: Env,
  row: Parameters<typeof bookingDetailsData>[1],
  now: number,
) {
  return receiptSchema.parse({
    ...(await bookingDetailsData(env, row)),
    verifiedAtMs: now,
  });
}
