import {
  CATALOGUE_MAX_AGE_MS,
  catalogueSchema,
  catalogueBindingSchema,
  type CatalogueBinding,
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

const availabilityInput = z.object({
  date: z.string().refine(isDate),
  players: z.number().int().min(1).max(MAX_PLAYERS),
});
const checkoutInput = z.object({
  draft: draftSchema,
  previous: attemptSchema.nullable(),
});
const attemptInput = z.object({ attempt: attemptSchema });
const payInput = attemptInput.extend({ outcome: outcomeSchema });
const resolveInput = attemptInput.extend({
  now: z.number().finite().nonnegative().optional(),
});
const slotsSchema = z
  .array(sessionSchema.extend({ available: z.boolean() }))
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
    if (adapter.mode !== "demo" || adapter.operations[operation] !== "demo")
      throw new BookingServiceError(
        "unavailable",
        "Online booking is not available yet. Please contact the studio.",
      );
  }
  return {
    mode: adapter.mode,
    operations: adapter.operations,
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
              !SESSION_STARTS.includes(clockMinutes(slot.start)),
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
        return transitioned(
          "pay",
          previous,
          await adapter.pay({ ...request, signal: input.signal }),
        );
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
export const liveBookingService: BookingService = defineBookingService({
  mode: "live",
  operations: {
    availability: "unavailable",
    checkout: "unavailable",
    pay: "unavailable",
    check: "unavailable",
    resolve: "unavailable",
  },
  availability: unavailable,
  checkout: unavailable,
  pay: unavailable,
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
