import ConfirmationPage from "@/app/confirmation/page";
import { BookingProvider } from "./provider";
import { liveBookingService } from "@/services/booking";
import { demoCustomerIdentity } from "@/services/demo/identity";
import { blankDraft, type Attempt } from "@/domain/booking";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ProtectedConfirmation } from "./protected-confirmation";
const first = "00000000-0000-4000-8000-000000000001",
  second = "00000000-0000-4000-8000-000000000002";
const receiptFixture = (now = Date.now()) => ({
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
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("shows checking before the protected server result and confirms only verified evidence", async () => {
  let finish!: (response: Response) => void;
  let finishReceipt!: (response: Response) => void;
  const confirmation = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const receipt = new Promise<Response>((resolve) => {
    finishReceipt = resolve;
  });
  const fetch = vi.fn((url: string) =>
    url.endsWith("/receipt") ? receipt : confirmation,
  );
  vi.stubGlobal("fetch", fetch);
  render(<ProtectedConfirmation attemptId={first} />);
  expect(
    screen.getByRole("status", { name: "Checking your payment and booking…" }),
  ).toBeInTheDocument();
  finish(Response.json({ status: "confirmed", reason: "verified" }));
  await screen.findByRole("status", { name: "Preparing your confirmation…" });
  expect(
    screen.queryByRole("heading", { name: "Booking confirmed" }),
  ).not.toBeInTheDocument();
  finishReceipt(Response.json(receiptFixture()));
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
  const receipt = receiptFixture(now + 120000);
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/receipt")
          ? ++reads === 1
            ? Response.json(receipt, {
                headers: { Date: new Date(now + 120000).toUTCString() },
              })
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams("attempt=00000000-0000-4000-8000-000000000001"),
}));
it("booking restoration does not restart a protected confirmation read", async () => {
  let finishRestore!: (attempt: Attempt | null) => void;
  const restore = vi.fn(
    () =>
      new Promise<Attempt | null>((resolve) => {
        finishRestore = resolve;
      }),
  );
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      url.endsWith("/confirmation")
        ? Response.json({ status: "confirmed", reason: "verified" })
        : new Response(null, { status: 503 }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <BookingProvider
      bookingService={{
        ...liveBookingService,
        publicCalendar: undefined,
        calendar: undefined,
        restore,
      }}
      identityService={{ ...demoCustomerIdentity, mode: "live" }}
    >
      <ConfirmationPage />
    </BookingProvider>,
  );
  expect(restore).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByRole("heading", { name: "Booking confirmed" }),
  ).toBeInTheDocument();
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith("/confirmation")),
  ).toHaveLength(1);
  await act(async () =>
    finishRestore({
      id: first,
      status: "checking",
      draft: blankDraft(),
      outcome: "pending",
      checkUntil: Date.now() + 600000,
      booking: null,
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "Booking confirmed" }),
  ).toBeInTheDocument();
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith("/confirmation")),
  ).toHaveLength(1);
});
it("failed booking restoration does not block independent protected confirmation", async () => {
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      url.endsWith("/confirmation")
        ? Response.json({ status: "confirmed", reason: "verified" })
        : new Response(null, { status: 503 }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <BookingProvider
      bookingService={{
        ...liveBookingService,
        publicCalendar: undefined,
        calendar: undefined,
        restore: async () => {
          throw new Error("synthetic restoration unavailable");
        },
      }}
      identityService={{ ...demoCustomerIdentity, mode: "live" }}
    >
      <ConfirmationPage />
    </BookingProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "Booking confirmed" }),
  ).toBeInTheDocument();
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith("/confirmation")),
  ).toHaveLength(1);
});
it("expired checking shows authenticated recorded payment without confirming or exporting stale booking evidence", async () => {
  const deadline = Date.now() - 1000;
  localStorage.setItem(
    `soccerbot-checking:${first}`,
    JSON.stringify({ deadline, next: 0, count: 1 }),
  );
  const fetch = vi.fn(async (url: string) => {
    if (!url.endsWith("/checkout"))
      throw new Error("Unexpected confirmation or receipt request");
    return Response.json({
      attemptId: first,
      mode: "live",
      checkout: { state: "unavailable" },
      payment: { status: "recorded", paidAtMs: deadline - 60000 },
      summary: {
        players: 1,
        totalMinor: 10800,
        currency: "SGD",
        sessions: [{ startMs: Date.now() + 86400000, players: 1 }],
      },
      checking: { deadlineMs: deadline, nextCheckMs: 0, pollAfterMs: 5000 },
    });
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <BookingProvider
      bookingService={{
        ...liveBookingService,
        restore: undefined,
        publicCalendar: undefined,
        calendar: undefined,
      }}
      identityService={demoCustomerIdentity}
    >
      <ConfirmationPage />
    </BookingProvider>,
  );
  expect(
    await screen.findByRole("heading", {
      name: "Payment received",
    }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Do not pay again/)).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Booking confirmed" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Open checkout/ }),
  ).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(localStorage.getItem(`soccerbot-checking:${first}`)!).deadline,
  ).toBe(deadline);
});
it("restoring a held attempt blocks background calendar work before and after restoration", async () => {
  let finish!: (attempt: Attempt) => void;
  const restore = vi.fn(
    () =>
      new Promise<Attempt>((resolve) => {
        finish = resolve;
      }),
  );
  const publicCalendar = vi.fn();
  const fetch = vi.fn(() =>
    Promise.reject(new Error("Unexpected catalogue request")),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <BookingProvider
      bookingService={{ ...liveBookingService, restore, publicCalendar }}
      identityService={{ ...demoCustomerIdentity, mode: "live" }}
    >
      <p>Restoring</p>
    </BookingProvider>,
  );
  await act(async () => {});
  expect(restore).toHaveBeenCalledTimes(1);
  expect(publicCalendar).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await act(async () =>
    finish({
      id: first,
      status: "ready",
      draft: blankDraft(),
      outcome: "pending",
      checkUntil: Date.now() + 600000,
      booking: null,
    }),
  );
  expect(publicCalendar).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("reopening an expired paid booking shows the saved full confirmation without polling or granting exports", async () => {
  const now = Date.now();
  const saved = receiptFixture(now - 3600000);
  localStorage.setItem(
    `soccerbot-checking:${first}`,
    JSON.stringify({ deadline: now - 1000, next: 0, count: 120 }),
  );
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      url.endsWith("/checkout")
        ? Response.json({
            attemptId: first,
            mode: "live",
            confirmation: saved,
            payment: { status: "recorded", paidAtMs: saved.verifiedAtMs },
            checkout: { state: "unavailable" },
            summary: {
              players: 2,
              totalMinor: 8800,
              currency: "SGD",
              sessions: [{ startMs: now + 86400000, players: 2 }],
            },
            checking: {
              deadlineMs: now - 1000,
              nextCheckMs: 0,
              pollAfterMs: 5000,
            },
          })
        : new Response(null, { status: 409 }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const page = render(
    <ProtectedConfirmation attemptId={first} checkoutMode="live" />,
  );
  await screen.findByRole("heading", { name: "Client Details" });
  expect(screen.getByText(/Saved confirmation · Verified/)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  page.unmount();
  render(<ProtectedConfirmation attemptId={first} checkoutMode="live" />);
  await screen.findByRole("heading", { name: "Client Details" });
  expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "download could not be created",
  );
  expect(fetch.mock.calls.map(([url]) => url.split("/").at(-1))).toEqual([
    "checkout",
    "checkout",
    "receipt",
  ]);

  const assign = vi.fn();
  vi.stubGlobal(
    "window",
    new Proxy(window, {
      get(target, key) {
        return key === "location"
          ? { assign }
          : Reflect.get(target, key, target);
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Make another booking" }));
  await waitFor(() =>
    expect(fetch.mock.calls.at(-1)?.[0]).toBe(`/api/attempts/${first}/dismiss`),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be closed",
  );
  expect(assign).not.toHaveBeenCalled();
  fetch.mockImplementationOnce(() =>
    Promise.resolve(Response.json({ dismissed: true })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Make another booking" }));
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith(
      expect.stringContaining("/book/account/"),
    ),
  );
  fetch.mockImplementationOnce(() =>
    Promise.resolve(Response.json({ dismissed: true })),
  );
  fireEvent.click(screen.getByRole("link", { name: "Back to home" }));
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls.at(-1)?.[0]).toBe(`/api/attempts/${first}/dismiss`);
});
