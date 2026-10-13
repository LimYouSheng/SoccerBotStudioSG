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
import type {
  BookingService,
  CalendarAvailability,
} from "@/services/contracts";
import { BookingProvider, useBooking } from "./provider";
import { TimeStep } from "./time-step";
import { Summary } from "./summary";
import { SessionStep } from "./session-step";
import { dateLabel } from "@/domain/dates";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  push.mockClear();
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
        update({ mode: "guest", nativeServiceId: "12", slots: [slot] })
      }
    >
      Choose test session
    </button>
  );
}
test("live calendar disables empty and unknown dates and a failed fresh continuation preserves the basket and refreshes calendar", async () => {
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
    operations: { ...demoBookingService.operations, availability: "live" },
    availability,
    calendar,
  };
  render(
    <BookingProvider bookingService={service}>
      <Seed />
      <TimeStep />
      <Summary basket />
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
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be confirmed",
  );
  expect(push).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", {
      name: `Remove ${slot.date} at ${slot.start}`,
    }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      within(region).getByRole("button", { name: dateLabel(slot.date) }),
    ).toBeDisabled(),
  );
  expect(availability.mock.calls.some(([input]) => input.fresh === true)).toBe(
    true,
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
  render(
    <BookingProvider bookingService={service}>
      <p>Homepage</p>
    </BookingProvider>,
  );
  await waitFor(() => expect(publicCalendar).toHaveBeenCalledTimes(4));
  expect(screen.getByText("Homepage")).toBeInTheDocument();
  expect(publicCalendar.mock.calls.map(([input]) => input.month)).toHaveLength(
    4,
  );
});
