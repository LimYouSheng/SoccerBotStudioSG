import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { BookingProvider } from "./provider";
import { DetailsStep } from "./details-step";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.push.mockClear();
});

test("child details use guardian labels and require a guardian relationship before review", async () => {
  const user = userEvent.setup();
  render(
    <BookingProvider>
      <DetailsStep />
    </BookingProvider>,
  );
  await user.type(screen.getByLabelText(/Full name/), "Demo Customer");
  await user.type(
    screen.getByLabelText(/Email address/),
    "customer@example.com",
  );
  await user.type(screen.getByLabelText(/Mobile number/), "+65 8123 4567");
  await user.selectOptions(
    screen.getByLabelText(/Participant age group/),
    "child",
  );
  await user.selectOptions(screen.getByLabelText(/Football experience/), "new");
  expect(screen.queryByLabelText(/Emergency contact name/)).toBeNull();
  await user.type(
    screen.getByLabelText(/Parent \/ guardian name/),
    "Guardian Person",
  );
  await user.type(
    screen.getByLabelText(/Parent \/ guardian mobile/),
    "+65 9123 4567",
  );
  await user.click(screen.getByRole("button", { name: "Review booking" }));
  const relationship = screen.getByLabelText(/Emergency contact relationship/);
  expect(relationship).toHaveFocus();
  expect(relationship).toHaveAttribute("aria-invalid", "true");
  expect(mocks.push).not.toHaveBeenCalled();
  await user.selectOptions(relationship, "guardian");
  await user.click(screen.getByRole("button", { name: "Review booking" }));
  expect(mocks.push).toHaveBeenCalledWith("/book/review/");
});
