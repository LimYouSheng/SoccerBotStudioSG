import { afterEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ProtectedConfirmation } from "./protected-confirmation";
const first = "00000000-0000-4000-8000-000000000001",
  second = "00000000-0000-4000-8000-000000000002";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("shows checking before the protected server result and confirms only verified evidence", async () => {
  let finish: (response: Response) => void = () => {};
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  render(<ProtectedConfirmation attemptId={first} />);
  expect(
    screen.getByRole("heading", { name: "Checking your payment and booking…" }),
  ).toBeInTheDocument();
  finish(Response.json({ status: "confirmed", reason: "verified" }));
  expect(
    await screen.findByRole("heading", { name: "Booking confirmed" }),
  ).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(
    `/api/attempts/${first}/confirmation`,
    expect.objectContaining({
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    }),
  );
});
it("denied and malformed responses cannot show confirmation or protected details", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({ status: "confirmed", reason: "browser-return" }),
    );
  vi.stubGlobal("fetch", fetch);
  const view = render(<ProtectedConfirmation attemptId={first} />);
  expect(
    await screen.findByRole("heading", { name: "Confirmation unavailable" }),
  ).toBeInTheDocument();
  fetch.mockResolvedValue(new Response(null, { status: 401 }));
  view.rerender(<ProtectedConfirmation attemptId={second} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(
    await screen.findByRole("heading", { name: "Confirmation unavailable" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Booking confirmed" }),
  ).not.toBeInTheDocument();
});
it("a late reply from a previous attempt cannot confirm the current attempt", async () => {
  let finishFirst: (response: Response) => void = () => {};
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockResolvedValue(
      Response.json({ status: "unresolved", reason: "paid_booking_invalid" }),
    );
  vi.stubGlobal("fetch", fetch);
  const view = render(<ProtectedConfirmation attemptId={first} />);
  view.rerender(<ProtectedConfirmation attemptId={second} />);
  expect(
    await screen.findByRole("heading", { name: "Your booking needs review" }),
  ).toBeInTheDocument();
  finishFirst(Response.json({ status: "confirmed", reason: "verified" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Booking confirmed" }),
    ).not.toBeInTheDocument(),
  );
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});
it("temporary checking failure preserves the protected summary and repeat checkout uses the same link", async () => {
  const context = {
    attemptId: first,
    mode: "synthetic",
    checkout: { state: "available", url: `/__experiment/checkout/${first}` },
    summary: {
      players: 2,
      totalMinor: 8800,
      currency: "SGD",
      sessions: [{ startMs: 1, players: 2 }],
    },
    checking: {
      deadlineMs: Date.now() + 600000,
      nextCheckMs: 0,
      pollAfterMs: 5000,
    },
  };
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      url.endsWith("/checkout")
        ? Response.json(context)
        : new Response(null, { status: 503 }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(<ProtectedConfirmation attemptId={first} checkoutMode="synthetic" />);
  await screen.findByRole("heading", { name: "Confirmation unavailable" });
  const link = await screen.findByRole("link", {
    name: "Open checkout",
  });
  expect(link).toHaveAttribute("href", context.checkout.url);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(
    screen.getByRole("region", { name: "Current booking summary" }),
  ).toHaveTextContent("2 players");
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.click(link);
  expect(
    screen.getByRole("link", { name: "Open checkout again" }),
  ).toHaveAttribute("href", context.checkout.url);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("access denial hides a previously loaded checkout context", async () => {
  const context = {
    attemptId: first,
    mode: "synthetic",
    checkout: { state: "available", url: `/__experiment/checkout/${first}` },
    summary: {
      players: 2,
      totalMinor: 8800,
      currency: "SGD",
      sessions: [{ startMs: 1, players: 2 }],
    },
    checking: {
      deadlineMs: Date.now() + 600000,
      nextCheckMs: 0,
      pollAfterMs: 5000,
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/checkout")
          ? Response.json(context)
          : new Response(null, { status: 401 }),
      ),
    ),
  );
  render(<ProtectedConfirmation attemptId={first} checkoutMode="synthetic" />);
  await screen.findByText(/access has expired or was revoked/);
  expect(
    screen.queryByRole("region", { name: "Current booking summary" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Open checkout/ }),
  ).not.toBeInTheDocument();
});

it("verified live receipt uses demo sections and refuses exports after access is revoked", async () => {
  const now = Date.now();
  const receipt = {
    attemptId: first,
    verifiedAtMs: now,
    createdAtMs: now,
    totalMinor: 8800,
    taxMinor: 0,
    contact: {
      name: "Synthetic Customer",
      email: "synthetic@example.com",
      phone: "+6591234567",
      contactMethod: "email",
      academy: "",
    },
    sessions: [
      {
        serviceId: "12",
        serviceName: "Native Session",
        instructorId: "14",
        instructorName: "Native Trainer",
        startMs: now + 86400000,
        priceMinor: 8800,
        currency: "SGD",
        players: 2,
      },
    ],
  };
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/receipt")
          ? ++reads === 1
            ? Response.json(receipt)
            : new Response(null, { status: 401 })
          : Response.json({ status: "confirmed", reason: "verified" }),
      ),
    ),
  );
  render(<ProtectedConfirmation attemptId={first} />);
  expect(
    await screen.findByRole("heading", { name: "Client Details" }),
  ).toBeInTheDocument();
  for (const name of ["Session Details", "Location", "Amount", "Disclaimers"])
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  expect(screen.getByText("Native Trainer")).toBeInTheDocument();
  expect(screen.queryByText("Paid · Preview")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "download could not be created",
  );
  expect(reads).toBe(2);
});
