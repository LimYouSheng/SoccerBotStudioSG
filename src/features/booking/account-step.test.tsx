import { act, render, screen } from "@testing-library/react";
import { Suspense, use, useState } from "react";
import { BookingLoadingProvider } from "./booking-loading";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { demoCustomerIdentity } from "@/services/demo/identity";
import { AccountStep } from "./account-step";
const mocks = vi.hoisted(() => ({ update: vi.fn(), push: vi.fn() }));
vi.mock("./provider", () => ({
  useBooking: () => ({
    update: mocks.update,
    identityService: demoCustomerIdentity,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.update.mockClear();
  mocks.push.mockClear();
});
test("guest selection creates a guest contact and continues to the session", async () => {
  const user = userEvent.setup();
  render(<AccountStep />);
  await user.click(screen.getByRole("button", { name: "Continue as guest" }));
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "guest", accountEmail: "" }),
  );
  expect(mocks.push).toHaveBeenCalledWith("/book/session/");
});
test("email form rejects a wrong verification code and accepts the corrected code", async () => {
  const user = userEvent.setup();
  render(<AccountStep />);
  await user.click(screen.getByRole("button", { name: "Continue with email" }));
  await user.type(screen.getByLabelText("Email address"), "demo@example.com");
  await user.click(screen.getByRole("button", { name: "Continue with email" }));
  await user.type(screen.getByLabelText("Verification code"), "000000");
  await user.click(screen.getByRole("button", { name: "Verify and continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("incorrect");
  expect(mocks.push).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("Verification code"));
  await user.type(screen.getByLabelText("Verification code"), "360360");
  await user.click(screen.getByRole("button", { name: "Verify and continue" }));
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "member",
      accountEmail: "demo@example.com",
    }),
  );
  expect(mocks.push).toHaveBeenCalledWith("/book/session/");
});
test("remember me is explicit default off and opted in preview expiry stays ninety days from verification", async () => {
  const user = userEvent.setup();
  render(<AccountStep />);
  await user.click(screen.getByRole("button", { name: "Continue with email" }));
  const remember = screen.getByRole("checkbox", {
    name: "Remember me",
  });
  expect(remember).not.toBeChecked();
  await user.click(remember);
  await user.type(
    screen.getByLabelText("Email address"),
    "remember@example.invalid",
  );
  await user.click(screen.getByRole("button", { name: "Continue with email" }));
  await user.type(screen.getByLabelText("Verification code"), "360360");
  const before = Date.now();
  await user.click(screen.getByRole("button", { name: "Verify and continue" }));
  const saved = JSON.parse(
    localStorage.getItem("soccerbot-next-demo-identity")!,
  );
  expect(saved.expiresAt).toBeGreaterThanOrEqual(before + 90 * 86400000);
  expect(saved.expiresAt).toBeLessThanOrEqual(Date.now() + 90 * 86400000);
});

test("guest loading remains until the destination commits without exposing the previous form", async () => {
  let finish!: () => void;
  const route = new Promise<void>((resolve) => {
    finish = resolve;
  });
  function Destination() {
    use(route);
    return <h1>Choose your session</h1>;
  }
  function Router() {
    const [next, setNext] = useState(false);
    mocks.push.mockImplementation(() => setNext(true));
    return (
      <BookingLoadingProvider>
        <Suspense fallback={<p>Route pending</p>}>
          {next ? <Destination /> : <AccountStep />}
        </Suspense>
      </BookingLoadingProvider>
    );
  }
  const user = userEvent.setup();
  render(<Router />);
  await user.click(screen.getByRole("button", { name: "Continue as guest" }));
  expect(
    screen.getByRole("status", { name: "Preparing your booking…" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Continue as guest" }),
  ).toBeDisabled();
  await act(async () => finish());
  expect(
    await screen.findByRole("heading", { name: "Choose your session" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Continue as guest" }),
  ).not.toBeInTheDocument();
  mocks.push.mockReset();
});
