import { receiptSchema, bookingDetailsSchema } from "@/domain/native-checkout";
import type { Booking } from "@/domain/booking";
import { LOCATION } from "@/domain/catalog";
import { MAX_PLAYERS } from "@/domain/booking-policy";
import {
  isNativeCheckoutUrl,
  isHitpayCheckoutUrl,
} from "@/domain/native-checkout";
import { z } from "zod";
import type { ProtectedCheckoutService } from "./contracts";
const idSchema = z.string().uuid();
const decisionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), reason: z.literal("verified") }),
  z.object({
    status: z.literal("pending"),
    reason: z.string(),
    customerConfirmation: receiptSchema.optional(),
    expired: z.boolean().optional(),
  }),
  z.object({
    status: z.literal("unresolved"),
    reason: z.string(),
    customerConfirmation: receiptSchema.optional(),
    expired: z.boolean().optional(),
  }),
  z.object({ status: z.literal("invalid"), reason: z.string() }),
  z.object({ status: z.literal("denied"), reason: z.literal("access_denied") }),
]);
export class ConfirmationError extends Error {
  constructor(
    public kind: "denied" | "unavailable" | "throttled" | "exhausted",
    public nextCheckMs?: number,
    public deadlineMs?: number,
  ) {
    super("confirmation_unavailable");
  }
}
const instant = z.number().int().nonnegative().safe();
const contextSchema = z.strictObject({
  customerConfirmation: receiptSchema.optional(),
  expired: z.boolean().optional(),
  details: bookingDetailsSchema.optional(),
  confirmation: receiptSchema.optional(),
  payment: z
    .strictObject({ status: z.literal("recorded"), paidAtMs: instant })
    .optional(),
  attemptId: idSchema,
  mode: z.enum(["synthetic", "live"]),
  checkout: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unavailable") }),
    z.strictObject({
      state: z.literal("available"),
      url: z.string().max(2048),
      expiresAtMs: instant.optional(),
    }),
  ]),
  summary: z.strictObject({
    players: z.number().int().min(1).max(MAX_PLAYERS),
    totalMinor: instant,
    currency: z.literal("SGD"),
    sessions: z
      .array(
        z.strictObject({
          startMs: instant,
          players: z.number().int().min(1).max(MAX_PLAYERS),
        }),
      )
      .min(1)
      .max(12),
  }),
  checking: z.strictObject({
    deadlineMs: instant,
    holdExpiresAtMs: instant.optional(),
    nextCheckMs: instant,
    pollAfterMs: z.number().int().min(1000).max(30000),
  }),
});
async function protectedRead(
  attemptId: string,
  operation: string,
  signal: AbortSignal,
  displayDetails = false,
) {
  idSchema.parse(attemptId);
  const response = await fetch(
    `/api/attempts/${encodeURIComponent(attemptId)}/${operation}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
      headers: {
        Accept: "application/json",
        ...(displayDetails ? { "X-Booking-Details": "1" } : {}),
      },
    },
  );
  const value = (name: string) => {
    const raw = response.headers.get(name);
    const n = Number(raw);
    return raw && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
  };
  const checking = {
    nextCheckMs: value("X-Next-Check"),
    deadlineMs: value("X-Checking-Deadline"),
  };
  if (response.status === 401 || response.status === 403)
    throw new ConfirmationError("denied");
  if (response.status === 429)
    throw new ConfirmationError(
      response.headers.get("X-Checks-Remaining") === "0"
        ? "exhausted"
        : "throttled",
      checking.nextCheckMs,
      checking.deadlineMs,
    );
  if (!response.ok) throw new ConfirmationError("unavailable");
  return { response, checking };
}
export async function readConfirmation(attemptId: string, signal: AbortSignal) {
  const { response, checking } = await protectedRead(
    attemptId,
    "confirmation",
    signal,
  );
  const decision = decisionSchema.parse(await response.json());
  if (
    "customerConfirmation" in decision &&
    decision.customerConfirmation?.attemptId !== undefined &&
    decision.customerConfirmation.attemptId !== attemptId
  )
    throw new ConfirmationError("unavailable");
  return { ...decision, checking };
}
export async function readBookingReceipt(
  attemptId: string,
  signal: AbortSignal,
) {
  const { response } = await protectedRead(attemptId, "receipt", signal);
  const receipt = receiptSchema.parse(await response.json());
  // The authenticated server validates provider freshness. Compare its receipt
  // to its HTTP clock, not a customer's potentially skewed device clock.
  const serverDate = Date.parse(response.headers.get("Date") ?? "");
  const referenceTime = Number.isFinite(serverDate) ? serverDate : Date.now();
  const precision = Number.isFinite(serverDate) ? 999 : 0;
  if (
    signal.aborted ||
    receipt.attemptId !== attemptId ||
    receipt.verifiedAtMs > referenceTime + precision ||
    referenceTime - receipt.verifiedAtMs > 60000
  )
    throw new ConfirmationError("unavailable");
  return bookingFromReceipt(receipt);
}
export function bookingFromReceipt<
  T extends z.infer<typeof bookingDetailsSchema>,
>(receipt: T) {
  const slots = receipt.sessions.map((offer) => {
    const wall = new Date(offer.startMs + 28800000).toISOString();
    return {
      date: wall.slice(0, 10),
      start: wall.slice(11, 16),
      instructor: offer.instructorId,
      studio: LOCATION.building,
      native: {
        serviceId: offer.serviceId,
        ...(offer.productServiceId
          ? { productServiceId: offer.productServiceId }
          : {}),
        serviceName: offer.serviceName,
        instructorName: offer.instructorName,
        priceMinor: offer.priceMinor,
        currency: offer.currency,
      },
    };
  });
  const booking: Booking = {
    reference: receipt.attemptId,
    ...(receipt.providerReferences
      ? { providerReferences: receipt.providerReferences }
      : {}),
    createdAt: new Date(receipt.createdAtMs).toISOString(),
    totalCents: receipt.totalMinor,
    slots,
    draft: {
      mode: "guest",
      accountEmail: "",
      nativeServiceId:
        receipt.sessions[0].productServiceId ?? receipt.sessions[0].serviceId,
      players: receipt.sessions[0].players,
      slots,
      contact: receipt.contact,
      accepted: true,
    },
  };
  return { ...receipt, booking };
}
export const protectedCheckoutService: ProtectedCheckoutService = {
  async context({ attemptId, mode, signal }) {
    const { response } = await protectedRead(
      attemptId,
      "checkout",
      signal,
      true,
    );
    const context = contextSchema.parse(await response.json());
    if (
      context.attemptId !== attemptId ||
      context.mode !== mode ||
      (context.confirmation && context.confirmation.attemptId !== attemptId) ||
      (context.details && context.details.attemptId !== attemptId) ||
      (context.customerConfirmation &&
        context.customerConfirmation.attemptId !== attemptId)
    )
      throw new ConfirmationError("unavailable");
    if (context.checkout.state === "available") {
      if (
        mode === "synthetic"
          ? context.checkout.url !== `/__experiment/checkout/${attemptId}`
          : (!isNativeCheckoutUrl(context.checkout.url) &&
              !isHitpayCheckoutUrl(context.checkout.url)) ||
            context.checkout.expiresAtMs === undefined ||
            context.checkout.expiresAtMs <= Date.now() ||
            context.checkout.expiresAtMs > context.checking.deadlineMs
      )
        throw new ConfirmationError("unavailable");
    }
    return context;
  },
};

export async function startSyntheticCheckout(
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch("/__experiment/attempts", {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new ConfirmationError("unavailable");
  return z.strictObject({ attemptId: idSchema }).parse(await response.json())
    .attemptId;
}

export async function expireBooking(attemptId: string) {
  const id = idSchema.parse(attemptId);
  const response = await fetch(`/api/attempts/${id}/expire`, {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok || !(await response.json()).expired)
    throw new Error(
      "Payment status is still being checked. Your original booking has been kept.",
    );
}

export async function dismissCompletedBooking(attemptId: string) {
  const id = idSchema.parse(attemptId);
  const response = await fetch(`/api/attempts/${id}/dismiss`, {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok || !(await response.json()).dismissed)
    throw new Error(
      "Your booking could not be closed on this device. Please try again.",
    );
}

// Tab-local navigation intent only; the server still verifies completion and
// ownership before releasing anything. Retain interrupted exits across reload.
const exitKey = "soccerbot.completed-exit";
export function completedExitIntent() {
  try {
    const value = idSchema.safeParse(sessionStorage.getItem(exitKey));
    return value.success ? value.data : null;
  } catch {
    return null;
  }
}
export function rememberCompletedExit(id: string) {
  try {
    sessionStorage.setItem(exitKey, idSchema.parse(id));
  } catch {
    // Current-page work remains protected if browser storage is unavailable.
  }
}
export function forgetCompletedExit(id: string) {
  try {
    if (completedExitIntent() === id) sessionStorage.removeItem(exitKey);
  } catch {}
}
