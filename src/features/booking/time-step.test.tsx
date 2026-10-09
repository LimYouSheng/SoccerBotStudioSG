import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { blankDraft } from "@/domain/booking";
import { dateLabel, todaySG } from "@/domain/dates";
import { BookingPage } from "./booking-page";
import { Summary } from "./summary";
import { ReviewStep } from "./review-step";
import { BookingProvider } from "./provider";
import { demoSession } from "@/services/demo/schedule";
import { ConfirmationStep } from "./confirmation-step";
import { demoBookingModel } from "@/services/demo/booking";
import { loadBooking, saveBooking } from "@/services/storage";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
const restoredDate = "2026-10-13";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T02:00:00Z"));
  localStorage.clear();
  sessionStorage.clear();
  const draft = {
    ...blankDraft(),
    mode: "guest" as const,
    slots: [
      demoSession({
        date: restoredDate,
        start: "11:30",
      })!,
    ],
  };
  saveBooking({ version: 2, draft, attempt: null });
});
afterEach(() => {
  vi.useRealTimers();
});
test("booking page restores a future Tuesday on Wednesday before selecting and removing sessions, accumulating unique instructors and enabling Continue", async () => {
  const user = userEvent.setup();
  render(
    <BookingProvider>
      <BookingPage step="time" />
    </BookingProvider>,
  );
  await act(async () => {});
  expect(todaySG()).toBe("2026-10-07");
  const calendar = screen.getByRole("region", { name: "Booking calendar" });
  expect(
    within(calendar).getByRole("button", { name: dateLabel(restoredDate) }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(calendar).getByRole("button", { name: dateLabel(todaySG()) }),
  ).toHaveAttribute("aria-pressed", "false");
  const crossing = screen.getByRole("button", { name: /11:30–12:10/ });
  expect(crossing).toHaveAttribute("aria-pressed", "true");
  expect(crossing).toHaveTextContent("Faisal Shahril");
  expect(crossing).toHaveTextContent("Crosses the 12:00 instructor rotation");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /12:20–13:00/ })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: /12:20–13:00/ }));
  const instructors = screen.getByRole("region", { name: "Your instructors" });
  expect(within(instructors).getAllByRole("article")).toHaveLength(2);
  expect(
    within(instructors).getByRole("article", { name: "Faisal Shahril" }),
  ).toBeInTheDocument();
  expect(
    within(instructors).getByRole("article", { name: "Daniel Tan" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /09:00–09:40/ }));
  expect(within(instructors).getAllByRole("article")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: /12:20–13:00/ }));
  expect(within(instructors).getAllByRole("article")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Clear all" }));
  expect(
    screen.queryByRole("region", { name: "Your instructors" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(screen.queryByText("Preview controls")).not.toBeInTheDocument();
});
test("crossing notices persist in the basket and review before payment", async () => {
  const basket = render(
    <BookingProvider>
      <Summary basket />
    </BookingProvider>,
  );
  await act(async () => {});
  expect(
    within(screen.getByRole("complementary")).getByText(/Crosses the 12:00/),
  ).toHaveTextContent("stays for the full session");
  expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
    "href",
    "/book/details",
  );
  basket.unmount();
  render(
    <BookingProvider>
      <ReviewStep />
    </BookingProvider>,
  );
  expect(screen.getByText(/Crosses the 12:00/)).toHaveTextContent(
    "stays for the full session",
  );
  expect(
    screen.getByRole("button", { name: "Continue to payment" }),
  ).toBeDisabled();
});

test("confirmation shows each contact and location once with all five sections expanded", async () => {
  const stored = loadBooking();
  const draft = {
    ...stored.draft,
    accepted: true,
    contact: {
      ...stored.draft.contact,
      name: "Demo Customer",
      email: "demo@example.com",
      phone: "+65 8123 4567",
    },
    slots: [
      ...stored.draft.slots,
      demoSession({ date: stored.draft.slots[0].date, start: "12:20" })!,
    ],
  };
  const checking = demoBookingModel.pay(
    demoBookingModel.checkout(draft, null),
    "success",
  );
  const attempt = demoBookingModel.resolve(checking, checking.checkUntil);
  saveBooking({ version: 2, draft, attempt });
  const view = render(
    <BookingProvider>
      <ConfirmationStep />
    </BookingProvider>,
  );
  expect(
    screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent),
  ).toEqual([
    "Client Details",
    "Session Details",
    "Location",
    "Amount",
    "Disclaimers",
  ]);
  expect(view.container.querySelectorAll("details")).toHaveLength(0);
  expect(screen.getAllByText("Demo Customer", { exact: true })).toHaveLength(1);
  expect(screen.getAllByText("Studio 1", { exact: true })).toHaveLength(1);
  expect(screen.getAllByText("Faisal Shahril", { exact: true })).toHaveLength(
    1,
  );
  expect(screen.getAllByText("Daniel Tan", { exact: true })).toHaveLength(1);
  expect(
    screen.getByText(/Crosses the 12:00 instructor rotation/),
  ).toBeVisible();
});

test("an open booking page expires a selected slot at its start and keeps it removable", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-10-06T08:59:59.999+08:00"));
  const draft = { ...blankDraft(), mode: "guest" as const };
  saveBooking({ version: 2, draft, attempt: null });
  const view = render(
    <BookingProvider>
      <BookingPage step="time" />
    </BookingProvider>,
  );
  await act(async () => {});
  const slot = screen.getByRole("button", { name: /09:00–09:40/ });
  expect(slot).toBeEnabled();
  fireEvent.click(slot);
  expect(screen.getByRole("link", { name: "Continue" })).toBeInTheDocument();
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  await act(async () => {});
  expect(
    within(screen.getByRole("complementary")).getByText(/Session has started/),
  ).toBeVisible();
  expect(loadBooking().draft.slots).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Remove 2026-10-06 at 09:00" }),
  );
  expect(loadBooking().draft.slots).toHaveLength(0);
  expect(screen.getByRole("button", { name: /09:00–09:40/ })).toBeDisabled();
  view.unmount();
});

test("restored elapsed sessions remain labelled and removable alongside valid future sessions", async () => {
  vi.setSystemTime(new Date("2027-01-01T00:00:00+08:00"));
  const stale = demoSession({ date: "2026-12-31", start: "19:50" })!;
  const future = demoSession({ date: "2027-01-01", start: "09:00" })!;
  saveBooking({
    version: 2,
    draft: { ...blankDraft(), mode: "guest", slots: [stale, future] },
    attempt: null,
  });
  render(
    <BookingProvider>
      <BookingPage step="time" />
    </BookingProvider>,
  );
  await act(async () => {});
  const basket = within(screen.getByRole("complementary"));
  expect(basket.getByText(/Session has started/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(loadBooking().draft.slots).toEqual([stale, future]);
  fireEvent.click(
    screen.getByRole("button", { name: "Remove 2026-12-31 at 19:50" }),
  );
  await act(async () => {});
  expect(loadBooking().draft.slots).toEqual([future]);
  expect(basket.queryByText(/Session has started/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue" })).toBeInTheDocument();
});
test("selection rechecks time before dispatch and refreshes after a suspended tab resumes", async () => {
  vi.setSystemTime(new Date("2026-10-06T08:59:59+08:00"));
  saveBooking({
    version: 2,
    draft: { ...blankDraft(), mode: "guest" },
    attempt: null,
  });
  render(
    <BookingProvider>
      <BookingPage step="time" />
    </BookingProvider>,
  );
  await act(async () => {});
  const slot = screen.getByRole("button", { name: /09:00–09:40/ });
  expect(slot).toBeEnabled();
  // Move Date only, without delivering the scheduled UI timer.
  vi.setSystemTime(new Date("2026-10-06T09:00:00+08:00"));
  fireEvent.click(slot);
  expect(loadBooking().draft.slots).toEqual([]);
  await act(async () => {
    fireEvent.focus(window);
  });
  expect(screen.getByRole("button", { name: /09:00–09:40/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /09:00–09:40/ })).toHaveTextContent(
    "Session has started",
  );
});
test("an open calendar follows Singapore year rollover without deleting its draft", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-12-31T23:59:59.999+08:00"));
  const slot = demoSession({ date: "2027-01-01", start: "09:00" })!;
  saveBooking({
    version: 2,
    draft: { ...blankDraft(), mode: "guest", slots: [slot] },
    attempt: null,
  });
  const view = render(
    <BookingProvider>
      <BookingPage step="time" />
    </BookingProvider>,
  );
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  expect(todaySG()).toBe("2027-01-01");
  expect(
    screen.getByRole("button", { name: dateLabel("2027-01-01") }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(loadBooking().draft.slots).toEqual([slot]);
  expect(screen.getByRole("link", { name: "Continue" })).toBeInTheDocument();
  view.unmount();
});
