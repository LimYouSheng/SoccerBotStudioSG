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

test("details contains only the five contact fields and validates them before review", async () => {
  const user = userEvent.setup();
  render(
    <BookingProvider>
      <DetailsStep />
    </BookingProvider>,
  );
  expect(screen.getAllByRole("textbox")).toHaveLength(4);
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review booking" }));
  expect(screen.getByLabelText(/Full name/)).toHaveFocus();
  expect(mocks.push).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText(/Full name/), "Demo Customer");
  await user.type(
    screen.getByLabelText(/Email address/),
    "customer@example.com",
  );
  await user.type(screen.getByLabelText(/Mobile number/), "+65 8123 4567");
  await user.selectOptions(
    screen.getByLabelText(/Preferred contact method/),
    "whatsapp",
  );
  await user.type(screen.getByLabelText(/Academy \/ school/), "Demo Academy");
  await user.click(screen.getByRole("button", { name: "Review booking" }));
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/book/review/");
});
