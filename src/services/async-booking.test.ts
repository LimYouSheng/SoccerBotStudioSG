import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { blankDraft, type Attempt } from "@/domain/booking";
import { defineBookingService, liveBookingService } from "./booking";
import { demoBookingService, demoBookingModel } from "./demo/booking";
import { demoSession } from "./demo/schedule";
import type { AvailableSlot } from "./contracts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function draft() {
  return {
    ...blankDraft(),
    mode: "guest" as const,
    accepted: true,
    slots: [demoSession({ date: "2026-10-13", start: "09:00" })!],
    contact: {
      name: "Demo Customer",
      email: "demo@example.com",
      phone: "+65 8123 4567",
      contactMethod: "email",
      academy: "",
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T01:00:00+08:00"));
  const data = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("named async demo contract completes checkout payment and one repeated receipt without provider traffic", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const input = draft();
  const ready = await demoBookingService.checkout({
    draft: input,
    previous: null,
  });
  const repeated = await demoBookingService.checkout({
    draft: input,
    previous: ready,
  });
  expect(repeated.id).toBe(ready.id);
  const checking = await demoBookingService.pay({
    attempt: ready,
    outcome: "success",
  });
  const paid = await demoBookingService.resolve({
    attempt: checking,
    now: checking.checkUntil,
  });
  expect(paid.status).toBe("paid");
  expect(
    await demoBookingService.resolve({
      attempt: checking,
      now: checking.checkUntil,
    }),
  ).toEqual(paid);
  expect(paid.booking?.totalCents).toBe(8800);
  expect(fetch).not.toHaveBeenCalled();
});
test("async availability waits for a delayed response and validates the requested date", async () => {
  const pending = deferred<AvailableSlot[]>();
  const service = defineBookingService({
    ...demoBookingService,
    availability: () => pending.promise,
  });
  let done = false;
  const response = service
    .availability({ date: "2026-10-13", players: 1 })
    .then((value) => {
      done = true;
      return value;
    });
  await Promise.resolve();
  expect(done).toBe(false);
  const slots = demoBookingModel.availability("2026-10-13");
  pending.resolve(slots);
  expect(await response).toEqual(slots);
});
test("invalid inputs are rejected before the adapter and malformed foreign-date duplicate replies are refused", async () => {
  const call = vi.fn(async () => demoBookingModel.availability("2026-10-13"));
  const service = defineBookingService({
    ...demoBookingService,
    availability: call,
  });
  await expect(
    service.availability({ date: "bad", players: 1 }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  await expect(
    service.availability({ date: "2026-10-13", players: 5 }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(call).not.toHaveBeenCalled();
  call.mockResolvedValueOnce([{ available: true } as AvailableSlot]);
  await expect(
    service.availability({ date: "2026-10-13", players: 1 }),
  ).rejects.toMatchObject({ code: "invalid_response" });
  await expect(
    service.availability({ date: "2026-10-14", players: 1 }),
  ).rejects.toMatchObject({ code: "invalid_response" });
  const slot = demoBookingModel.availability("2026-10-13")[0];
  call.mockResolvedValueOnce([slot, slot]);
  await expect(
    service.availability({ date: "2026-10-13", players: 1 }),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
test("transport rejection is a stable safe error without leaking raw response details", async () => {
  const service = defineBookingService({
    ...demoBookingService,
    async availability() {
      throw new Error("SYNTHETIC_SECRET_MARKER");
    },
  });
  await expect(
    service.availability({ date: "2026-10-13", players: 1 }),
  ).rejects.toMatchObject({
    code: "temporarily_unavailable",
    message: "We couldn’t complete that request. Please try again.",
  });
});
test("cancellation ends a non-cooperative read and late rejection stays handled", async () => {
  const pending = deferred<AvailableSlot[]>();
  const controller = new AbortController();
  const call = vi.fn(() => pending.promise);
  const service = defineBookingService({
    ...demoBookingService,
    availability: call,
  });
  const result = service.availability({
    date: "2026-10-13",
    players: 1,
    signal: controller.signal,
  });
  controller.abort();
  await expect(result).rejects.toMatchObject({ code: "cancelled" });
  pending.reject(new Error("late"));
  await Promise.resolve();
  await expect(
    service.availability({
      date: "2026-10-13",
      players: 1,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(call).toHaveBeenCalledTimes(1);
});
test("attempt responses cannot change identity approved draft or paid association", async () => {
  const ready = demoBookingModel.checkout(draft(), null);
  const call = vi.fn(async () => ({ ...ready, id: "other" }));
  const service = defineBookingService({ ...demoBookingService, pay: call });
  await expect(
    service.pay({ attempt: ready, outcome: "success" }),
  ).rejects.toMatchObject({ code: "invalid_response" });
  call.mockResolvedValueOnce({
    ...ready,
    draft: { ...ready.draft, players: 2 },
  });
  await expect(
    service.pay({ attempt: ready, outcome: "success" }),
  ).rejects.toMatchObject({ code: "invalid_response" });
  const forged = { ...ready, status: "paid", booking: null } as Attempt;
  call.mockResolvedValueOnce(forged);
  await expect(
    service.pay({ attempt: ready, outcome: "success" }),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
test("all live booking operations remain unavailable and never call demo or transport", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const demo = vi.spyOn(demoBookingModel, "checkout");
  const ready = {
    id: "synthetic",
    status: "ready",
    draft: draft(),
    outcome: "success",
    booking: null,
    checkUntil: 0,
  } as Attempt;
  for (const result of [
    liveBookingService.availability({ date: "2026-10-13", players: 1 }),
    liveBookingService.checkout({ draft: draft(), previous: null }),
    liveBookingService.pay({ attempt: ready, outcome: "success" }),
    liveBookingService.check({ attempt: ready }),
    liveBookingService.resolve({ attempt: ready }),
  ])
    await expect(result).rejects.toMatchObject({ code: "unavailable" });
  expect(demo).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  const accidentalFallback = defineBookingService({
    ...demoBookingService,
    mode: "live",
  });
  await expect(
    accidentalFallback.checkout({ draft: draft(), previous: null }),
  ).rejects.toMatchObject({ code: "unavailable" });
  expect(demo).not.toHaveBeenCalled();
});

test("a malformed payment transition cannot bypass checking into paid confirmation", async () => {
  const ready = demoBookingModel.checkout(draft(), null);
  const checking = demoBookingModel.pay(ready, "success");
  const paid = demoBookingModel.resolve(checking, checking.checkUntil);
  const service = defineBookingService({
    ...demoBookingService,
    async pay() {
      return paid;
    },
  });
  await expect(
    service.pay({ attempt: ready, outcome: "success" }),
  ).rejects.toMatchObject({ code: "invalid_response" });
});

test("an adapter cannot mutate the validated input to approve a different draft", async () => {
  const input = draft();
  const service = defineBookingService({
    ...demoBookingService,
    async checkout({ draft: request }) {
      request.players = 2;
      return demoBookingModel.checkout(request, null);
    },
  });
  await expect(
    service.checkout({ draft: input, previous: null }),
  ).rejects.toMatchObject({ code: "invalid_response" });
  expect(input.players).toBe(1);
});
