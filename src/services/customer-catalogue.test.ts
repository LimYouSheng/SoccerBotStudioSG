import { afterEach, expect, test, vi } from "vitest";
import { createCustomerCatalogueService } from "./customer-catalogue";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const catalogue = () => ({
  environment: "developer",
  observedAtMs: Date.now(),
  complete: true,
  services: [
    {
      id: "8",
      name: "Updated name",
      active: true,
      durationMinutes: 40,
      recurring: false,
      priceMinor: 9100,
      currency: "SGD",
      instructorIds: ["9"],
    },
  ],
  instructors: [{ id: "9", name: "Updated instructor", active: true }],
});
test("customer catalogue accepts current mutable provider data only through same-origin public display reads", async () => {
  const customerCatalogueService = createCustomerCatalogueService();
  const data = catalogue(),
    request = vi.fn().mockResolvedValue(Response.json(data));
  vi.stubGlobal("fetch", request);
  const signal = new AbortController().signal;
  expect(await customerCatalogueService.read(signal)).toEqual(data);
  expect(request).toHaveBeenCalledWith(
    "/api/catalogue",
    expect.objectContaining({
      signal: expect.any(AbortSignal),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    }),
  );
});
test("customer catalogue rejects stale future partial foreign oversized and unavailable data without fallback", async () => {
  const customerCatalogueService = createCustomerCatalogueService();
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  for (const response of [
    Response.json({ ...catalogue(), observedAtMs: 1 }),
    Response.json({ ...catalogue(), observedAtMs: Date.now() + 100000 }),
    Response.json({ ...catalogue(), complete: false }),
    Response.json({ ...catalogue(), environment: "production" }),
    Response.json({ ...catalogue(), privateCustomer: "must not be disclosed" }),
    new Response("x".repeat(131073)),
    new Response(null, { status: 503 }),
    new Response("malformed"),
  ]) {
    request.mockResolvedValueOnce(response);
    await expect(
      customerCatalogueService.read(new AbortController().signal),
    ).rejects.toThrow();
  }
});

test("homepage catalogue cache shares in-flight reads and survives authentication until five-minute expiry", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
  const service = createCustomerCatalogueService();
  let finish!: (value: Response) => void;
  const request = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", request);
  const homepage = new AbortController();
  const first = service.read(homepage.signal);
  const booking = service.read(new AbortController().signal);
  homepage.abort();
  const data = catalogue();
  finish(Response.json(data));
  await expect(first).rejects.toThrow();
  expect(await booking).toEqual(data);
  expect(service.peek()).toEqual(data);
  expect(await service.read(new AbortController().signal)).toEqual(data);
  expect(request).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 300000);
  expect(service.peek()).toBeUndefined();
  const refreshed = service.read(new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(2);
  finish(Response.json(catalogue()));
  await refreshed;
});
