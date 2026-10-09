import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { CustomerCatalogue } from "@/domain/catalog";
import { LiveCatalogue } from "./live-catalogue";
function catalogue(name = "Current provider session"): CustomerCatalogue {
  return {
    environment: "developer",
    observedAtMs: Date.now(),
    complete: true,
    services: [
      {
        id: "12",
        name,
        active: true,
        durationMinutes: 40,
        recurring: false,
        priceMinor: 9100,
        currency: "SGD",
        instructorIds: ["14"],
      },
    ],
    instructors: [
      { id: "14", name: "Current provider instructor", active: true },
    ],
  };
}
test("live catalogue displays mutable provider labels and empty failure states without Preview records", async () => {
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce(catalogue());
  render(<LiveCatalogue service={{ read }} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
  expect(screen.queryByText("Faisal Shahril")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByText("Current provider session"),
  ).toBeInTheDocument();
  expect(screen.getByText("Current provider instructor")).toBeInTheDocument();
  expect(
    screen.getByText(/Online booking is not available yet/),
  ).toBeInTheDocument();
});
test("live catalogue discards delayed previous service replies after environment composition changes", async () => {
  let finish!: (value: CustomerCatalogue) => void;
  const first = {
    read: vi.fn(
      () =>
        new Promise<CustomerCatalogue>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  const next = {
    read: vi
      .fn()
      .mockResolvedValue({ ...catalogue(), services: [], instructors: [] }),
  };
  const view = render(<LiveCatalogue service={first} />);
  view.rerender(<LiveCatalogue service={next} />);
  expect(
    await screen.findByText("No sessions are currently available."),
  ).toBeInTheDocument();
  await act(async () => finish(catalogue("Stale provider session")));
  expect(screen.queryByText("Stale provider session")).not.toBeInTheDocument();
});
