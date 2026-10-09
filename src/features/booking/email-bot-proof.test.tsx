import { render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EmailBotProof } from "./email-bot-proof";
vi.mock("next/script", () => ({
  default: ({ onReady }: { onReady: () => void }) => (
    <button onClick={onReady}>Load synthetic widget</button>
  ),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  delete window.turnstile;
});
it("email bot widget is unavailable without a bound public sitekey", () => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
  render(<EmailBotProof onToken={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("not available");
  expect(screen.queryByText("Load synthetic widget")).toBeNull();
});
it("email bot widget binds purpose clears expired proof and ignores callbacks after disposal", async () => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "synthetic-public-sitekey");
  const renderWidget = vi.fn().mockReturnValue("synthetic-widget"),
    remove = vi.fn(),
    token = vi.fn();
  window.turnstile = { render: renderWidget, remove };
  const mounted = render(<EmailBotProof onToken={token} />);
  await act(async () => screen.getByText("Load synthetic widget").click());
  await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
  const options = renderWidget.mock.calls[0][1];
  expect(options).toMatchObject({
    sitekey: "synthetic-public-sitekey",
    action: "verify-email",
  });
  options.callback("proof");
  options["expired-callback"]();
  expect(token.mock.calls).toEqual([["proof"], [""]]);
  mounted.unmount();
  expect(remove).toHaveBeenCalledWith("synthetic-widget");
  options.callback("stale");
  expect(token).toHaveBeenCalledTimes(2);
});
