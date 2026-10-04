import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Assistant } from "./assistant";

vi.mock("@/features/booking/provider", () => ({
  useBooking: () => ({ attempt: null }),
}));

test("Escape closes the assistant after a touch reply leaves focus outside the panel", async () => {
  const user = userEvent.setup();
  render(<Assistant />);
  const launcher = screen.getByRole("button", {
    name: "Open studio assistant",
  });
  await user.click(launcher);
  const input = screen.getByLabelText("Ask the studio assistant");
  expect(input).toHaveFocus();

  // Touch WebKit can blur the input without focusing the clicked reply button.
  input.blur();
  fireEvent.click(screen.getByRole("button", { name: "Sessions & prices" }));
  expect(screen.getByRole("log")).toHaveTextContent("S$88");
  expect(document.body).toHaveFocus();
  fireEvent.keyDown(document.body, { key: "Escape" });

  expect(
    screen.queryByRole("heading", { name: "Studio assistant" }),
  ).toBeNull();
  expect(launcher).toHaveAttribute("aria-expanded", "false");
  expect(launcher).toHaveAccessibleName("Open studio assistant");
  expect(launcher).toHaveFocus();
});

test("the assistant stops handling Escape when closed or unmounted", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<Assistant />);
  await user.click(
    screen.getByRole("button", { name: "Open studio assistant" }),
  );
  const closeEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  fireEvent(document.body, closeEvent);
  expect(closeEvent.defaultPrevented).toBe(true);
  expect(
    screen.getByRole("button", { name: "Open studio assistant" }),
  ).toHaveFocus();

  const closedEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    cancelable: true,
  });
  fireEvent(document, closedEvent);
  expect(closedEvent.defaultPrevented).toBe(false);
  await user.click(
    screen.getByRole("button", { name: "Open studio assistant" }),
  );
  unmount();
  const unmountedEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    cancelable: true,
  });
  fireEvent(document, unmountedEvent);
  expect(unmountedEvent.defaultPrevented).toBe(false);
});
