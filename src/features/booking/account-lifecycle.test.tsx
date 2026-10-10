import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AccountStep } from "./account-step";
import { BookingProvider } from "./provider";
import { demoCustomerIdentity } from "@/services/demo/identity";
import type { CustomerChallenge } from "@/services/contracts";
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
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
