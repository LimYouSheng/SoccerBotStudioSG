import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { blankDraft } from "@/domain/booking";
import { addDays, todaySG } from "@/domain/dates";
import { TimeStep } from "./time-step";
import { Summary } from "./summary";
import { ReviewStep } from "./review-step";
import { BookingProvider } from "./provider";
import { demoSession } from "@/services/demo/schedule";
import { ConfirmationStep } from "./confirmation-step";
import { demoBookingService } from "@/services/demo/booking";
import { loadBooking, saveBooking } from "@/services/storage";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  const draft = {
    ...blankDraft(),
    mode: "guest" as const,
    slots: [
      demoSession({
        date: Array.from({ length: 7 }, (_, i) =>
          addDays(todaySG(), i + 1),
        ).find((date) => new Date(`${date}T12:00:00Z`).getUTCDay() === 2)!,
        start: "11:30",
      })!,
    ],
  };
  saveBooking({ version: 2, draft, attempt: null });
});
test("selecting and removing sessions automatically accumulates unique instructors and enables Continue", async () => {
  const user = userEvent.setup();
  render(
    <BookingProvider>
      <TimeStep />
      <Summary basket />
    </BookingProvider>,
  );
  const crossing = screen.getByRole("button", { name: /11:30–12:10/ });
  expect(crossing).toHaveTextContent("Faisal Shahril");
  expect(crossing).toHaveTextContent("Crosses the 12:00 instructor rotation");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue" })).toBeInTheDocument();
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
test("crossing notices persist in the basket and review before payment", () => {
  const basket = render(
    <BookingProvider>
      <Summary basket />
    </BookingProvider>,
  );
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

test("confirmation shows each contact and location once with all five sections expanded", () => {
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
  const checking = demoBookingService.pay(
    demoBookingService.checkout(draft, null),
    "success",
  );
  const attempt = demoBookingService.resolve(checking, checking.checkUntil);
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
