import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AccountStep } from "./account-step";
import { BookingProvider } from "./provider";
import { demoCustomerIdentity } from "@/services/demo/identity";
import { liveBookingService } from "@/services/booking";
import type {
  CustomerIdentityService,
  CustomerChallenge,
} from "@/services/contracts";
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => navigation,
}));
test("account waits for owned guest access and duplicate click cannot navigate early", async () => {
  let finish!: () => void;
  const guest = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  navigation.push.mockClear();
  render(
    <BookingProvider identityService={{ ...demoCustomerIdentity, guest }}>
      <AccountStep />
    </BookingProvider>,
  );
  const button = screen.getByRole("button", { name: /Continue as guest/ });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(
    screen.getByRole("status", { name: "Preparing your booking…" }),
  ).toHaveClass("sr-only");
  expect(document.querySelector(".booking-flow-overlay")).toBeNull();
  expect(button.closest("[inert]")).toBeNull();
  expect(button).toHaveTextContent("Preparing your booking…");
  expect(document.querySelector(".booking-loading-inline")).toBeNull();
  expect(
    screen.getByRole("button", { name: /Continue with email/ }),
  ).toBeDisabled();
  expect(guest).toHaveBeenCalledTimes(1);
  expect(navigation.push).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(navigation.push).toHaveBeenCalledWith("/book/session/");
});
test("account leaving email challenge ignores delayed completion and live mode never displays demo code", async () => {
  let finish!: (value: CustomerChallenge) => void;
  const challenge = vi.fn(
    () =>
      new Promise<CustomerChallenge>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <BookingProvider
      identityService={{ ...demoCustomerIdentity, mode: "live", challenge }}
    >
      <AccountStep />
    </BookingProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Continue with email/ }));
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "synthetic@example.invalid" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: /Continue with email/ })
      .closest("form")!,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Back to booking options" }),
  );
  await act(async () =>
    finish({
      email: "synthetic@example.invalid",
      challengeId: "synthetic-id",
      expiresAt: Date.now() + 600000,
      resendAfter: 0,
    }),
  );
  expect(
    screen.getByRole("heading", { name: "Start your booking" }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Demo code/)).not.toBeInTheDocument();
});

test("signed-in customer manages saved contact on Account without entering unavailable booking steps", async () => {
  navigation.push.mockClear();
  const verified = {
    email: "shared@example.invalid",
    expiresAt: Date.now() + 600000,
    remember: true,
  };
  const profile = vi.fn().mockResolvedValue({
    name: "Shared Contact",
    email: verified.email,
    phone: "+65 8123 4567",
    contactMethod: "email",
    academy: "",
  });
  const saveProfile = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(verified);
  render(
    <BookingProvider
      bookingService={liveBookingService}
      identityService={{
        ...demoCustomerIdentity,
        mode: "live",
        current: () => verified,
        refresh,
        profile,
        saveProfile,
      }}
    >
      <AccountStep />
    </BookingProvider>,
  );
  const manage = await screen.findByRole("button", {
    name: "Manage saved contact",
  });
  fireEvent.click(manage);
  expect(
    await screen.findByRole("heading", { name: "Saved contact details" }),
  ).toBeInTheDocument();
  expect(profile).toHaveBeenCalledExactlyOnceWith(
    verified.email,
    expect.any(AbortSignal),
  );
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("Full name *")).toHaveValue("Shared Contact");
  expect(screen.getByLabelText("Email address (verified) *")).toHaveAttribute(
    "readonly",
  );
  expect(
    screen.queryByRole("button", { name: "Review booking" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Preferred contact/)).not.toBeInTheDocument();
  expect(saveProfile).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Full name *"), {
    target: { value: "Updated Contact" },
  });
  expect(saveProfile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save contact details" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Contact details saved",
    ),
  );
  expect(saveProfile).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ name: "Updated Contact", email: verified.email }),
    expect.any(AbortSignal),
  );
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Back to booking options" }),
  );
  expect(
    screen.getByRole("heading", { name: "Start your booking" }),
  ).toBeInTheDocument();
});
test("saved-contact entry revalidates expired identity before loading private details", async () => {
  const verified = {
    email: "expired@example.invalid",
    expiresAt: Date.now() + 600000,
    remember: true,
  };
  const refresh = vi
    .fn()
    .mockResolvedValueOnce(verified)
    .mockResolvedValueOnce(null);
  const profile = vi.fn();
  render(
    <BookingProvider
      identityService={{
        ...demoCustomerIdentity,
        current: () => verified,
        refresh,
        profile,
      }}
    >
      <AccountStep />
    </BookingProvider>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Manage saved contact" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Verify your email with Remember me selected",
  );
  expect(profile).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Manage saved contact" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Saved contact details" }),
  ).not.toBeInTheDocument();
});
test("leaving saved-contact form discards delayed save acknowledgement", async () => {
  const verified = {
    email: "saved@example.invalid",
    expiresAt: Date.now() + 600000,
    remember: true,
  };
  let finish!: () => void;
  const saveProfile = vi.fn<CustomerIdentityService["saveProfile"]>(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <BookingProvider
      identityService={{
        ...demoCustomerIdentity,
        current: () => verified,
        refresh: async () => verified,
        profile: async () => ({
          name: "Saved Contact",
          email: verified.email,
          phone: "+65 8123 4567",
          contactMethod: "email",
          academy: "",
        }),
        saveProfile,
      }}
    >
      <AccountStep />
    </BookingProvider>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Manage saved contact" }));
  await screen.findByRole("heading", { name: "Saved contact details" });
  fireEvent.click(screen.getByRole("button", { name: "Save contact details" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Back to booking options" }),
  );
  expect(saveProfile.mock.calls[0][1].aborted).toBe(true);
  await act(async () => finish());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Start your booking" }),
  ).toBeInTheDocument();
});
