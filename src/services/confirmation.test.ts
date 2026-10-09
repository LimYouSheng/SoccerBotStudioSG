import { afterEach, expect, it, vi } from "vitest";
import { protectedCheckoutService } from "./confirmation";
const id = "00000000-0000-4000-8000-000000000001";
const context = {
  attemptId: id,
  mode: "synthetic",
  checkout: { state: "available", url: `/__experiment/checkout/${id}` },
  summary: {
    players: 2,
    totalMinor: 8800,
    currency: "SGD",
    sessions: [{ startMs: 1, players: 2 }],
  },
  checking: { deadlineMs: 999999, nextCheckMs: 0, pollAfterMs: 5000 },
};
const read = (mode: "synthetic" | "live" = "synthetic") =>
  protectedCheckoutService.context({
    attemptId: id,
    mode,
    signal: new AbortController().signal,
  });
afterEach(() => vi.unstubAllGlobals());
it("accepts only the protected synthetic checkout bound to the requested attempt", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(context));
  vi.stubGlobal("fetch", fetch);
  expect((await read()).checkout).toEqual(context.checkout);
  for (const url of [
    "https://evil.example/pay",
    "http://pay.example",
    "//evil.example",
    "/__experiment/checkout/other",
    context.checkout.url + "?paid=true",
  ]) {
    fetch.mockResolvedValue(
      Response.json({ ...context, checkout: { state: "available", url } }),
    );
    await expect(read()).rejects.toThrow();
  }
  fetch.mockResolvedValue(
    Response.json({
      ...context,
      attemptId: "00000000-0000-4000-8000-000000000002",
    }),
  );
  await expect(read()).rejects.toThrow();
});
it("keeps unsupported live checkout unavailable without synthetic fallback", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      ...context,
      mode: "live",
      checkout: { state: "unavailable" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect((await read("live")).checkout.state).toBe("unavailable");
  fetch.mockResolvedValue(Response.json({ ...context, mode: "live" }));
  await expect(read("live")).rejects.toThrow();
  fetch.mockResolvedValue(Response.json(context));
  await expect(read("live")).rejects.toThrow();
});
