import {
  CATALOGUE_MAX_AGE_MS,
  displayDeadline,
  catalogueSchema,
  catalogueBindingSchema,
  type CatalogueBinding,
  providerIdentifier,
} from "@/domain/catalog";
import type { CatalogueService } from "./contracts";
import { z } from "zod";
import {
  attemptSchema,
  draftSchema,
  outcomeSchema,
  sessionSchema,
  slotKey,
  snapshot,
  totalCents,
  type Attempt,
} from "@/domain/booking";
import { isDate, clockMinutes } from "@/domain/dates";
import { MAX_PLAYERS } from "@/domain/booking-policy";
import { SESSION_STARTS } from "@/domain/demo-catalog";
import { BookingServiceError, type BookingService } from "./contracts";
import {
  publicCalendarSchema,
  nativeDisplaySlots,
  nativeAvailabilitySchema,
  nativeCalendarSchema,
  hitpayHandoffSchema,
  nativePrepareSchema,
  nativeCurrentSchema,
} from "@/domain/native-checkout";

const availabilityInput = z.object({
  date: z.string().refine(isDate),
  players: z.number().int().min(1).max(MAX_PLAYERS),
  serviceId: providerIdentifier.optional(),
  fresh: z.boolean().optional(),
});
const checkoutInput = z.object({
  holding: z.boolean().optional(),
  draft: draftSchema,
  previous: attemptSchema.nullable(),
});
const attemptInput = z.object({ attempt: attemptSchema });
const payInput = attemptInput.extend({
  startCheckout: z.boolean().optional(),
  outcome: outcomeSchema,
  holding: z.boolean().optional(),
});
const resolveInput = attemptInput.extend({
  now: z.number().finite().nonnegative().optional(),
});
const slotsSchema = z
  .array(sessionSchema.safeExtend({ available: z.boolean() }))
  .max(100);
const cancelled = () =>
  new BookingServiceError("cancelled", "The request was cancelled.");
const invalidResponse = () =>
  new BookingServiceError(
    "invalid_response",
    "We couldn’t check this information. Please try again.",
  );

// Abort ends the UI wait even for a non-cooperative adapter. It does not undo an
// effect already dispatched. Callers must also correlate their input revision.
async function complete<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) throw cancelled();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
function decode<T>(schema: z.ZodType<T>, value: unknown, input = false): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw input
      ? new BookingServiceError(
          "invalid_request",
          "Please review your booking details.",
        )
      : invalidResponse();
  return parsed.data;
}
async function invoke<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw cancelled();
  try {
    const result = await complete(operation(), signal);
    if (signal?.aborted) throw cancelled();
    return result;
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    if (error instanceof BookingServiceError) throw error;
    throw new BookingServiceError(
      "temporarily_unavailable",
      "We couldn’t complete that request. Please try again.",
    );
  }
}
function resultAttempt(
  value: unknown,
  draft: z.infer<typeof draftSchema>,
  id?: string,
) {
  const result = decode(attemptSchema, value);
  if (
    !result.id ||
    (id && result.id !== id) ||
    JSON.stringify(snapshot(result.draft)) !==
      JSON.stringify(snapshot(draft)) ||
    (result.status === "paid" ? !result.booking : result.booking !== null)
  )
    throw invalidResponse();
  if (
    result.booking &&
    (result.booking.reference !== result.id ||
      result.booking.totalCents !== totalCents(draft) ||
      JSON.stringify(snapshot(result.booking.draft)) !==
        JSON.stringify(snapshot(draft)) ||
      result.booking.slots.length !== draft.slots.length ||
      result.booking.slots.some(
        (slot, index) =>
          slotKey(slot) !== slotKey(snapshot(draft).slots[index]),
      ))
  )
    throw invalidResponse();
  return result;
}

function transitioned(
  operation: "pay" | "check" | "resolve",
  previous: Attempt,
  value: unknown,
) {
  const result = resultAttempt(value, previous.draft, previous.id);
  const allowed =
    operation === "pay"
      ? [
          previous.status === "ready" || previous.status === "declined"
            ? "checking"
            : previous.status,
        ]
      : operation === "check"
        ? [previous.status === "pending" ? "checking" : previous.status]
        : previous.status === "checking"
          ? [
              "checking",
              ...(previous.outcome === "success"
                ? ["paid", "late"]
                : [previous.outcome]),
            ]
          : [previous.status];
  if (!allowed.includes(result.status) || result.checkUntil < 0)
    throw invalidResponse();
  return result;
}

// Named booking boundary, not an RPC dispatcher. Validation also protects test
// and future adapters: successful TypeScript typing alone is not wire evidence.
export function defineBookingService(adapter: BookingService): BookingService {
  function supported(operation: keyof BookingService["operations"]) {
    if (adapter.operations[operation] !== adapter.mode)
      throw new BookingServiceError(
        "unavailable",
        "Online booking is not available yet. Please contact the studio.",
      );
  }
  return {
    mode: adapter.mode,
    operations: adapter.operations,
    ...(adapter.restore
      ? {
          restore: (signal: AbortSignal) =>
            invoke(signal, async () => {
              const restored = await adapter.restore!(signal);
              if (restored === null) return null;
              const parsed = decode(attemptSchema, restored);
              if (
                adapter.mode !== "live" ||
                !["ready", "checking"].includes(parsed.status) ||
                parsed.booking !== null ||
                parsed.draft.slots.some((slot) => !slot.native)
              )
                throw invalidResponse();
              return parsed;
            }),
        }
      : {}),
    ...(adapter.publicCalendar
      ? {
          publicCalendar: (
            input: Parameters<NonNullable<BookingService["publicCalendar"]>>[0],
          ) =>
            invoke(input.signal, async () => {
              supported("availability");
              const value = decode(
                publicCalendarSchema,
                await adapter.publicCalendar!(input),
              );
              if (
                value.month !== input.month ||
                value.observedAtMs > Date.now() ||
                Date.now() >= displayDeadline(value, CATALOGUE_MAX_AGE_MS)
              )
                throw invalidResponse();
              return value;
            }),
        }
      : {}),
    ...(adapter.calendar
      ? {
          calendar: (
            input: Parameters<NonNullable<BookingService["calendar"]>>[0],
          ) =>
            invoke(input.signal, async () => {
              supported("availability");
              if (
                !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) ||
                !providerIdentifier.safeParse(input.serviceId).success
              )
                throw invalidResponse();
              const value = await adapter.calendar!(input);
              if (
                value.month !== input.month ||
                value.observedAtMs > Date.now() ||
                Date.now() - value.observedAtMs >= CATALOGUE_MAX_AGE_MS ||
                value.dates.length > 31 ||
                new Set(value.dates.map((d) => d.date)).size !==
                  value.dates.length ||
                value.dates.some(
                  (d) =>
                    !isDate(d.date) ||
                    !d.date.startsWith(input.month + "-") ||
                    typeof d.available !== "boolean",
                )
              )
                throw invalidResponse();
              return value;
            }),
        }
      : {}),
    availability(input) {
      return invoke(input.signal, async () => {
        supported("availability");
        const request = decode(availabilityInput, input, true);
        const slots = decode(
          slotsSchema,
          await adapter.availability({ ...request, signal: input.signal }),
        );
        if (
          slots.some(
            (slot) =>
              slot.date !== request.date ||
              (adapter.mode === "demo"
                ? !!slot.native ||
                  !SESSION_STARTS.includes(clockMinutes(slot.start))
                : !slot.native ||
                  (slot.native.productServiceId ?? slot.native.serviceId) !==
                    request.serviceId),
          ) ||
          new Set(slots.map(slotKey)).size !== slots.length
        )
          throw invalidResponse();
        return slots;
      });
    },
    checkout(input) {
      return invoke(input.signal, async () => {
        supported("checkout");
        const request = decode(checkoutInput, input, true);
        const approved = snapshot(request.draft);
        const result = resultAttempt(
          await adapter.checkout({ ...request, signal: input.signal }),
          approved,
        );
        if (result.status !== "ready") throw invalidResponse();
        return result;
      });
    },
    pay(input) {
      return invoke(input.signal, async () => {
        supported("pay");
        const request = decode(payInput, input, true);
        const previous = structuredClone(request.attempt);
        const result = await adapter.pay({
          ...request,
          signal: input.signal,
          onReviewReady: input.onReviewReady,
          onCheckoutReady: input.onCheckoutReady,
        });
        if (request.holding && adapter.mode === "live") {
          const held = resultAttempt(result, previous.draft, previous.id);
          if (!(
            (held.status === "ready" && held.held) ||
            held.status === "checking" ||
            (request.startCheckout === true && held.status === "pending")
          ))
            throw invalidResponse();
          return held;
        }
        return transitioned("pay", previous, result);
      });
    },
    check(input) {
      return invoke(input.signal, async () => {
        supported("check");
        const request = decode(attemptInput, input, true);
        const previous = structuredClone(request.attempt);
        return transitioned(
          "check",
          previous,
          await adapter.check({ ...request, signal: input.signal }),
        );
      });
    },
    resolve(input) {
      return invoke(input.signal, async () => {
        supported("resolve");
        const request = decode(resolveInput, input, true);
        const previous = structuredClone(request.attempt);
        return transitioned(
          "resolve",
          previous,
          await adapter.resolve({ ...request, signal: input.signal }),
        );
      });
    },
  };
}

const unavailable = async (): Promise<never> => {
  throw new BookingServiceError(
    "unavailable",
    "Online booking is not available yet. Please contact the studio.",
  );
};
// No guessed live route and no demo import/fallback. Protected confirmation has
// its existing independent, cookie-authorized readConfirmation owner.
async function nativeRequest(
  path: string,
  method: "GET" | "POST",
  signal?: AbortSignal,
  body?: unknown,
) {
  const response = await fetch(path, {
    method,
    signal,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (
      response.status === 503 &&
      /^\/api\/booking\/(checkout|hold)\//.test(path)
    ) {
      const error = await response
        .clone()
        .json()
        .catch(() => null);
      if (error?.error === "checkout_not_started")
        throw new BookingServiceError(
          "checkout_not_started",
          "We couldn’t connect to the booking service. No booking or payment was started. Your details are saved; please try again shortly.",
        );
    }
    if (path.startsWith("/api/booking/hitpay/")) {
      const body = await response.json().catch(() => null);
      if (response.status === 409 && body?.error === "hitpay_hold_expired")
        throw new BookingServiceError(
          "reservation_expired",
          "Your reservation expired. Please choose a time again. Your contact details have been kept.",
        );
      throw new BookingServiceError(
        "payment_unavailable",
        "Payment checkout could not be verified. Your booking attempt has been kept. Do not start another booking or payment; contact the studio for help.",
      );
    }
    if (
      response.status === 409 &&
      (path === "/api/booking/prepare" || path.startsWith("/api/booking/hold/"))
    ) {
      const body = await response.json().catch(() => null);
      if (
        body?.error === "native_selection_changed" ||
        body?.error === "native_restart_required"
      )
        throw new BookingServiceError(
          "selection_changed",
          "Your selection is no longer available or has changed. Please choose again. Your details have been kept.",
        );
    }
    if (response.status === 409)
      throw new BookingServiceError(
        "conflict",
        "This selection has changed. Return to your booking and restart checkout.",
      );
    throw new BookingServiceError(
      "unavailable",
      "Online booking is unavailable. Your selections have been kept.",
    );
  }
  return response.json() as Promise<unknown>;
}
const nativeAttemptId = z.string().uuid();
export const liveBookingService: BookingService = defineBookingService({
  mode: "live",
  operations: {
    availability: "live",
    checkout: "live",
    pay: "live",
    check: "unavailable",
    resolve: "unavailable",
  },
  async restore(signal) {
    const current = nativeCurrentSchema.parse(
      await nativeRequest("/api/booking/current", "GET", signal),
    );
    if (current.state === "empty") return null;
    const slots = current.sessions.map((offer) => {
      const wall = new Date(offer.startMs + 8 * 3600000).toISOString();
      return {
        date: wall.slice(0, 10),
        start: wall.slice(11, 16),
        instructor: offer.instructorId,
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
    return {
      id: current.attemptId,
      status: ["prepared", "held"].includes(current.state)
        ? "ready"
        : "checking",
      ...(current.state === "held" ? { held: true as const } : {}),
      outcome: "pending",
      checkUntil: 0,
      booking: null,
      draft: {
        mode: "guest",
        accountEmail: "",
        nativeServiceId:
          slots[0].native.productServiceId ?? slots[0].native.serviceId,
        contact: current.contact,
        players: current.sessions[0].players,
        accepted: current.state !== "held",
        slots,
      },
    };
  },
  async publicCalendar({ month, signal }) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalidResponse();
    const response = await fetch(`/api/calendar/${month}`, {
      signal,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw invalidResponse();
    return decode(publicCalendarSchema, await response.json());
  },
  async calendar({ month, serviceId, signal }) {
    const value = nativeCalendarSchema.parse(
      await nativeRequest(
        `/api/booking/calendar/${serviceId}/${month}`,
        "GET",
        signal,
      ),
    );
    if (
      value.month !== month ||
      value.dates.some((day) =>
        day.offers.some(
          (o) =>
            (o.productServiceId ?? o.serviceId) !== serviceId ||
            new Date(o.startMs + 8 * 3600000).toISOString().slice(0, 10) !==
              day.date,
        ),
      )
    )
      throw invalidResponse();
    return {
      month,
      observedAtMs: value.observedAtMs,
      dates: value.dates.map((day) => ({
        date: day.date,
        available: day.offers.some((offer) => offer.startMs > Date.now()),
      })),
    };
  },
  async availability({ date, serviceId, signal, fresh }) {
    if (!serviceId) return unavailable();
    providerIdentifier.parse(serviceId);
    const data = nativeAvailabilitySchema.parse(
      await nativeRequest(
        `/api/booking/availability/${serviceId}/${date}${fresh ? "?refresh=1" : ""}`,
        "GET",
        signal,
      ),
    );
    if (
      data.date !== date ||
      data.observedAtMs > Date.now() ||
      Date.now() - data.observedAtMs >= CATALOGUE_MAX_AGE_MS
    )
      throw invalidResponse();
    if (
      data.offers.some(
        (offer) =>
          (offer.productServiceId ?? offer.serviceId) !== serviceId ||
          new Date(offer.startMs + 28800000).toISOString().slice(0, 10) !==
            date,
      )
    )
      throw invalidResponse();
    return nativeDisplaySlots(date, data.offers);
  },
  async checkout({ draft, previous, signal, holding }) {
    if (draft.slots.some((slot) => !slot.native)) return unavailable();
    if (
      previous ||
      (!draft.accepted && !holding) ||
      draft.slots.some(
        (slot) =>
          !slot.native ||
          (slot.native.productServiceId ?? slot.native.serviceId) !==
            draft.nativeServiceId,
      )
    )
      throw new BookingServiceError(
        "conflict",
        "Review your selection before starting checkout.",
      );
    const approved = snapshot(draft);
    const key = crypto.randomUUID();
    if (holding)
      return {
        id: key,
        status: "ready",
        draft: approved,
        outcome: "pending",
        checkUntil: 0,
        booking: null,
      };
    const request = nativePrepareSchema.parse({
      key,
      contact: approved.contact,
      accepted: approved.accepted,
      ...(holding ? { holding: true } : {}),
      sessions: approved.slots.map((slot) => ({
        serviceId: slot.native?.serviceId,
        instructorId: slot.instructor,
        startMs: Date.parse(`${slot.date}T${slot.start}:00+08:00`),
        players: approved.players,
        totalMinor: slot.native?.priceMinor,
      })),
    });
    const prepared = z
      .strictObject({
        attemptId: nativeAttemptId,
        state: z.literal("prepared"),
      })
      .parse(
        await nativeRequest("/api/booking/prepare", "POST", signal, request),
      );
    return {
      id: prepared.attemptId,
      status: "ready",
      draft: approved,
      outcome: "pending",
      checkUntil: 0,
      booking: null,
    };
  },
  async pay({
    attempt,
    signal,
    holding,
    onReviewReady,
    startCheckout,
    onCheckoutReady,
  }) {
    if (attempt.draft.slots.some((slot) => !slot.native)) return unavailable();
    nativeAttemptId.parse(attempt.id);
    if (
      attempt.status !== "ready" ||
      attempt.draft.slots.some((slot) => !slot.native)
    )
      throw invalidResponse();
    const progress = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      progress.abort();
    };
    signal?.addEventListener("abort", stop, { once: true });
    let checks = 0;
    const inspect = async () => {
      if (progress.signal.aborted || signal?.aborted) return;
      try {
        const status = z
          .object({ attemptId: nativeAttemptId, state: z.string() })
          .parse(
            await nativeRequest(
              `/api/booking/native/${attempt.id}`,
              "GET",
              progress.signal,
            ),
          );
        if (
          status.attemptId === attempt.id &&
          (status.state === "reviewing" || status.state === "verifying")
        ) {
          if (!progress.signal.aborted) onReviewReady?.();
          return;
        }
      } catch {
        /* Optional progress never changes the original write outcome. */
      }
      if (!progress.signal.aborted && ++checks < 30)
        timer = setTimeout(() => void inspect(), 1000);
    };
    if (holding && attempt.draft.slots.length === 1 && onReviewReady)
      timer = setTimeout(() => void inspect(), 1000);
    let raw: unknown;
    try {
      raw = await nativeRequest(
        attempt.held
          ? `/api/booking/hitpay/${attempt.id}`
          : holding
            ? `/api/booking/${startCheckout ? "checkout" : "hold"}/${attempt.id}`
            : `/api/booking/native/${attempt.id}`,
        "POST",
        signal,
        attempt.held
          ? { accepted: attempt.draft.accepted }
          : holding
            ? nativePrepareSchema.parse({
                key: attempt.id,
                contact: attempt.draft.contact,
                accepted: attempt.draft.accepted,
                holding: true,
                sessions: attempt.draft.slots.map((slot) => ({
                  serviceId: slot.native?.serviceId,
                  instructorId: slot.instructor,
                  startMs: Date.parse(`${slot.date}T${slot.start}:00+08:00`),
                  players: attempt.draft.players,
                  totalMinor: slot.native?.priceMinor,
                })),
              })
            : undefined,
      );
    } finally {
      stop();
      signal?.removeEventListener("abort", stop);
    }
    const result = decode(
      z.object({
        attemptId: nativeAttemptId,
        state: z.string(),
        paymentAvailable: z.boolean(),
        checkout: hitpayHandoffSchema.optional(),
        rejectedSessionIndex: z.number().int().min(0).max(11).optional(),
      }),
      raw,
    );
    if (result.attemptId !== attempt.id) throw invalidResponse();
    if (
      result.state === "restart_required" ||
      result.state === "selection_unavailable"
    ) {
      if (
        result.rejectedSessionIndex === undefined ||
        result.rejectedSessionIndex >= attempt.draft.slots.length
      )
        throw invalidResponse();
      throw new BookingServiceError(
        result.state === "selection_unavailable"
          ? "selection_unavailable"
          : "selection_changed",
        "This selection is no longer available or has changed. Please choose again. Your details have been kept.",
        result.rejectedSessionIndex,
      );
    }
    if (result.checkout) {
      if (
        !result.paymentAvailable ||
        result.state !== "associated" ||
        !(startCheckout || attempt.held) ||
        result.checkout.expiresAtMs <= Date.now()
      )
        throw invalidResponse();
      onCheckoutReady?.(result.checkout);
    }
    if (holding && !startCheckout && result.state === "associated")
      return { ...attempt, verifying: undefined, held: true, status: "ready" };
    // A response can never mark the browser paid. All ambiguous writes remain
    // under this attempt and the protected confirmation/recovery owner.
    return {
      ...attempt,
      verifying: undefined,
      status:
        startCheckout && result.state !== "associated" ? "pending" : "checking",
      outcome: "pending",
      booking: null,
    };
  },
  check: unavailable,
  resolve: unavailable,
});

// Separate live DTO boundary: no preview enum, price, timetable or identity cast.
// A deployed route is intentionally unavailable until its read authority is bound.
export function defineCatalogueService(
  binding: CatalogueBinding,
  adapter: CatalogueService,
): CatalogueService {
  const expected = catalogueBindingSchema.parse(binding);
  return {
    read(input) {
      return invoke(input.signal, async () => {
        const result = decode(catalogueSchema, await adapter.read(input));
        const now = Date.now();
        if (
          result.binding.accountId !== expected.accountId ||
          result.binding.environmentId !== expected.environmentId ||
          result.binding.companyLogin !== expected.companyLogin ||
          result.observedAtMs > now ||
          now - result.observedAtMs >= CATALOGUE_MAX_AGE_MS
        )
          throw invalidResponse();
        return result;
      });
    },
  };
}
export const liveCatalogueService: CatalogueService = { read: unavailable };
