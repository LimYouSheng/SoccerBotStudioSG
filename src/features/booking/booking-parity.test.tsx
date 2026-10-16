import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { NativeSessionInit } from "./native-session-init";
import { useCalendarAvailability } from "./calendar-availability";
import { demoBookingService } from "@/services/demo/booking";
import { BookingServiceError } from "@/services/contracts";
import type {
  BookingService,
  CalendarAvailability,
} from "@/services/contracts";
import { BookingProvider, useBooking } from "./provider";
import { DetailsStep } from "./details-step";
import { TimeStep } from "./time-step";
import { Summary } from "./summary";
import { BookingPage } from "./booking-page";
import { SessionStep } from "./session-step";
import { dateLabel } from "@/domain/dates";
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  push.mockClear();
  replace.mockClear();
});

test("native initialization stays hidden and stable and never preloads a payment capability", () => {
  const { container, rerender } = render(<NativeSessionInit enabled={false} />);
  expect(container.querySelector("iframe")).toBeNull();
  rerender(<NativeSessionInit enabled />);
  const frame = container.querySelector("iframe")!;
  expect(frame).toHaveAttribute("hidden");
  expect(frame).toHaveAttribute(
    "src",
    "https://soccerbotstudiosg.simplybook.asia/v2/",
  );
  expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
  fireEvent.load(frame);
  rerender(<NativeSessionInit enabled />);
  expect(container.querySelector("iframe")).toBe(frame);
  expect(screen.queryByText(/ready|authorized/i)).not.toBeInTheDocument();
});

function CalendarProbe({
  service,
  now,
}: {
  service: BookingService;
  now: number;
}) {
  const calendar = useCalendarAvailability(
    service,
    "12",
    "2027-01",
    "guest",
    false,
  );
  return (
    <output>
      {calendar
        .entry("2027-01", now)
        ?.dates.map((d) => d.date)
        .join(",") ?? "loading"}
    </output>
  );
}
test("calendar prefetch publishes the first month before sequential background months and discards an old scope reply", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2027-01-01T00:00:00Z"));
  let finish!: (value: CalendarAvailability) => void;
  const first = {
    ...demoBookingService,
    calendar: vi.fn(
      () =>
        new Promise<CalendarAvailability>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  const next = {
    ...demoBookingService,
    calendar: vi.fn(async ({ month }: { month: string }) => ({
      month,
      observedAtMs: Date.now(),
      dates: [{ date: month + "-05", available: true }],
    })),
  };
  const view = render(
    <CalendarProbe service={first} now={Date.now() + 1000} />,
  );
  expect(first.calendar).toHaveBeenCalledTimes(1);
  view.rerender(<CalendarProbe service={next} now={Date.now() + 1000} />);
  expect(await screen.findByText("2027-01-05")).toBeInTheDocument();
  await waitFor(() => expect(next.calendar).toHaveBeenCalledTimes(4));
  expect(next.calendar.mock.calls.map(([input]) => input.month)).toEqual([
    "2027-01",
    "2027-02",
    "2027-03",
    "2027-04",
  ]);
  await act(async () =>
    finish({
      month: "2027-01",
      observedAtMs: Date.now(),
      dates: [{ date: "2027-01-09", available: true }],
    }),
  );
  expect(screen.queryByText("2027-01-09")).not.toBeInTheDocument();
  expect(first.calendar).toHaveBeenCalledTimes(1);
});

const slot = {
  date: "2027-01-05",
  start: "09:00",
  instructor: "14",
  native: {
    serviceId: "12",
    serviceName: "Real session",
    instructorName: "Real trainer",
    currency: "SGD" as const,
    priceMinor: 8800,
  },
};
function Seed() {
  const { update } = useBooking();
  return (
    <button
      onClick={() =>
        update({
          mode: "guest",
          nativeServiceId: "12",
          slots: [slot],
          contact: {
            name: "Test Customer",
            email: "test@example.com",
            phone: "+65 8123 4567",
            contactMethod: "email",
            academy: "Test Academy",
          },
        })
      }
    >
      Choose test session
    </button>
  );
}
test("live calendar removes unavailable selections after fresh review and retains contact details", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
  let stale = false;
  const availability = vi.fn(
    async ({ date, fresh }: { date: string; fresh?: boolean }) => {
      if (fresh) stale = true;
      return date === slot.date && !stale ? [{ ...slot, available: true }] : [];
    },
  );
  const calendar = vi.fn(async ({ month }: { month: string }) => ({
    month,
    observedAtMs: Date.now(),
    dates:
      month === "2027-01"
        ? [
            { date: slot.date, available: !stale },
            { date: "2027-01-06", available: false },
          ]
        : [],
  }));
  const service: BookingService = {
    ...demoBookingService,
    mode: "live",
    operations: {
      ...demoBookingService.operations,
      availability: "live",
      checkout: "live",
    },
    checkout: async () => {
      stale = true;
      throw new BookingServiceError(
        "selection_changed",
        "The selected sessions were removed because availability changed.",
      );
    },
    availability,
    calendar,
  };
  render(
    <BookingProvider bookingService={service}>
      <Seed />
      <TimeStep />
      <Summary basket />
      <DetailsStep />
    </BookingProvider>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Choose test session" }));
  const region = screen.getByRole("region", { name: "Booking calendar" });
  await waitFor(() =>
    expect(
      within(region).getByRole("button", { name: dateLabel(slot.date) }),
    ).toBeEnabled(),
  );
  expect(
    within(region).getByRole("button", { name: dateLabel("2027-01-06") }),
  ).toBeDisabled();
  expect(
    within(region).getByRole("button", { name: dateLabel("2027-01-07") }),
  ).toBeDisabled();
  expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
    "href",
    "/book/details",
  );
  expect(availability.mock.calls.some(([input]) => input.fresh === true)).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review booking" }));
  const notices = await screen.findAllByRole("alert");
  expect(notices).toHaveLength(2); // This fixture mounts calendar and Details together.
  for (const notice of notices)
    expect(notice).toHaveTextContent("sessions were removed");
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/Full name/)).toHaveValue("Test Customer");
  expect(
    screen.queryByRole("button", {
      name: `Remove ${slot.date} at ${slot.start}`,
    }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      within(region).getByRole("button", { name: dateLabel(slot.date) }),
    ).toBeDisabled(),
  );
  expect(availability.mock.calls.some(([input]) => input.fresh === true)).toBe(
    false,
  );
  expect(
    screen.queryByText(/rotate every three hours/),
  ).not.toBeInTheDocument();
});

test("live session preserves demo product player and inclusion presentation using provider labels", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        environment: "developer",
        observedAtMs: Date.now(),
        complete: true,
        services: [
          {
            id: "12",
            name: "Real session",
            active: true,
            durationMinutes: 40,
            recurring: false,
            priceMinor: 8800,
            currency: "SGD",
            instructorIds: ["14"],
          },
        ],
        instructors: [{ id: "14", name: "Real trainer", active: true }],
      }),
    ),
  );
  render(
    <BookingProvider bookingService={{ ...demoBookingService, mode: "live" }}>
      <SessionStep />
    </BookingProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "Real session" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Included with your session" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("link", { name: "See available times" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Remove one player" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Add one player" }));
  expect(screen.getByText("2 players")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Select session" }),
  ).not.toBeInTheDocument();
});

test("homepage prefetch starts without a booking identity and never creates guest access", async () => {
  const publicCalendar = vi.fn(async ({ month }: { month: string }) => ({
    month,
    serviceId: "12",
    observedAtMs: Date.now(),
    dates: [],
  }));
  const service = {
    ...demoBookingService,
    mode: "live" as const,
    operations: {
      ...demoBookingService.operations,
      availability: "live" as const,
    },
    publicCalendar,
  };
  function Entry() {
    const { update } = useBooking();
    return (
      <>
        <p>Homepage</p>
        <button
          onClick={() => update({ mode: "guest", nativeServiceId: "12" })}
        >
          Guest entry
        </button>
        <button
          onClick={() =>
            update({ mode: "member", accountEmail: "synthetic@example.test" })
          }
        >
          Email entry
        </button>
      </>
    );
  }
  render(
    <BookingProvider bookingService={service}>
      <Entry />
    </BookingProvider>,
  );
  await waitFor(() => expect(publicCalendar).toHaveBeenCalledTimes(4));
  expect(screen.getByText("Homepage")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Guest entry" }));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Email entry" }));
  await act(async () => {});
  expect(publicCalendar).toHaveBeenCalledTimes(4);
  expect(publicCalendar.mock.calls.map(([input]) => input.month)).toHaveLength(
    4,
  );
});

test("fresh calendar receipts render before the minute clock ticks and expire at their own deadline", async () => {
  vi.useFakeTimers();
  const initial = Date.parse("2027-01-01T00:00:00Z");
  vi.setSystemTime(initial);
  let finish!: (value: CalendarAvailability) => void;
  const calendar = vi.fn(
    async ({ month }: { month: string }) =>
      ({ month, observedAtMs: Date.now(), dates: [] }) as CalendarAvailability,
  );
  calendar.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <CalendarProbe
      service={{ ...demoBookingService, calendar }}
      now={initial}
    />,
  );
  vi.setSystemTime(initial + 1500);
  await act(async () =>
    finish({
      month: "2027-01",
      observedAtMs: Date.now(),
      dates: [{ date: "2027-01-04", available: true }],
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("2027-01-04");
  await act(async () => vi.advanceTimersByTime(60000));
  expect(screen.getByRole("status")).toHaveTextContent("loading");
});

test("preloaded browser slots survive date and player changes and Continue refreshes changed availability", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-04T22:30:00Z"));
  let changed = false;
  const availability = vi.fn(
    async ({ date, fresh }: { date: string; fresh?: boolean }) => {
      if (fresh) changed = true;
      return date === slot.date && !changed
        ? [{ ...slot, available: true }]
        : [];
    },
  );
  const publicCalendar = vi.fn(async ({ month }: { month: string }) => ({
    month,
    serviceId: "12",
    observedAtMs: Date.now(),
    dates:
      month === "2027-01"
        ? [slot.date, "2027-01-06"].map((date) => ({
            date,
            available: !changed,
            offers: changed
              ? []
              : [
                  {
                    serviceId: "12",
                    serviceName: "Native Session",
                    instructorId: slot.instructor,
                    instructorName: "Native Trainer",
                    startMs: Date.parse(`${date}T${slot.start}:00+08:00`),
                    priceMinor: 8800,
                    currency: "SGD" as const,
                  },
                ],
          }))
        : [],
  }));
  function Players() {
    const { update, showDate } = useBooking();
    return (
      <>
        <button onClick={() => update({ players: 2 })}>Two players</button>
        <button onClick={() => showDate("2026-12-31")}>Inspect past day</button>
      </>
    );
  }
  render(
    <BookingProvider
      bookingService={{
        ...demoBookingService,
        mode: "live",
        operations: {
          ...demoBookingService.operations,
          availability: "live",
          checkout: "live",
        },
        checkout: async () => {
          changed = true;
          throw new BookingServiceError(
            "selection_changed",
            "The selected sessions were removed because availability changed.",
          );
        },
        publicCalendar,
        availability,
      }}
    >
      <Seed />
      <Players />
      <TimeStep />
      <Summary basket />
      <DetailsStep />
    </BookingProvider>,
  );
  await waitFor(() => expect(publicCalendar).toHaveBeenCalledTimes(4));
  fireEvent.click(screen.getByRole("button", { name: "Choose test session" }));
  await act(async () => {});
  availability.mockClear();
  const region = screen.getByRole("region", { name: "Booking calendar" });
  for (const date of [slot.date, "2027-01-06", slot.date]) {
    fireEvent.click(
      within(region).getByRole("button", { name: dateLabel(date) }),
    );
    expect(
      screen.getByRole("group", { name: "Session times" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Checking available times…"),
    ).not.toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole("button", { name: "Two players" }));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Inspect past day" }));
  await act(async () => {});
  expect(availability).not.toHaveBeenCalled();
  expect(publicCalendar).toHaveBeenCalledTimes(4);
  expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
    "href",
    "/book/details",
  );
  expect(availability.mock.calls.some(([input]) => input.fresh === true)).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review booking" }));
  const notices = await screen.findAllByRole("alert");
  expect(notices).toHaveLength(2); // This fixture mounts calendar and Details together.
  for (const notice of notices)
    expect(notice).toHaveTextContent("sessions were removed");
  expect(availability.mock.calls.some(([input]) => input.fresh === true)).toBe(
    false,
  );
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/Full name/)).toHaveValue("Test Customer");
  expect(
    screen.queryByRole("button", {
      name: `Remove ${slot.date} at ${slot.start}`,
    }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      within(region).getByRole("button", { name: dateLabel(slot.date) }),
    ).toBeDisabled(),
  );
  expect(publicCalendar).toHaveBeenCalledTimes(4);
  expect(availability).not.toHaveBeenCalled();
});

test("browser slot cache expires after five minutes", async () => {
  vi.useFakeTimers();
  const initial = Date.parse("2027-01-01T00:00:00Z");
  vi.setSystemTime(initial);
  const publicCalendar = vi.fn(async ({ month }: { month: string }) => ({
    month,
    serviceId: "12",
    observedAtMs: initial,
    dates: [
      {
        date: month + "-05",
        available: true,
        offers: [
          {
            serviceId: "12",
            serviceName: "Session",
            instructorId: "3",
            instructorName: "Trainer",
            startMs: Date.parse(`${month}-05T09:00:00+08:00`),
            priceMinor: 8800,
            currency: "SGD" as const,
          },
        ],
      },
    ],
  }));
  render(
    <CalendarProbe
      service={{ ...demoBookingService, publicCalendar }}
      now={initial}
    />,
  );
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("2027-01-05");
  await act(async () => vi.advanceTimersByTime(60000));
  expect(screen.getByRole("status")).toHaveTextContent("2027-01-05");
  await act(async () => vi.advanceTimersByTime(240000));
  expect(screen.getByRole("status")).toHaveTextContent("loading");
});

test("Details accepts input before checking the complete selection on submission", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
  let fail!: (error: Error) => void;
  let finish!: (
    attempt: Awaited<ReturnType<BookingService["checkout"]>>,
  ) => void;
  let submittedDraft!: Parameters<BookingService["checkout"]>[0]["draft"];
  const availability = vi.fn<BookingService["availability"]>(async () => []);
  const publicCalendar = vi.fn(async ({ month }: { month: string }) => ({
    month,
    serviceId: "12",
    observedAtMs: Date.now(),
    dates:
      month === "2027-01"
        ? [
            {
              date: slot.date,
              available: true,
              offers: [
                {
                  serviceId: "12",
                  serviceName: slot.native.serviceName,
                  instructorId: slot.instructor,
                  instructorName: slot.native.instructorName,
                  startMs: Date.parse(`${slot.date}T${slot.start}:00+08:00`),
                  priceMinor: 8800,
                  currency: "SGD" as const,
                },
              ],
            },
          ]
        : [],
  }));
  let finishHold!: () => void;
  const service = {
    ...demoBookingService,
    mode: "live" as const,
    operations: {
      ...demoBookingService.operations,
      availability: "live" as const,
      checkout: "live" as const,
      pay: "live" as const,
    },
    publicCalendar,
    availability,
    checkout: vi.fn(({ draft }: Parameters<BookingService["checkout"]>[0]) => {
      submittedDraft = draft;
      return new Promise<Awaited<ReturnType<BookingService["checkout"]>>>(
        (resolve, reject) => {
          finish = resolve;
          fail = reject;
        },
      );
    }),
    pay: vi.fn(
      ({ attempt }: Parameters<typeof demoBookingService.pay>[0]) =>
        new Promise<typeof attempt>((resolve) => {
          finishHold = () => resolve({ ...attempt, held: true });
        }),
    ),
  };
  const tree = (step: "time" | "details") => (
    <BookingProvider bookingService={service}>
      <Seed />
      <BookingPage step={step} />
    </BookingProvider>
  );
  const view = render(tree("time"));
  await waitFor(() => expect(publicCalendar).toHaveBeenCalledTimes(4));
  fireEvent.click(screen.getByRole("button", { name: "Choose test session" }));
  expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
    "href",
    "/book/details",
  );
  expect(availability).not.toHaveBeenCalled();
  view.rerender(tree("details"));
  expect(
    screen.getByRole("heading", { name: "Your details" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review booking" }));
  expect(availability).not.toHaveBeenCalled();
  expect(service.checkout).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Checking availability…" }),
  ).toBeDisabled();
  await act(async () => fail(new Error("provider_auth_failed")));
  expect(
    screen.getByRole("heading", { name: "Your details" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/couldn’t complete that request/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText(/Full name/)).toHaveValue("Test Customer");
  expect(service.checkout).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review booking" }));
  await act(async () =>
    finish({
      id: "synthetic-held-attempt",
      draft: submittedDraft,
      status: "ready",
      outcome: "pending",
      checkUntil: 0,
      booking: null,
    }),
  );
  expect(service.pay).toHaveBeenCalledTimes(1);
  expect(service.pay.mock.calls[0][0].signal?.aborted).toBe(false);
  expect(
    screen.getByRole("heading", { name: "Your details" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText(/Full name/)).toHaveValue("Test Customer");
  expect(push).not.toHaveBeenCalled();
  await act(async () => finishHold());
  expect(replace).toHaveBeenCalledWith("/book/review/");
  expect(service.pay.mock.calls[0][0].attempt.draft.contact.name).toBe(
    "Test Customer",
  );
  expect(availability).not.toHaveBeenCalled();
  expect(service.checkout).toHaveBeenCalledTimes(2);
  // A failed read retains the existing display cache.
  expect(publicCalendar).toHaveBeenCalledTimes(4);
});

test("failed preparation releases cached calendar without removing the selection or refetching", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-04T22:30:00Z"));
  const availability = vi.fn<BookingService["availability"]>(async () => [
    { ...slot, available: true },
  ]);
  const publicCalendar = vi.fn(async ({ month }: { month: string }) => ({
    month,
    serviceId: "12",
    observedAtMs: Date.now(),
    dates:
      month === "2027-01"
        ? [
            {
              date: slot.date,
              available: true,
              offers: [
                {
                  serviceId: "12",
                  serviceName: "Real session",
                  instructorId: slot.instructor,
                  instructorName: "Real trainer",
                  startMs: Date.parse(`${slot.date}T09:00:00+08:00`),
                  priceMinor: 8800,
                  currency: "SGD" as const,
                },
              ],
            },
          ]
        : [],
  }));
  const checkout = vi.fn(async () => {
    throw new Error("preparation unavailable");
  });
  const service: BookingService = {
    ...demoBookingService,
    mode: "live",
    operations: {
      ...demoBookingService.operations,
      availability: "live",
      checkout: "live",
      pay: "live",
    },
    publicCalendar,
    availability,
    checkout,
  };
  function Probe() {
    const state = useBooking();
    return (
      <>
        <button onClick={() => state.showDate(slot.date)}>
          Return to calendar
        </button>
        <output data-testid="cached-times">
          {state.availability.result?.dates.includes(slot.date)
            ? "visible"
            : "loading"}
        </output>
        <output data-testid="selected-count">{state.draft.slots.length}</output>
      </>
    );
  }
  const tree = (step: "time" | "details") => (
    <BookingProvider bookingService={service}>
      <Seed />
      <BookingPage step={step} />
      <Probe />
    </BookingProvider>
  );
  const view = render(tree("time"));
  await act(async () => {});
  fireEvent.click(screen.getByText("Choose test session"));
  await waitFor(() => expect(publicCalendar).toHaveBeenCalledTimes(4));
  view.rerender(tree("details"));
  fireEvent.click(screen.getByRole("button", { name: "Review booking" }));
  await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(screen.getByLabelText(/Full name/)).toHaveValue("Test Customer");
  view.rerender(tree("time"));
  fireEvent.click(screen.getByText("Return to calendar"));
  await waitFor(() =>
    expect(screen.getByTestId("cached-times")).toHaveTextContent("visible"),
  );
  expect(screen.getByTestId("selected-count")).toHaveTextContent("1");
  view.rerender(tree("details"));
  expect(screen.getByLabelText(/Full name/)).toHaveValue("Test Customer");
  expect(publicCalendar).toHaveBeenCalledTimes(4);
  expect(availability).not.toHaveBeenCalled();
});

test("reservation conflict removes its session locally and returns to calendar with contact preserved", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-04T22:30:00Z"));
  const availability = vi.fn<BookingService["availability"]>(async () => [
    { ...slot, available: true },
  ]);
  const publicCalendar = vi.fn(async ({ month }: { month: string }) => ({
    month,
    serviceId: "12",
    observedAtMs: Date.now(),
    dates:
      month === "2027-01"
        ? [
            {
              date: slot.date,
              available: true,
              offers: [
                {
                  serviceId: "12",
                  serviceName: "Real session",
                  instructorId: slot.instructor,
                  instructorName: "Real trainer",
                  startMs: Date.parse(`${slot.date}T09:00:00+08:00`),
                  priceMinor: 8800,
                  currency: "SGD" as const,
                },
              ],
            },
          ]
        : [],
  }));
  const checkout = vi.fn<BookingService["checkout"]>(async ({ draft }) => ({
    id: "00000000-0000-4000-8000-000000000001",
    draft,
    status: "ready",
    outcome: "pending",
    checkUntil: 0,
    booking: null,
  }));
  const pay = vi.fn<BookingService["pay"]>(async () => {
    throw new BookingServiceError(
      "selection_unavailable",
      "The selected session is no longer available. Your details have been kept.",
      0,
    );
  });
  const service: BookingService = {
    ...demoBookingService,
    mode: "live",
    operations: {
      ...demoBookingService.operations,
      availability: "live",
      checkout: "live",
      pay: "live",
    },
    publicCalendar,
    availability,
    checkout,
    pay,
  };
  function Probe() {
    const state = useBooking();
    return (
      <>
        <button
          onClick={() => state.update({ slots: [{ ...slot, start: "09:50" }] })}
        >
          Choose replacement
        </button>
        <button onClick={() => state.showDate(slot.date)}>
          Return to calendar
        </button>
        <output data-testid="cached-times">
          {state.availability.result?.dates.includes(slot.date)
            ? "visible"
            : "loading"}
        </output>
        <output data-testid="selected-count">{state.draft.slots.length}</output>
        <output data-testid="contact-name">{state.draft.contact.name}</output>
        <output data-testid="notice">{state.selectionNotice}</output>
      </>
    );
  }
  const tree = (step: "time" | "details") => (
    <BookingProvider bookingService={service}>
      <Seed />
      <BookingPage step={step} />
      <Probe />
    </BookingProvider>
  );
  const view = render(tree("time"));
  await act(async () => {});
  fireEvent.click(screen.getByText("Choose test session"));
  await waitFor(() => expect(publicCalendar).toHaveBeenCalledTimes(4));
  view.rerender(tree("details"));
  fireEvent.click(screen.getByRole("button", { name: "Review booking" }));
  await waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
  await act(async () => {});
  fireEvent.click(screen.getByText("Return to calendar"));
  await waitFor(() =>
    expect(screen.getByTestId("cached-times")).toHaveTextContent("visible"),
  );
  expect(screen.getByTestId("selected-count")).toHaveTextContent("0");
  expect(screen.getByTestId("contact-name")).toHaveTextContent("Test Customer");
  expect(replace).toHaveBeenCalledWith("/book/time/");
  expect(screen.getByTestId("notice")).toHaveTextContent(
    "The selected session is no longer available",
  );
  expect(publicCalendar).toHaveBeenCalledTimes(4);
  expect(availability).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Choose replacement"));
  view.rerender(tree("details"));
  expect(screen.getByLabelText(/Full name/)).toHaveValue("Test Customer");
  expect(screen.getByLabelText(/Email address/)).toHaveValue(
    "test@example.com",
  );
});

test("Details pauses future month prefetch and calendar return reuses the loaded month", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
  let finish!: (value: CalendarAvailability) => void;
  const publicCalendar = vi.fn<NonNullable<BookingService["publicCalendar"]>>(
    ({ month }) =>
      month === "2027-01"
        ? Promise.resolve({
            month,
            serviceId: "12",
            observedAtMs: Date.now(),
            dates: [],
          })
        : new Promise((resolve) => {
            finish = resolve;
          }),
  );
  const service: BookingService = {
    ...demoBookingService,
    mode: "live",
    operations: { ...demoBookingService.operations, availability: "live" },
    publicCalendar,
  };
  const tree = (step: "time" | "details") => (
    <BookingProvider bookingService={service}>
      <Seed />
      <BookingPage step={step} />
    </BookingProvider>
  );
  const view = render(tree("time"));
  fireEvent.click(screen.getByText("Choose test session"));
  await waitFor(() => expect(publicCalendar).toHaveBeenCalledTimes(2));
  const pending = publicCalendar.mock.calls[1][0];
  expect(pending.month).toBe("2027-02");
  view.rerender(tree("details"));
  expect(pending.signal?.aborted).toBe(true);
  await act(async () =>
    finish({
      month: "2027-02",
      serviceId: "12",
      observedAtMs: Date.now(),
      dates: [],
    }),
  );
  expect(publicCalendar).toHaveBeenCalledTimes(2);
  view.rerender(tree("time"));
  await waitFor(() => expect(publicCalendar).toHaveBeenCalledTimes(3));
  expect(publicCalendar.mock.calls.map(([input]) => input.month)).toEqual([
    "2027-01",
    "2027-02",
    "2027-02",
  ]);
});
