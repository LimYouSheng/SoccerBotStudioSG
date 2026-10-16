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
function Seed() {
  const { update, attempt, action, cancel } = useBooking();
  return (
    <>
      <button onClick={() => update(draft)}>Seed</button>
      <button onClick={cancel}>Cancel</button>
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
    screen.getByRole("button", { name: "Checking your booking…" }),
  );
  expect(checkout).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
  if (scenario === "cancel") fireEvent.click(screen.getByText("Cancel"));
  await act(async () =>
    finish({ ...pay.mock.calls[0][0].attempt, status: "checking" }),
  );
  if (scenario === "success")
    expect(assign).toHaveBeenCalledExactlyOnceWith(url);
  else expect(assign).not.toHaveBeenCalled();
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
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      if (path === "/api/booking/prepare")
        return Response.json(
          { attemptId: id, state: "prepared" },
          { status: 201 },
        );
      if (path === `/api/booking/native/${id}?hold=1`)
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
      <ReviewStep />
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
    "/api/booking/prepare",
    `/api/booking/native/${id}?hold=1`,
    `/api/booking/hitpay/${id}`,
  ]);
  expect(navigation.push).not.toHaveBeenCalled();
});
