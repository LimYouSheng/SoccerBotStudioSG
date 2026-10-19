import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookingProvider, useBooking } from "./provider";
import { BookingPage } from "./booking-page";
import { ReviewStep } from "./review-step";
import type { BookingService } from "@/services/contracts";
import { liveBookingService } from "@/services/booking";
import { blankDraft, type Attempt } from "@/domain/booking";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const id = "00000000-0000-4000-8000-000000000001";
const url = `https://checkout.sandbox.hit-pay.com/payment-request/@soccerbot/${id}/checkout`;
const draft = {
  ...blankDraft(),
  mode: "guest" as const,
  nativeServiceId: "2",
  accepted: true,
  contact: {
    name: "Test",
    email: "test@example.com",
    phone: "+65 8123 4567",
    contactMethod: "email",
    academy: "",
  },
  slots: [
    {
      date: "2026-10-20",
      start: "12:00",
      instructor: "4",
      native: {
        serviceId: "2",
        serviceName: "Session",
        instructorName: "Instructor",
        priceMinor: 8800,
        currency: "SGD" as const,
      },
    },
  ],
};
function Seed({ accepted = true }: { accepted?: boolean }) {
  const { update, attempt, action, cancel, checkout } = useBooking();
  return (
    <>
      <button onClick={() => update({ ...draft, accepted })}>Seed</button>
      <button onClick={cancel}>Cancel</button>
      <button onClick={() => void checkout()}>Repeat checkout</button>
      <output data-testid="retained">{attempt?.id}</output>
      <output data-testid="action">{action.status}</output>
    </>
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  navigation.push.mockReset();
  navigation.replace.mockReset();
});
async function directCase(scenario: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  let finish!: (attempt: Attempt) => void;
  const checkout = vi.fn<BookingService["checkout"]>(async ({ draft }) => ({
    id,
    draft,
    status: "ready" as const,
    outcome: "pending" as const,
    checkUntil: 0,
    booking: null,
  }));
  const pay = vi.fn<BookingService["pay"]>(
    () =>
      new Promise<Attempt>((resolve) => {
        finish = resolve;
      }),
  );
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        attemptId: id,
        mode: "live",
        checkout: {
          state: "available",
          url:
            scenario === "wrong_host"
              ? url.replace("hit-pay.com", "evil.test")
              : url,
          expiresAtMs: Date.now() + 60000,
        },
        summary: {
          players: 1,
          totalMinor: 8800,
          currency: "SGD",
          sessions: [{ startMs: 1, players: 1 }],
        },
        checking: {
          deadlineMs: Date.now() + 120000,
          nextCheckMs: 0,
          pollAfterMs: 5000,
        },
      }),
    ),
  );
  render(
    <BookingProvider
      bookingService={{
        ...liveBookingService,
        restore: undefined,
        checkout,
        pay,
      }}
    >
      <Seed />
      <ReviewStep />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByText("Seed"));
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" }),
    ),
  );
  expect(screen.getByTestId("retained")).toHaveTextContent(id);
  expect(pay).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Opening secure payment…" }),
  );
  expect(checkout).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
  if (scenario === "cancel") fireEvent.click(screen.getByText("Cancel"));
  await act(async () =>
    finish({ ...pay.mock.calls[0][0].attempt, status: "checking" }),
  );
  if (scenario === "success") {
    expect(assign).toHaveBeenCalledExactlyOnceWith(url);
    // assign() starts navigation; the current document can still paint while
    // the checkout destination loads. Never reveal the review form here.
    expect(screen.getByTestId("action")).toHaveTextContent("loading");
    expect(
      screen.getByRole("status", { name: "Opening secure payment…" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Opening secure payment… Please don’t close or refresh this page while we finish.",
      ),
    ).toBeVisible();
    await act(async () => fireEvent.click(screen.getByText("Repeat checkout")));
    expect(pay).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Opening secure payment…" }),
    ).toBeDisabled();
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
    expect(screen.getByTestId("action")).toHaveTextContent("loading");
    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    expect(screen.getByTestId("action")).toHaveTextContent("cancelled");
    expect(screen.getByTestId("retained")).toHaveTextContent(id);
    expect(pay).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
  } else expect(assign).not.toHaveBeenCalled();
  expect(navigation.push).not.toHaveBeenCalled();
  expect(screen.getByTestId("retained")).toHaveTextContent(id);
}

it("direct checkout opens HitPay once in the same tab", () =>
  directCase("success"));
it("cancelled direct checkout never navigates", () => directCase("cancel"));
it("direct checkout rejects an untrusted destination", () =>
  directCase("wrong_host"));
it("holds once before review and starts payment without preparing or checking availability again", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  const checkout = vi.fn<BookingService["checkout"]>(
    async ({ draft, holding }) => {
      expect(holding).toBe(true);
      expect(draft.accepted).toBe(false);
      return {
        id,
        draft,
        status: "ready",
        outcome: "pending",
        checkUntil: 0,
        booking: null,
      };
    },
  );
  const pay = vi.fn<BookingService["pay"]>(async ({ attempt, holding }) =>
    holding
      ? { ...attempt, held: true, status: "ready" }
      : { ...attempt, status: "checking" },
  );
  const availability = vi.fn<BookingService["availability"]>(async () => []);
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        attemptId: id,
        mode: "live",
        checkout: { state: "available", url, expiresAtMs: Date.now() + 60000 },
        summary: {
          players: 1,
          totalMinor: 8800,
          currency: "SGD",
          sessions: [{ startMs: 1, players: 1 }],
        },
        checking: {
          deadlineMs: Date.now() + 120000,
          nextCheckMs: 0,
          pollAfterMs: 5000,
        },
      }),
    ),
  );
  function Hold() {
    const { update, reserve, attempt } = useBooking();
    return (
      <>
        <button onClick={() => update({ ...draft, accepted: false })}>
          Fill details
        </button>
        <button onClick={() => void reserve()}>Reserve for review</button>
        <output data-testid="hold-state">
          {attempt?.held ? "held" : "none"}
        </output>
      </>
    );
  }
  render(
    <BookingProvider
      bookingService={{
        ...liveBookingService,
        restore: undefined,
        checkout,
        pay,
        availability,
      }}
    >
      <Hold />
      <BookingPage step="review" />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByText("Fill details"));
  await act(async () =>
    fireEvent.click(screen.getByText("Reserve for review")),
  );
  expect(screen.getByTestId("hold-state")).toHaveTextContent("held");
  expect(assign).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("link", { name: "Edit selections" }),
  ).not.toBeInTheDocument();
  const readsAtHold = availability.mock.calls.length;
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" }),
    ),
  );
  expect(checkout).toHaveBeenCalledTimes(1);
  expect(pay).toHaveBeenCalledTimes(2);
  expect(pay.mock.calls[1][0].attempt.id).toBe(id);
  expect(pay.mock.calls[1][0].attempt.draft.accepted).toBe(true);
  expect(pay.mock.calls[1][0].holding).toBe(false);
  expect(availability).toHaveBeenCalledTimes(readsAtHold);
  expect(assign).toHaveBeenCalledWith(url);
  expect(navigation.replace).not.toHaveBeenCalledWith("/book/payment/");
  await act(async () =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  expect(navigation.replace).toHaveBeenCalledWith("/book/payment/");
  expect(checkout).toHaveBeenCalledTimes(1);
  expect(pay).toHaveBeenCalledTimes(2);
  expect(availability).toHaveBeenCalledTimes(readsAtHold);
});

it("live reservation response distinguishes a rejected selection from an uncertain write", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  const attempt: Attempt = {
    id,
    draft,
    status: "ready",
    outcome: "pending",
    checkUntil: 0,
    booking: null,
  };
  const response = vi.fn(async () =>
    Response.json({
      attemptId: id,
      state: "selection_unavailable",
      paymentAvailable: false,
      rejectedSessionIndex: 0,
    }),
  );
  vi.stubGlobal("fetch", response);
  await expect(
    liveBookingService.pay({ attempt, outcome: "pending", holding: true }),
  ).rejects.toMatchObject({
    code: "selection_unavailable",
    rejectedSessionIndex: 0,
  });
  response.mockImplementation(async () =>
    Response.json({
      attemptId: id,
      state: "recovery_required",
      paymentAvailable: false,
    }),
  );
  await expect(
    liveBookingService.pay({ attempt, outcome: "pending", holding: true }),
  ).resolves.toMatchObject({ id, status: "checking" });
  response.mockImplementation(async () =>
    Response.json({
      attemptId: id,
      state: "selection_unavailable",
      paymentAvailable: false,
      rejectedSessionIndex: 9,
    }),
  );
  await expect(
    liveBookingService.pay({ attempt, outcome: "pending", holding: true }),
  ).rejects.toMatchObject({ code: "invalid_response" });
  expect(response).toHaveBeenCalledTimes(3);
});

it("HitPay HTTP conflict preserves the hold and shows payment failure without selection recovery", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      if (path === `/api/booking/hold/${id}`)
        return Response.json({
          attemptId: id,
          state: "associated",
          paymentAvailable: false,
        });
      if (path === `/api/booking/hitpay/${id}`)
        return Response.json(
          { error: "hitpay_association_mismatch" },
          { status: 409 },
        );
      throw new Error("Unexpected test request: " + path);
    }),
  );
  function Hold() {
    const { update, reserve, attempt } = useBooking();
    return (
      <>
        <button
          onClick={() =>
            update({ ...draft, nativeServiceId: "2", accepted: false })
          }
        >
          Fill details
        </button>
        <button onClick={() => void reserve()}>Reserve</button>
        <output data-testid="hold">
          {attempt?.id}:{String(attempt?.held)}
        </output>
      </>
    );
  }
  render(
    <BookingProvider
      bookingService={{
        ...liveBookingService,
        restore: undefined,
        publicCalendar: undefined,
        calendar: undefined,
      }}
    >
      <Hold />
      <BookingPage step="details" />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByText("Fill details"));
  await act(async () => fireEvent.click(screen.getByText("Reserve")));
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" }),
    ),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Payment checkout could not be verified",
  );
  expect(screen.getByTestId("hold")).toHaveTextContent(id + ":true");
  expect(
    screen.queryByRole("link", { name: "Review selections" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/This selection has changed/),
  ).not.toBeInTheDocument();
  expect(calls).toEqual([
    `/api/booking/hold/${id}`,
    `/api/booking/hitpay/${id}`,
  ]);
  expect(navigation.push).not.toHaveBeenCalled();
});

it("Review performs no provider reads and checkout verifies one booking before HitPay", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  let complete!: (attempt: Attempt) => void;
  let created!: Attempt;
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        attemptId: id,
        mode: "live",
        checkout: { state: "available", url, expiresAtMs: Date.now() + 60000 },
        summary: {
          players: 1,
          totalMinor: 8800,
          currency: "SGD",
          sessions: [{ startMs: 1, players: 1 }],
        },
        checking: {
          deadlineMs: Date.now() + 120000,
          nextCheckMs: 0,
          pollAfterMs: 5000,
        },
      }),
    ),
  );
  const availability = vi.fn(async () =>
    draft.slots.map((slot) => ({ ...slot, available: true })),
  );
  const pay = vi.fn<BookingService["pay"]>(({ attempt, holding }) => {
    if (!holding) return Promise.resolve({ ...attempt, status: "checking" });
    created = attempt;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const checkout = vi.fn<BookingService["checkout"]>(async ({ draft }) => ({
    id,
    draft,
    status: "ready",
    outcome: "pending",
    checkUntil: 0,
    booking: null,
  }));
  function Journey() {
    const [step, setStep] = useState<"details" | "review">("details");
    navigation.push.mockImplementation(() => setStep("review"));
    return <BookingPage step={step} />;
  }
  render(
    <BookingProvider
      bookingService={{
        ...liveBookingService,
        restore: undefined,
        checkout,
        pay,
        availability,
      }}
    >
      <Seed accepted={false} />
      <Journey />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByText("Seed"));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Review booking" })),
  );
  expect(screen.getByRole("heading", { name: "Review booking" })).toBeVisible();
  expect(availability).not.toHaveBeenCalled();
  expect(checkout).not.toHaveBeenCalled();
  expect(pay).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "Edit details" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Edit selections" })).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" }),
    ),
  );
  expect(checkout).toHaveBeenCalledTimes(1);
  expect(pay).toHaveBeenCalledTimes(1);
  expect(pay.mock.calls[0][0].holding).toBe(true);
  expect(assign).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Opening secure payment…" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByText("Repeat checkout"));
  expect(pay).toHaveBeenCalledTimes(1);
  await act(async () => complete({ ...created, status: "checking" }));
  expect(pay).toHaveBeenCalledTimes(1);
  expect(pay.mock.calls[0][0].startCheckout).toBe(true);
  expect(pay.mock.calls[0][0].attempt.draft.accepted).toBe(true);
  expect(checkout).toHaveBeenCalledTimes(1);
  expect(assign).toHaveBeenCalledExactlyOnceWith(url);
});

it("lost hold response restores only the same verified attempt without repeating the write", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  const attempt: Attempt = {
    id,
    draft,
    status: "ready",
    outcome: "pending",
    checkUntil: 0,
    booking: null,
  };
  let restoreResult: Attempt | null = null;
  const restore = vi.fn(async () => restoreResult);
  const pay = vi.fn<BookingService["pay"]>(async ({ onReviewReady }) => {
    onReviewReady?.();
    throw new TypeError("Failed to fetch");
  });
  function Reserve() {
    const { reserve, ready, attempt } = useBooking();
    return (
      <>
        <button disabled={!ready} onClick={() => void reserve()}>
          Reserve test
        </button>
        <output data-testid="restored-state">
          {attempt?.id}:{String(attempt?.held)}:{attempt?.status}
        </output>
      </>
    );
  }
  const view = render(
    <BookingProvider
      bookingService={{
        ...liveBookingService,
        restore,
        pay,
        checkout: async () => attempt,
        publicCalendar: undefined,
        calendar: undefined,
        availability: async () => [],
      }}
    >
      <Seed />
      <Reserve />
    </BookingProvider>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByText("Seed"));
  restoreResult = { ...attempt, held: true };
  await act(async () => fireEvent.click(screen.getByText("Reserve test")));
  expect(screen.getByTestId("restored-state")).toHaveTextContent(
    `${id}:true:ready`,
  );
  expect(pay).toHaveBeenCalledTimes(1);
  expect(restore).toHaveBeenCalledTimes(1); // one protected recovery read
  view.unmount();
});

it("lost hold response cannot adopt a different attempt returned by recovery", async () => {
  const attempt: Attempt = {
    id,
    draft,
    status: "ready",
    outcome: "pending",
    checkUntil: 0,
    booking: null,
  };
  const restore = vi
    .fn<NonNullable<BookingService["restore"]>>()
    .mockResolvedValue({
      ...attempt,
      id: "00000000-0000-4000-8000-000000000002",
      held: true,
    });
  const pay = vi.fn<BookingService["pay"]>(async ({ onReviewReady }) => {
    onReviewReady?.();
    throw new TypeError("Failed to fetch");
  });
  function Reserve() {
    const { reserve, ready, attempt } = useBooking();
    return (
      <>
        <button disabled={!ready} onClick={() => void reserve()}>
          Reserve test
        </button>
        <output data-testid="restored-state">
          {attempt?.id}:{String(attempt?.held)}:{attempt?.status}
        </output>
      </>
    );
  }
  render(
    <BookingProvider
      bookingService={{
        ...liveBookingService,
        restore,
        pay,
        checkout: async () => attempt,
        publicCalendar: undefined,
        calendar: undefined,
        availability: async () => [],
      }}
    >
      <Seed />
      <Reserve />
    </BookingProvider>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByText("Seed"));
  await act(async () => fireEvent.click(screen.getByText("Reserve test")));
  expect(screen.getByTestId("restored-state")).toHaveTextContent(
    `${id}:undefined:checking`,
  );
  expect(pay).toHaveBeenCalledTimes(1);
  expect(restore).toHaveBeenCalledTimes(1);
});

it("expired Review releases only an authoritatively unpaid attempt and preserves contact on calendar return", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
  let uncertain = true;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      if (path === `/api/booking/hold/${id}`)
        return Response.json({
          attemptId: id,
          state: "associated",
          paymentAvailable: false,
        });
      if (path === `/api/booking/hitpay/${id}`)
        return Response.json({ error: "hitpay_hold_expired" }, { status: 409 });
      if (path === `/api/attempts/${id}/expire`)
        return uncertain
          ? Response.json(
              { error: "checkout_expiry_unresolved" },
              { status: 409 },
            )
          : Response.json({ expired: true });
      throw new Error("Unexpected request " + path);
    }),
  );
  function State() {
    const { update, reserve, attempt, draft: current } = useBooking();
    return (
      <>
        <button
          onClick={() =>
            update({ ...draft, nativeServiceId: "2", accepted: false })
          }
        >
          Fill details
        </button>
        <button onClick={() => void reserve()}>Reserve</button>
        <output data-testid="attempt">
          {attempt?.id ?? "none"}:{current.contact.email}:{current.slots.length}
        </output>
      </>
    );
  }
  render(
    <BookingProvider
      bookingService={{
        ...liveBookingService,
        restore: undefined,
        publicCalendar: undefined,
        calendar: undefined,
      }}
    >
      <State />
      <BookingPage step="details" />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByText("Fill details"));
  await act(async () => fireEvent.click(screen.getByText("Reserve")));
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" }),
    ),
  );
  expect(screen.getByTestId("attempt")).toHaveTextContent(id);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your original booking has been kept",
  );
  uncertain = false;
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" }),
    ),
  );
  expect(screen.getByTestId("attempt")).toHaveTextContent(
    `none:${draft.contact.email}:0`,
  );
  expect(navigation.replace).toHaveBeenCalledWith("/book/time/");
  expect(
    calls.filter((path) => path.startsWith("/api/booking/hold/")),
  ).toHaveLength(1);
  expect(calls.filter((path) => path.endsWith("/expire"))).toHaveLength(2);
});
