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

it("accepts only the backend-issued native path for the matching protected attempt", async () => {
  const expiresAtMs = Date.now() + 60000;
  const url =
    "https://soccerbotstudiosg.simplybook.asia/v2/client/pay-later/id/synthetic-id/hash/synthetic-hash";
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      ...context,
      mode: "live",
      checking: { ...context.checking, deadlineMs: Date.now() + 120000 },
      checkout: { state: "available", url, expiresAtMs },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect((await read("live")).checkout).toEqual({
    state: "available",
    url,
    expiresAtMs,
  });
  for (const invalid of [
    url + "?redirect=evil",
    url + "\n",
    url.replace("securecheckout.", "checkout.") + "\n",
    url + "#paid",
    url.replace(".asia", ".asia.evil.test"),
    url.replace("https:", "http:"),
    url.replace("/hash/", "/other/"),
    url.replace("/id/", "/id/%2f"),
  ]) {
    fetch.mockResolvedValue(
      Response.json({
        ...context,
        mode: "live",
        checking: { ...context.checking, deadlineMs: Date.now() + 120000 },
        checkout: { state: "available", url: invalid, expiresAtMs },
      }),
    );
    await expect(read("live")).rejects.toThrow();
  }
  for (const expiry of [undefined, Date.now() - 1, Date.now() + 180000]) {
    fetch.mockResolvedValue(
      Response.json({
        ...context,
        mode: "live",
        checking: { ...context.checking, deadlineMs: Date.now() + 120000 },
        checkout: { state: "available", url, expiresAtMs: expiry },
      }),
    );
    await expect(read("live")).rejects.toThrow();
  }
  fetch.mockResolvedValue(
    Response.json({
      ...context,
      attemptId: "00000000-0000-4000-8000-000000000002",
      mode: "live",
      checking: { ...context.checking, deadlineMs: Date.now() + 120000 },
      checkout: { state: "available", url, expiresAtMs },
    }),
  );
  await expect(read("live")).rejects.toThrow();
});

it("accepts only a bounded protected HitPay sandbox checkout URL", async () => {
  const url = `https://securecheckout.sandbox.hit-pay.com/payment-request/@soccerbot/${id}/checkout`;
  const expiresAtMs = Date.now() + 60000;
  const reply = (
    destination: string,
    expiry: number | undefined = expiresAtMs,
  ) =>
    Response.json({
      ...context,
      mode: "live",
      checking: { ...context.checking, deadlineMs: Date.now() + 120000 },
      checkout: { state: "available", url: destination, expiresAtMs: expiry },
    });
  const fetch = vi.fn().mockResolvedValue(reply(url));
  vi.stubGlobal("fetch", fetch);
  expect((await read("live")).checkout).toEqual({
    state: "available",
    url,
    expiresAtMs,
  });
  fetch.mockResolvedValue(reply(url.replace("securecheckout.", "checkout.")));
  expect((await read("live")).checkout).toEqual({
    state: "available",
    url: url.replace("securecheckout.", "checkout."),
    expiresAtMs,
  });
  for (const invalid of [
    url.replace("securecheckout.", "checkout.sandbox.hit-pay.com.evil."),
    url.replace("securecheckout.", "attacker@checkout."),
    url.replace("securecheckout.sandbox", "checkout"),
    url.replace("hit-pay.com/", "hit-pay.com:444/"),
    url.replace("https:", "http:"),
    url.replace(".sandbox", ""),
    url.replace("hit-pay.com", "hit-pay.com.evil.test"),
    url.replace("securecheckout.", "attacker@securecheckout."),
    url + "?redirect=evil",
    url + "\n",
    url.replace("securecheckout.", "checkout.") + "\n",
    url + "#paid",
    url + "/",
    url.replace("@soccerbot", "%40soccerbot"),
    url.replace(id, "invalid"),
  ]) {
    fetch.mockResolvedValue(reply(invalid));
    await expect(read("live")).rejects.toThrow();
  }
  for (const expiry of [0, Date.now() - 1, Date.now() + 180000]) {
    fetch.mockResolvedValue(reply(url, expiry));
    await expect(read("live")).rejects.toThrow();
  }
});
