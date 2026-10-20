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
    slots: [demoSession({ date: "2026-10-13", start: "12:00" })!],
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

test("native availability carries provider identities labels and reviewed prices without Preview fallback", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      date: "2026-10-15",
      observedAtMs: Date.now(),
      offers: [
        {
          serviceId: "2",
          serviceName: "Current Native Session",
          instructorId: "33",
          instructorName: "Current Native Instructor",
          startMs: Date.parse("2026-10-15T08:10:00+08:00"),
          priceMinor: 9900,
          currency: "SGD",
        },
      ],
    }),
  );
  const result = await liveBookingService.availability({
    date: "2026-10-15",
    players: 4,
    serviceId: "2",
  });
  expect(result).toEqual([
    {
      date: "2026-10-15",
      start: "08:10",
      instructor: "33",
      available: true,
      native: {
        serviceId: "2",
        serviceName: "Current Native Session",
        instructorName: "Current Native Instructor",
        priceMinor: 9900,
        currency: "SGD",
      },
    },
  ]);
  expect(fetch).toHaveBeenCalledWith(
    "/api/booking/availability/2/2026-10-15",
    expect.objectContaining({ credentials: "same-origin", redirect: "error" }),
  );
});

test("native preparation binds reviewed contact and payment stays under protected confirmation", async () => {
  const data = {
    ...draft(),
    nativeServiceId: "2",
    slots: [
      {
        date: "2026-10-15",
        start: "08:10",
        instructor: "33",
        native: {
          serviceId: "2",
          serviceName: "Current Native Session",
          instructorName: "Current Native Instructor",
          priceMinor: 8800,
          currency: "SGD" as const,
        },
      },
    ],
  };
  const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ attemptId: id, state: "prepared" }))
    .mockResolvedValueOnce(
      Response.json({
        attemptId: id,
        state: "associated",
        paymentAvailable: true,
      }),
    );
  const ready = await liveBookingService.checkout({
    draft: data,
    previous: null,
  });
  const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(sent.contact).toEqual(data.contact);
  expect(sent.sessions[0]).toEqual({
    serviceId: "2",
    instructorId: "33",
    startMs: Date.parse("2026-10-15T08:10:00+08:00"),
    players: 1,
    totalMinor: 8800,
  });
  const checking = await liveBookingService.pay({
    attempt: ready,
    outcome: "success",
  });
  expect(checking.status).toBe("checking");
  expect(checking.booking).toBeNull();
  expect(fetch.mock.calls[1][1]?.body).toBeUndefined();
  expect(checking.id).toBe(id);
});

test("native restore reads the authenticated snapshot and cannot manufacture a paid browser receipt", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      state: "checking",
      attemptId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      contact: draft().contact,
      sessions: [
        {
          serviceId: "3",
          productServiceId: "2",
          serviceName: "Native",
          instructorId: "33",
          instructorName: "Trainer",
          startMs: Date.parse("2026-10-17T08:10:00+08:00"),
          players: 4,
          priceMinor: 10800,
          currency: "SGD",
        },
      ],
    }),
  );
  const restored = await liveBookingService.restore!(
    new AbortController().signal,
  );
  expect(restored?.status).toBe("checking");
  expect(restored?.booking).toBeNull();
  expect(restored?.draft.players).toBe(4);
  expect(restored?.draft.nativeServiceId).toBe("2");
  expect(restored?.draft.slots[0].native).toMatchObject({
    serviceId: "3",
    productServiceId: "2",
    priceMinor: 10800,
  });
  expect(restored?.draft.slots[0].instructor).toBe("33");
});

test("single holding request retains its local identity before dispatch and never makes a separate preparation request", async () => {
  const data = {
    ...draft(),
    accepted: false,
    nativeServiceId: "2",
    slots: [
      {
        date: "2026-10-15",
        start: "12:00",
        instructor: "14",
        native: {
          serviceId: "2",
          serviceName: "Native Session",
          instructorName: "Native Trainer",
          priceMinor: 8800,
          currency: "SGD" as const,
        },
      },
    ],
  };
  const response = deferred<Response>();
  const fetch = vi.spyOn(globalThis, "fetch").mockReturnValue(response.promise);
  const pending = await liveBookingService.checkout({
    draft: data,
    previous: null,
    holding: true,
  });
  expect(pending.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(fetch).not.toHaveBeenCalled();
  const holding = liveBookingService.pay({
    attempt: pending,
    holding: true,
    outcome: "pending",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(`/api/booking/hold/${pending.id}`);
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
    key: pending.id,
    holding: true,
    accepted: false,
    contact: data.contact,
  });
  response.resolve(
    Response.json({
      attemptId: pending.id,
      state: "associated",
      paymentAvailable: false,
    }),
  );
  expect(await holding).toMatchObject({
    id: pending.id,
    held: true,
    status: "ready",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("holding progress only accepts the matching server milestone and stops without replaying the write", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
  const data = {
    ...draft(),
    nativeServiceId: "2",
    slots: [
      {
        date: "2026-10-15",
        start: "12:00",
        instructor: "14",
        native: {
          serviceId: "2",
          serviceName: "Session",
          instructorName: "Trainer",
          priceMinor: 8800,
          currency: "SGD" as const,
        },
      },
    ],
  };
  const attempt = await liveBookingService.checkout({
    draft: data,
    previous: null,
    holding: true,
  });
  const completion = deferred<Response>();
  let matching = false;
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_url, init) => {
      if (init?.method === "POST") return completion.promise;
      return Response.json({
        attemptId: matching
          ? attempt.id
          : "00000000-0000-4000-8000-000000000099",
        state: "reviewing",
      });
    });
  const progress = vi.fn();
  const holding = liveBookingService.pay({
    attempt,
    holding: true,
    outcome: "pending",
    onReviewReady: progress,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(progress).not.toHaveBeenCalled();
  matching = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(progress).toHaveBeenCalledTimes(1);
  completion.resolve(
    Response.json({
      attemptId: attempt.id,
      state: "recovery_required",
      paymentAvailable: false,
    }),
  );
  expect(await holding).toMatchObject({ id: attempt.id, status: "checking" });
  const count = fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetch).toHaveBeenCalledTimes(count);
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});

test("queue busy returns clear retained-attempt feedback without an automatic retry", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ error: "provider_queue_busy" }, { status: 503 }),
    );
  await expect(
    liveBookingService.availability({
      date: "2026-10-15",
      players: 1,
      serviceId: "2",
    }),
  ).rejects.toMatchObject({
    code: "queue_busy",
    message:
      "The booking service is busy. Your details and existing attempt are saved. Please wait a moment before trying again.",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
