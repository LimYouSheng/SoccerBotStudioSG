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
  vi.useRealTimers();
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
    screen.getByRole("status", { name: "Verifying your payment…" }),
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
    await screen.findByRole("heading", { name: "Payment status unresolved" }),
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
    ...receiptFixture(now + 120000),
    providerReferences: {
      bookingIds: ["701"],
      invoiceId: "901",
    },
  };
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
  fireEvent.click(await screen.findByText("View full details"));
  expect(
    await screen.findByRole("heading", { name: "Client Details" }),
  ).toBeInTheDocument();
  for (const name of ["Session Details", "Location", "Amount", "Disclaimers"])
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  expect(screen.getByText("Native Trainer")).toBeInTheDocument();
  expect(screen.getByText("701")).toBeInTheDocument();
  expect(screen.getByText("901")).toBeInTheDocument();
  expect(screen.getByText(/SoccerBot reference/)).toHaveTextContent(first);
  expect(screen.queryByText("Paid · Preview")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "download could not be created",
  );
  expect(reads).toBe(2);
});

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => navigation,
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
    if (url.endsWith("/confirmation"))
      return Response.json({
        status: "unresolved",
        reason: "payment_received_booking_pending",
      });
    if (!url.endsWith("/checkout"))
      throw new Error("Unexpected receipt request");
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
  expect(fetch).toHaveBeenCalledTimes(2);
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
  fireEvent.click(await screen.findByText("View full details"));
  await screen.findByRole("heading", { name: "Client Details" });
  expect(screen.getByText(/Saved confirmation · Verified/)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  page.unmount();
  render(<ProtectedConfirmation attemptId={first} checkoutMode="live" />);
  fireEvent.click(await screen.findByText("View full details"));
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

it("pending checkout context retains preparation status and exposes no checkout or confirmation", async () => {
  let finish!: (response: Response) => void;
  const context = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetch = vi.fn((url: string) =>
    url.endsWith("/checkout")
      ? context
      : Promise.resolve(
          Response.json({ status: "pending", reason: "missing_evidence" }),
        ),
  );
  vi.stubGlobal("fetch", fetch);
  render(<ProtectedConfirmation attemptId={first} checkoutMode="live" />);
  expect(
    screen.getByRole("status", { name: "Preparing checkout…" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /Open checkout/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Booking confirmed" }),
  ).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(
    Response.json({
      attemptId: first,
      mode: "live",
      checkout: { state: "unavailable" },
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
    }),
  );
  expect(
    await screen.findByRole("region", { name: "Current booking summary" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /Open checkout/ }),
  ).not.toBeInTheDocument();
});

it("pending confirmation retains the final detail layout while hiding success and every action", async () => {
  const receipt = receiptFixture();
  const details = { ...receipt };
  Reflect.deleteProperty(details, "verifiedAtMs");
  let complete!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.endsWith("/checkout"))
        return Promise.resolve(
          Response.json({
            attemptId: first,
            mode: "live",
            details,
            checkout: { state: "unavailable" },
            summary: {
              players: 2,
              totalMinor: 8800,
              currency: "SGD",
              sessions: [{ startMs: details.sessions[0].startMs, players: 2 }],
            },
            checking: {
              deadlineMs: Date.now() + 600000,
              nextCheckMs: 0,
              pollAfterMs: 5000,
            },
          }),
        );
      return url.endsWith("/receipt")
        ? Promise.resolve(Response.json(receipt))
        : pending;
    }),
  );
  render(<ProtectedConfirmation attemptId={first} checkoutMode="live" />);
  fireEvent.click(await screen.findByText("View full details"));
  await screen.findByRole("heading", { name: "Client Details" });
  expect(
    screen.getByText(
      "Please don’t close or refresh this page while we finish.",
    ),
  ).toBeVisible();
  expect(screen.getByText("Verifying your payment…")).toBeVisible();
  const card = document.querySelector(".confirmation-card");
  expect(document.querySelector(".booking-loading")).toBeNull();
  expect(
    document.querySelector(".booking-loading-inline .page-loading-orbit"),
  ).not.toBeNull();
  for (const name of ["Session Details", "Location", "Amount", "Disclaimers"])
    expect(screen.getByRole("heading", { name })).toBeVisible();
  expect(screen.getByText("Synthetic Customer")).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Verifying your payment…" }),
  ).toBeVisible();
  expect(screen.queryByText("Paid", { exact: true })).toBeNull();
  expect(screen.queryByLabelText("Booking actions")).toBeNull();
  expect(screen.queryByRole("link", { name: "Back to home" })).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "Booking confirmed" }),
  ).toBeNull();
  await act(async () =>
    complete(Response.json({ status: "confirmed", reason: "verified" })),
  );
  await screen.findByRole("heading", { name: "Booking confirmed" });
  expect(document.querySelector(".confirmation-card")).toBe(card);
  expect(screen.getByLabelText("Booking actions")).toBeVisible();
  expect(screen.getByRole("link", { name: "Back to home" })).toBeVisible();
});

it("Back to home starts the shared background exit and navigates without awaiting dismissal", async () => {
  const receipt = receiptFixture();
  const restart = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        attemptId: first,
        mode: "live",
        confirmation: receipt,
        checkout: { state: "unavailable" },
        summary: {
          players: 2,
          totalMinor: 8800,
          currency: "SGD",
          sessions: [{ startMs: receipt.sessions[0].startMs, players: 2 }],
        },
        checking: {
          deadlineMs: Date.now() + 600000,
          nextCheckMs: 0,
          pollAfterMs: 5000,
        },
      }),
    ),
  );
  render(
    <ProtectedConfirmation
      attemptId={first}
      checkoutMode="live"
      onRestart={restart}
    />,
  );
  await screen.findByRole("heading", { name: "Booking confirmed" });
  fireEvent.click(screen.getByRole("link", { name: "Back to home" }));
  expect(restart).toHaveBeenCalledWith(first);
  expect(navigation.push).toHaveBeenCalledWith("/");
});

it("verified payment shows confirmation before reconciliation and only the requested download waits", async () => {
  const proof = receiptFixture();
  let finish!: (value: Response) => void;
  const verification = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      url.endsWith("/checkout")
        ? Response.json({
            attemptId: first,
            mode: "live",
            customerConfirmation: proof,
            details: Object.fromEntries(
              Object.entries(proof).filter(([key]) => key !== "verifiedAtMs"),
            ),
            checkout: { state: "unavailable" },
            summary: {
              players: 2,
              totalMinor: 8800,
              currency: "SGD",
              sessions: [{ startMs: proof.sessions[0].startMs, players: 2 }],
            },
            checking: {
              deadlineMs: Date.now() + 600000,
              nextCheckMs: 0,
              pollAfterMs: 5000,
            },
          })
        : url.endsWith("/receipt")
          ? Response.json({ error: "receipt_not_verified" }, { status: 409 })
          : verification,
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(<ProtectedConfirmation attemptId={first} checkoutMode="live" />);
  await screen.findByRole("heading", { name: "Booking confirmed" });
  expect(screen.getByText("Paid", { exact: true })).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Download booking details" }),
  );
  await screen.findByRole("status", { name: "Preparing download…" });
  expect(
    screen.getByRole("heading", { name: "Booking confirmed" }),
  ).toBeVisible();
  expect(
    document.querySelector(".booking-flow-overlay, .page-loading"),
  ).toBeNull();
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith("/receipt")),
  ).toHaveLength(0);
  await act(async () =>
    finish(Response.json({ status: "confirmed", reason: "verified" })),
  );
  await screen.findByRole("alert");
  expect(
    screen.getByRole("heading", { name: "Booking confirmed" }),
  ).toBeVisible();
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith("/receipt")),
  ).toHaveLength(1);
});

it("manual review supersedes an earlier customer confirmation without exposing downloads", async () => {
  const proof = receiptFixture();
  let finish!: (value: Response) => void;
  const verification = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      url.endsWith("/checkout")
        ? Response.json({
            attemptId: first,
            mode: "live",
            customerConfirmation: proof,
            details: Object.fromEntries(
              Object.entries(proof).filter(([key]) => key !== "verifiedAtMs"),
            ),
            checkout: { state: "unavailable" },
            summary: {
              players: 2,
              totalMinor: 8800,
              currency: "SGD",
              sessions: [{ startMs: proof.sessions[0].startMs, players: 2 }],
            },
            checking: {
              deadlineMs: Date.now() + 600000,
              nextCheckMs: 0,
              pollAfterMs: 5000,
            },
          })
        : url.endsWith("/receipt")
          ? Response.json({ error: "receipt_not_verified" }, { status: 409 })
          : verification,
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(<ProtectedConfirmation attemptId={first} checkoutMode="live" />);
  await screen.findByRole("heading", { name: "Booking confirmed" });
  await act(async () =>
    finish(
      Response.json({
        status: "unresolved",
        reason: "payment_received_booking_pending",
      }),
    ),
  );
  await screen.findByRole("heading", {
    name: "Payment received; booking confirmation pending",
  });
  expect(
    screen.queryByRole("heading", { name: "Booking confirmed" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Download booking details" }),
  ).toBeNull();
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith("/receipt")),
  ).toHaveLength(0);
});

it("authoritative unpaid expiry releases the original attempt before returning to the calendar", async () => {
  const proof = receiptFixture();
  const onExpired = vi.fn();
  let release!: (value: Response) => void;
  const released = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn((url: string) =>
    url.endsWith("/expire")
      ? released
      : Promise.resolve(
          Response.json(
            url.endsWith("/checkout")
              ? {
                  attemptId: first,
                  mode: "live",
                  expired: true,
                  details: Object.fromEntries(
                    Object.entries(proof).filter(
                      ([key]) => key !== "verifiedAtMs",
                    ),
                  ),
                  checkout: { state: "unavailable" },
                  summary: {
                    players: 2,
                    totalMinor: 8800,
                    currency: "SGD",
                    sessions: [
                      { startMs: proof.sessions[0].startMs, players: 2 },
                    ],
                  },
                  checking: {
                    deadlineMs: Date.now() + 600000,
                    nextCheckMs: 0,
                    pollAfterMs: 5000,
                  },
                }
              : { status: "pending", reason: "payment_verification_pending" },
          ),
        ),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <ProtectedConfirmation
      attemptId={first}
      checkoutMode="live"
      onExpired={onExpired}
    />,
  );
  await waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/expire"))).toBe(
      true,
    ),
  );
  expect(onExpired).not.toHaveBeenCalled();
  await act(async () => release(Response.json({ expired: true })));
  expect(onExpired).toHaveBeenCalledExactlyOnceWith(first);
  expect(navigation.replace).toHaveBeenCalledWith("/book/time/");
});

it("poll-confirmed payment retains its displayed proof while the final receipt is delayed", async () => {
  vi.useFakeTimers();
  const proof = receiptFixture();
  let finishReceipt!: (response: Response) => void;
  const receipt = new Promise<Response>((resolve) => {
    finishReceipt = resolve;
  });
  let polls = 0;
  const fetch = vi.fn((url: string) =>
    url.endsWith("/receipt")
      ? receipt
      : Promise.resolve(
          Response.json(
            ++polls === 1
              ? {
                  status: "pending",
                  reason: "payment_received_booking_pending",
                  customerConfirmation: proof,
                }
              : { status: "confirmed", reason: "verified" },
          ),
        ),
  );
  vi.stubGlobal("fetch", fetch);
  render(<ProtectedConfirmation attemptId={first} />);
  await act(async () => {});
  const heading = screen.getByRole("heading", { name: "Booking confirmed" });
  const verified = screen.getByText(/Saved confirmation/).textContent;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith("/receipt")),
  ).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Booking confirmed" })).toBe(
    heading,
  );
  expect(
    screen.queryByRole("status", { name: "Preparing your confirmation…" }),
  ).toBeNull();
  expect(
    screen.queryByText(
      "Please don’t close or refresh this page while we finish.",
    ),
  ).toBeNull();
  expect(screen.getByText(/Saved confirmation/).textContent).toBe(verified);
  await act(async () => {
    finishReceipt(Response.json(proof));
  });
  expect(screen.getByRole("heading", { name: "Booking confirmed" })).toBe(
    heading,
  );
  expect(screen.getByText(/Saved confirmation/).textContent).toBe(verified);
});

it("retains verified customer confirmation across pending responses that omit proof", async () => {
  vi.useFakeTimers();
  const proof = receiptFixture();
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        ++reads === 1
          ? {
              status: "pending",
              reason: "payment_received_booking_pending",
              customerConfirmation: proof,
            }
          : { status: "pending", reason: "payment_received_booking_pending" },
      ),
    ),
  );
  render(<ProtectedConfirmation attemptId={first} />);
  await act(async () => {});
  expect(
    screen.getByRole("heading", { name: "Booking confirmed" }),
  ).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(reads).toBeGreaterThan(1);
  expect(
    screen.getByRole("heading", { name: "Booking confirmed" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("status", { name: "Verifying your payment…" }),
  ).toBeNull();
});
