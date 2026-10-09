import { ProtectedConfirmation } from "./protected-confirmation";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  renderHook,
  render,
  screen,
} from "@testing-library/react";
import { useConfirmationChecking } from "./confirmation-checking";
const id = "00000000-0000-4000-8000-000000000001";
const pending = () =>
  Response.json({ status: "pending", reason: "invoice_pending" });
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("coalesces manual and duplicate-page reads and preserves the deadline across reload", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockImplementation(async () => pending());
  vi.stubGlobal("fetch", fetch);
  const first = renderHook(() => useConfirmationChecking(id));
  await act(async () => {});
  const initial = JSON.parse(localStorage.getItem(`soccerbot-checking:${id}`)!);
  await act(async () => {
    first.result.current.check();
    first.result.current.check();
  });
  const second = renderHook(() => useConfirmationChecking(id));
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(1);
  first.unmount();
  second.unmount();
  renderHook(() => useConfirmationChecking(id));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    JSON.parse(localStorage.getItem(`soccerbot-checking:${id}`)!).deadline,
  ).toBe(initial.deadline);
});
it("pauses hidden checking and permits only one eligible foreground refresh", async () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const fetch = vi.fn().mockImplementation(async () => pending());
  vi.stubGlobal("fetch", fetch);
  renderHook(() => useConfirmationChecking(id));
  await act(async () => {});
  await act(async () => {
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("stops a hung read at the original deadline without claiming cancellation", async () => {
  vi.useFakeTimers();
  localStorage.setItem(
    `soccerbot-checking:${id}`,
    JSON.stringify({ deadline: Date.now() + 1000, next: 0, count: 0 }),
  );
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetch);
  const hook = renderHook(() => useConfirmationChecking(id));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(hook.result.current.view).toBe("unresolved");
  expect(fetch.mock.calls).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100000);
    hook.result.current.check();
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("aborts stale session reads and cannot reuse their confirmed result", async () => {
  let finish: (r: Response) => void = () => {};
  const fetch = vi.fn(
    () =>
      new Promise<Response>((r) => {
        finish = r;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const hook = renderHook(
    ({ revision }) => useConfirmationChecking(id, revision),
    { initialProps: { revision: 0 } },
  );
  const signal = (
    fetch.mock.calls as unknown as [string, { signal: AbortSignal }][]
  )[0][1].signal;
  hook.rerender({ revision: 1 });
  await act(async () => {
    finish(Response.json({ status: "confirmed", reason: "verified" }));
  });
  expect(signal.aborted).toBe(true);
  expect(hook.result.current.view).toBe("checking");
});
it("binds the server checkout deadline before a pending status read and preserves it across reload", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetch);
  const deadline = Date.now() + 590000;
  const first = renderHook(() => useConfirmationChecking(id));
  await act(async () => {
    first.result.current.bindWindow({ deadlineMs: deadline, nextCheckMs: 0 });
  });
  const saved = JSON.parse(localStorage.getItem(`soccerbot-checking:${id}`)!);
  expect(saved.deadline).toBe(deadline);
  expect(saved.count).toBe(1);
  first.unmount();
  const second = renderHook(() => useConfirmationChecking(id));
  await act(async () => {
    second.result.current.bindWindow({
      deadlineMs: deadline + 5000,
      nextCheckMs: 0,
    });
  });
  expect(JSON.parse(localStorage.getItem(`soccerbot-checking:${id}`)!)).toEqual(
    saved,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("an elapsed protected checkout window aborts checking without resetting its allowance", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetch);
  const hook = renderHook(() => useConfirmationChecking(id));
  await act(async () => {
    hook.result.current.bindWindow({ deadlineMs: Date.now(), nextCheckMs: 0 });
  });
  expect(hook.result.current.view).toBe("unresolved");
  expect(hook.result.current.busy).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20000);
    hook.result.current.check();
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(localStorage.getItem(`soccerbot-checking:${id}`)!).count,
  ).toBe(1);
});

it("hides the native payment capability at its expiry without claiming payment cancellation", async () => {
  vi.useFakeTimers();
  const now = Date.now();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path.endsWith("/checkout")
        ? Response.json({
            attemptId: id,
            mode: "live",
            checkout: {
              state: "available",
              url: "https://soccerbotstudiosg.simplybook.asia/v2/client/pay-later/id/synthetic-id/hash/synthetic-hash",
              expiresAtMs: now + 1000,
            },
            summary: {
              players: 1,
              totalMinor: 8800,
              currency: "SGD",
              sessions: [{ startMs: now + 86400000, players: 1 }],
            },
            checking: {
              deadlineMs: now + 60000,
              nextCheckMs: 0,
              pollAfterMs: 5000,
            },
          })
        : pending(),
    ),
  );
  render(<ProtectedConfirmation attemptId={id} checkoutMode="live" />);
  await act(async () => {});
  expect(screen.getByRole("link", { name: "Open checkout" })).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(
    screen.queryByRole("link", { name: "Open checkout" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Checking your payment and booking…" }),
  ).toBeVisible();
});
