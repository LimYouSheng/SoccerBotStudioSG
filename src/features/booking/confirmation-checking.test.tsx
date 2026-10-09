import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
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
