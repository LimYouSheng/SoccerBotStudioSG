import { render, screen } from "@testing-library/react";
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
    name: "Remember me on this device for 90 days.",
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
