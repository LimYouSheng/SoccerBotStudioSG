import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { BookingProvider, useBooking } from "./provider";
import { DetailsStep } from "./details-step";
import { demoCustomerIdentity } from "@/services/demo/identity";
import type { CustomerIdentityService } from "@/services/contracts";

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

test("verified details saves only on explicit action and ignores completion after editing", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  const saveProfile = vi.fn<CustomerIdentityService["saveProfile"]>(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const identity = {
    ...demoCustomerIdentity,
    current: () => ({
      email: "shared@example.invalid",
      expiresAt: Date.now() + 600000,
      remember: true,
    }),
    saveProfile,
  };
  function ChooseMember() {
    const { update } = useBooking();
    return (
      <button
        onClick={() =>
          update({
            mode: "member",
            accountEmail: "shared@example.invalid",
            contact: {
              name: "First Contact",
              email: "shared@example.invalid",
              phone: "+65 8123 4567",
              contactMethod: "email",
              academy: "",
            },
          })
        }
      >
        Choose member
      </button>
    );
  }
  render(
    <BookingProvider identityService={identity}>
      <ChooseMember />
      <DetailsStep />
    </BookingProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Choose member" }));
  expect(saveProfile).not.toHaveBeenCalled();
  expect(
    screen.getByText(/Anyone using this verified email shares/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review booking" }));
  expect(saveProfile).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Saving details…" }),
  ).toBeDisabled();
  await user.type(screen.getByLabelText(/Full name/), " Edited");
  expect(saveProfile.mock.calls[0][1].aborted).toBe(true);
  await act(async () => finish());
  expect(
    screen.queryByText("Contact details saved for your next visit."),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Full name/)).toHaveValue(
    "First Contact Edited",
  );
  expect(mocks.push).not.toHaveBeenCalled();
});
test("verified details reports an explicit save and retains editable contact on failure", async () => {
  const user = userEvent.setup();
  const saveProfile = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("unavailable"));
  function ChooseMember() {
    const { update } = useBooking();
    return (
      <button
        onClick={() =>
          update({
            mode: "member",
            accountEmail: "shared@example.invalid",
            contact: {
              name: "Shared Contact",
              email: "shared@example.invalid",
              phone: "+65 8123 4567",
              contactMethod: "email",
              academy: "",
            },
          })
        }
      >
        Choose member
      </button>
    );
  }
  render(
    <BookingProvider
      identityService={{
        ...demoCustomerIdentity,
        current: () => ({
          email: "shared@example.invalid",
          expiresAt: Date.now() + 600000,
          remember: true,
        }),
        saveProfile,
      }}
    >
      <ChooseMember />
      <DetailsStep />
    </BookingProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Choose member" }));
  await user.click(screen.getByRole("button", { name: "Review booking" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Contact details saved for your next visit.",
  );
  await user.click(screen.getByRole("button", { name: "Review booking" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "could not be saved",
  );
  expect(screen.getByLabelText(/Full name/)).toHaveValue("Shared Contact");
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/book/review/");
});

test("verified opt-out details submit without saving a contact profile", async () => {
  const user = userEvent.setup(),
    saveProfile = vi.fn();
  function ChooseMember() {
    const { update } = useBooking();
    return (
      <button
        onClick={() =>
          update({
            mode: "member",
            accountEmail: "shared@example.invalid",
            contact: {
              name: "Booking Only",
              email: "shared@example.invalid",
              phone: "+65 8123 4567",
              contactMethod: "email",
              academy: "",
            },
          })
        }
      >
        Choose member
      </button>
    );
  }
  render(
    <BookingProvider
      identityService={{
        ...demoCustomerIdentity,
        current: () => ({
          email: "shared@example.invalid",
          expiresAt: Date.now() + 600000,
          remember: false,
        }),
        saveProfile,
      }}
    >
      <ChooseMember />
      <DetailsStep />
    </BookingProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Choose member" }));
  expect(
    screen.queryByRole("button", { name: "Save contact details" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review booking" }));
  expect(saveProfile).not.toHaveBeenCalled();
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/book/review/");
});
