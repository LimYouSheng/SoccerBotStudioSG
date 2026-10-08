import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { blankDraft, type Attempt, type BookingDraft } from "@/domain/booking";
import { dateLabel } from "@/domain/dates";
import { demoBookingModel, demoBookingService } from "@/services/demo/booking";
import { demoSession } from "@/services/demo/schedule";
import { demoIdentityService, DEMO_CODE } from "@/services/demo/identity";
import { liveBookingService } from "@/services/booking";
import type { AvailableSlot, BookingService } from "@/services/contracts";
import { loadBooking, saveBooking } from "@/services/storage";
import { BookingProvider, useBooking } from "./provider";
import { TimeStep } from "./time-step";
import { Summary } from "./summary";
import { ReviewStep } from "./review-step";
import { PaymentStep } from "./payment-step";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const date = "2026-10-13";
function draft(): BookingDraft {
  return {
    ...blankDraft(),
    mode: "guest",
    accepted: true,
    slots: [demoSession({ date, start: "09:00" })!],
    contact: {
      name: "Demo Customer",
      email: "demo@example.com",
      phone: "+65 8123 4567",
      contactMethod: "email",
      academy: "",
    },
  };
}
function Calendar() {
  const { ready } = useBooking();
  return ready ? <TimeStep /> : null;
}
function Probe() {
  const state = useBooking();
  return (
    <>
      <output data-testid="action">{state.action.status}</output>
      <output data-testid="attempt">{state.attempt?.id ?? "none"}</output>
      <output data-testid="status">{state.attempt?.status ?? "none"}</output>
      <button
        onClick={() => {
          state.update({ players: 2 });
        }}
      >
        Change players
      </button>
      <button
        onClick={() => {
          state.update({ mode: "guest", accountEmail: "changed@example.com" });
        }}
      >
        Change session
      </button>
      <button
        onClick={() => {
          void state.checkout();
          void state.checkout();
        }}
      >
        Double checkout
      </button>
      <button onClick={state.cancel}>Cancel request</button>
      <button
        onClick={() =>
          state.update({
            contact: { ...state.draft.contact, name: "Retained name" },
          })
        }
      >
        Edit name
      </button>
    </>
  );
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T01:00:00+08:00"));
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  saveBooking({ version: 2, draft: draft(), attempt: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("calendar and basket share delayed availability once and preserve selection through loading success", async () => {
  const response = deferred<AvailableSlot[]>();
  const availability = vi.fn<BookingService["availability"]>(
    () => response.promise,
  );
  const service = { ...demoBookingService, availability };
  const view = render(
    <BookingProvider bookingService={service}>
      <Calendar />
      <Summary basket />
      <Probe />
    </BookingProvider>,
  );
  expect(screen.getByText("Checking available times…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(loadBooking().draft.slots).toHaveLength(1);
  expect(availability).toHaveBeenCalledTimes(1);
  await act(async () => {
    response.resolve(demoBookingModel.availability(date));
  });
  expect(screen.getByRole("button", { name: /09:00–09:40/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("link", { name: "Continue" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
  view.rerender(
    <BookingProvider bookingService={service}>
      <Calendar />
      <Summary basket />
      <Probe />
    </BookingProvider>,
  );
  expect(availability).toHaveBeenCalledTimes(1);
  expect(loadBooking().draft.contact.name).toBe("Retained name");
});
test("availability failure is not no slots and an explicit retry retains the basket", async () => {
  const first = deferred<AvailableSlot[]>();
  const second = deferred<AvailableSlot[]>();
  const availability = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(
    <BookingProvider bookingService={{ ...demoBookingService, availability }}>
      <Calendar />
      <Summary basket />
    </BookingProvider>,
  );
  await act(async () => {
    first.reject(new Error("synthetic private transport detail"));
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "We couldn’t complete that request",
  );
  expect(screen.queryByText("No times on this day.")).not.toBeInTheDocument();
  expect(screen.queryByText(/synthetic private/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("Checking available times…")).toBeVisible();
  await act(async () => {
    second.resolve(demoBookingModel.availability(date));
  });
  expect(screen.getByRole("link", { name: "Continue" })).toBeVisible();
  expect(loadBooking().draft.slots).toHaveLength(1);
  expect(availability).toHaveBeenCalledTimes(2);
});
test("malformed availability is displayed as failure while valid empty availability is an empty day", async () => {
  saveBooking({ version: 2, draft: { ...draft(), slots: [] }, attempt: null });
  const result = deferred<AvailableSlot[]>();
  const availability = vi
    .fn()
    .mockReturnValueOnce(result.promise)
    .mockResolvedValueOnce([]);
  render(
    <BookingProvider bookingService={{ ...demoBookingService, availability }}>
      <Calendar />
    </BookingProvider>,
  );
  await act(async () => {
    result.resolve([{ available: true } as AvailableSlot]);
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "couldn’t check this information",
  );
  expect(screen.queryByText("No times on this day.")).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  });
  expect(screen.getByText("No times on this day.")).toBeVisible();
});
test("reordered dates and player revisions discard old replies even when the adapter ignores abort", async () => {
  saveBooking({ version: 2, draft: { ...draft(), slots: [] }, attempt: null });
  const old = deferred<AvailableSlot[]>();
  const current = deferred<AvailableSlot[]>();
  const changed = deferred<AvailableSlot[]>();
  const availability = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise)
    .mockReturnValueOnce(changed.promise);
  render(
    <BookingProvider bookingService={{ ...demoBookingService, availability }}>
      <Calendar />
      <Probe />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: dateLabel(date) }));
  expect(availability.mock.calls[0][0].signal?.aborted).toBe(true);
  await act(async () => {
    current.resolve(demoBookingModel.availability(date));
  });
  expect(screen.getByRole("button", { name: /09:00–09:40/ })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Change players" }));
  expect(screen.getByText("Checking available times…")).toBeVisible();
  await act(async () => {
    old.resolve(demoBookingModel.availability("2026-10-09"));
  });
  expect(screen.getByText("Checking available times…")).toBeVisible();
  await act(async () => {
    changed.resolve(demoBookingModel.availability(date));
  });
  expect(availability.mock.calls[2][0].players).toBe(2);
  expect(screen.getByRole("button", { name: /09:00–09:40/ })).toBeEnabled();
  expect(screen.queryByText("No times on this day.")).not.toBeInTheDocument();
});
test("unmount aborts the shared read and a late reply cannot replace remounted session data", async () => {
  const old = deferred<AvailableSlot[]>();
  const availability = vi.fn<BookingService["availability"]>(() => old.promise);
  const view = render(
    <BookingProvider bookingService={{ ...demoBookingService, availability }}>
      <Calendar />
    </BookingProvider>,
  );
  view.unmount();
  expect(availability.mock.calls[0][0].signal?.aborted).toBe(true);
  render(
    <BookingProvider
      bookingService={{ ...demoBookingService, availability: async () => [] }}
    >
      <Calendar />
    </BookingProvider>,
  );
  await act(async () => {
    old.resolve(demoBookingModel.availability(date));
  });
  expect(screen.getByText("No times on this day.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /09:00–09:40/ }),
  ).not.toBeInTheDocument();
});
test("review waits before navigation and same-turn duplicate checkout has one logical effect", async () => {
  const pending = deferred<Attempt>();
  const checkout = vi.fn<BookingService["checkout"]>(() => pending.promise);
  render(
    <BookingProvider bookingService={{ ...demoBookingService, checkout }}>
      <ReviewStep />
      <Probe />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  fireEvent.click(screen.getByRole("button", { name: "Double checkout" }));
  expect(checkout).toHaveBeenCalledTimes(1);
  expect(navigation.push).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Checking your booking…" }),
  ).toBeDisabled();
  const result = demoBookingModel.checkout(draft(), null);
  await act(async () => {
    pending.resolve(result);
  });
  expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/book/payment/");
  expect(loadBooking().attempt?.id).toBe(result.id);
});
test("editing a draft cancels checkout and a late result cannot overwrite entered information", async () => {
  const pending = deferred<Attempt>();
  const checkout = vi.fn<BookingService["checkout"]>(() => pending.promise);
  render(
    <BookingProvider bookingService={{ ...demoBookingService, checkout }}>
      <ReviewStep />
      <Probe />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
  expect(checkout.mock.calls[0][0].signal?.aborted).toBe(true);
  await act(async () => {
    pending.resolve(demoBookingModel.checkout(draft(), null));
  });
  expect(loadBooking().attempt).toBeNull();
  expect(loadBooking().draft.contact.name).toBe("Retained name");
  expect(navigation.push).not.toHaveBeenCalled();
  expect(screen.getByTestId("action")).toHaveTextContent("cancelled");
});
test("leaving review cancels its pending action without a late navigation or stored attempt", async () => {
  const pending = deferred<Attempt>();
  const checkout = vi.fn<BookingService["checkout"]>(() => pending.promise);
  const service = { ...demoBookingService, checkout };
  const view = render(
    <BookingProvider bookingService={service}>
      <ReviewStep />
      <Probe />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  view.rerender(
    <BookingProvider bookingService={service}>
      <Probe />
    </BookingProvider>,
  );
  await act(async () => {
    pending.resolve(demoBookingModel.checkout(draft(), null));
  });
  expect(checkout.mock.calls[0][0].signal?.aborted).toBe(true);
  expect(loadBooking().attempt).toBeNull();
  expect(navigation.push).not.toHaveBeenCalled();
});
test("an old attempt completion cannot replace a newer checkout after cancellation", async () => {
  const old = deferred<Attempt>();
  const current = deferred<Attempt>();
  const checkout = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  render(
    <BookingProvider bookingService={{ ...demoBookingService, checkout }}>
      <Probe />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Double checkout" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  fireEvent.click(screen.getByRole("button", { name: "Double checkout" }));
  const latest = demoBookingModel.checkout(draft(), null);
  await act(async () => {
    current.resolve(latest);
  });
  await act(async () => {
    old.resolve(demoBookingModel.checkout(draft(), null));
  });
  expect(loadBooking().attempt?.id).toBe(latest.id);
  expect(checkout).toHaveBeenCalledTimes(2);
});
test("identity expiry during checkout rejects completion and preserves the member draft", async () => {
  const identity = demoIdentityService.verify(
    demoIdentityService.challenge("demo@example.com"),
    DEMO_CODE,
    false,
  );
  const member = {
    ...draft(),
    mode: "member" as const,
    accountEmail: identity.email,
  };
  saveBooking({ version: 2, draft: member, attempt: null });
  const pending = deferred<Attempt>();
  render(
    <BookingProvider
      bookingService={{
        ...demoBookingService,
        checkout: () => pending.promise,
      }}
    >
      <ReviewStep />
      <Probe />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  demoIdentityService.signOut();
  await act(async () => {
    pending.resolve(demoBookingModel.checkout(member, null));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("session has changed");
  expect(loadBooking().attempt).toBeNull();
  expect(loadBooking().draft).toEqual(member);
  expect(navigation.push).not.toHaveBeenCalled();
});
test("unsupported live mode exposes unavailable state and cannot restore a paid demo receipt", async () => {
  const ready = demoBookingModel.checkout(draft(), null);
  const checking = demoBookingModel.pay(ready, "success");
  const paid = demoBookingModel.resolve(checking, checking.checkUntil);
  saveBooking({ version: 2, draft: draft(), attempt: paid });
  const fetch = vi.spyOn(globalThis, "fetch");
  render(
    <BookingProvider bookingService={liveBookingService}>
      <Calendar />
      <Probe />
    </BookingProvider>,
  );
  await act(async () => {});
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Online booking is not available yet",
  );
  expect(screen.getByTestId("attempt")).toHaveTextContent("none");
  expect(loadBooking().attempt?.id).toBe(paid.id);
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByText("No times on this day.")).not.toBeInTheDocument();
});
test("payment resolution failure ends loading and explicit status recovery keeps the original attempt", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const checking = demoBookingModel.pay(
    demoBookingModel.checkout(draft(), null),
    "success",
  );
  saveBooking({ version: 2, draft: draft(), attempt: checking });
  const resolve = vi
    .fn<BookingService["resolve"]>()
    .mockRejectedValueOnce(new Error("transport"))
    .mockImplementation((input) => demoBookingService.resolve(input));
  render(
    <BookingProvider bookingService={{ ...demoBookingService, resolve }}>
      <PaymentStep />
      <Probe />
    </BookingProvider>,
  );
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "couldn’t complete that request",
  );
  expect(screen.getByTestId("action")).toHaveTextContent("failure");
  expect(loadBooking().attempt?.id).toBe(checking.id);
  expect(resolve).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    );
  });
  expect(screen.getByTestId("status")).toHaveTextContent("paid");
  expect(loadBooking().attempt?.id).toBe(checking.id);
  expect(resolve).toHaveBeenCalledTimes(2);
});

test("a changed booking session invalidates availability even if the old date response arrives last", async () => {
  const old = deferred<AvailableSlot[]>();
  const current = deferred<AvailableSlot[]>();
  const availability = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  render(
    <BookingProvider bookingService={{ ...demoBookingService, availability }}>
      <Calendar />
      <Summary basket />
      <Probe />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Change session" }));
  await act(async () => {
    current.resolve([]);
  });
  await act(async () => {
    old.resolve(demoBookingModel.availability(date));
  });
  expect(screen.getByText("No times on this day.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(loadBooking().draft.accountEmail).toBe("changed@example.com");
  expect(availability.mock.calls[0][0].signal.aborted).toBe(true);
});
test("malformed checkout cannot navigate or create an attempt and retry preserves the reviewed draft", async () => {
  const checkout = vi
    .fn<BookingService["checkout"]>()
    .mockResolvedValueOnce({ id: "bad" } as Attempt)
    .mockImplementation((input) => demoBookingService.checkout(input));
  render(
    <BookingProvider bookingService={{ ...demoBookingService, checkout }}>
      <ReviewStep />
      <Probe />
    </BookingProvider>,
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" }),
    );
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "couldn’t check this information",
  );
  expect(navigation.push).not.toHaveBeenCalled();
  expect(loadBooking().attempt).toBeNull();
  expect(loadBooking().draft).toEqual(draft());
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" }),
    );
  });
  expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/book/payment/");
  expect(checkout).toHaveBeenCalledTimes(2);
});
test("delayed pay blocks duplicate actions and draft mutation until the same attempt advances", async () => {
  const ready = demoBookingModel.checkout(draft(), null);
  saveBooking({ version: 2, draft: draft(), attempt: ready });
  const pending = deferred<Attempt>();
  const pay = vi.fn<BookingService["pay"]>(() => pending.promise);
  render(
    <BookingProvider bookingService={{ ...demoBookingService, pay }}>
      <PaymentStep />
      <Probe />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Pay $88.00" }));
  fireEvent.click(screen.getByRole("button", { name: "Starting payment…" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
  expect(pay).toHaveBeenCalledTimes(1);
  expect(loadBooking().draft.contact.name).toBe("Demo Customer");
  await act(async () => {
    pending.resolve(demoBookingModel.pay(ready, "success"));
  });
  expect(
    screen.getByRole("heading", { name: "Processing payment" }),
  ).toBeVisible();
  expect(loadBooking().attempt?.id).toBe(ready.id);
  expect(loadBooking().attempt?.status).toBe("checking");
});
test("interrupted status resolution remains recoverable after leaving and returning to payment", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const checking = demoBookingModel.pay(
    demoBookingModel.checkout(draft(), null),
    "success",
  );
  saveBooking({ version: 2, draft: draft(), attempt: checking });
  const old = deferred<Attempt>();
  const resolve = vi
    .fn<BookingService["resolve"]>()
    .mockReturnValueOnce(old.promise)
    .mockImplementation((input) => demoBookingService.resolve(input));
  const service = { ...demoBookingService, resolve };
  const view = render(
    <BookingProvider bookingService={service}>
      <PaymentStep />
      <Probe />
    </BookingProvider>,
  );
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  view.rerender(
    <BookingProvider bookingService={service}>
      <Probe />
    </BookingProvider>,
  );
  expect(resolve.mock.calls[0][0].signal?.aborted).toBe(true);
  view.rerender(
    <BookingProvider bookingService={service}>
      <PaymentStep />
      <Probe />
    </BookingProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Check payment status" }),
  ).toBeEnabled();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    );
  });
  const paid = loadBooking().attempt;
  await act(async () => {
    old.resolve({ ...checking, status: "late" });
  });
  expect(loadBooking().attempt).toEqual(paid);
  expect(loadBooking().attempt?.status).toBe("paid");
});

test("server render performs no availability or booking operation", () => {
  const availability = vi.fn<BookingService["availability"]>();
  const checkout = vi.fn<BookingService["checkout"]>();
  renderToString(
    <BookingProvider
      bookingService={{ ...demoBookingService, availability, checkout }}
    >
      <TimeStep />
      <Summary basket />
    </BookingProvider>,
  );
  expect(availability).not.toHaveBeenCalled();
  expect(checkout).not.toHaveBeenCalled();
});

test("replacing an adapter with the same mode invalidates its completed availability", async () => {
  const oldService = { ...demoBookingService };
  const pending = deferred<AvailableSlot[]>();
  const newService = {
    ...demoBookingService,
    availability: vi.fn<BookingService["availability"]>(() => pending.promise),
  };
  const view = render(
    <BookingProvider bookingService={oldService}>
      <Calendar />
      <Summary basket />
    </BookingProvider>,
  );
  await act(async () => {});
  expect(screen.getByRole("link", { name: "Continue" })).toBeVisible();
  view.rerender(
    <BookingProvider bookingService={newService}>
      <Calendar />
      <Summary basket />
    </BookingProvider>,
  );
  expect(screen.getByText("Checking available times…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  await act(async () => {
    pending.resolve([]);
  });
  expect(screen.getByText("No times on this day.")).toBeVisible();
});
