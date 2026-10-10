import { afterEach, expect, test, vi } from "vitest";
import { customerCatalogueService } from "./customer-catalogue";
afterEach(() => vi.unstubAllGlobals());
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
test("customer catalogue accepts current mutable provider data only through protected same-origin reads", async () => {
  const data = catalogue(),
    request = vi.fn().mockResolvedValue(Response.json(data));
  vi.stubGlobal("fetch", request);
  const signal = new AbortController().signal;
  expect(await customerCatalogueService.read(signal)).toEqual(data);
  expect(request).toHaveBeenCalledWith(
    "/api/catalogue",
    expect.objectContaining({
      signal,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    }),
  );
});
test("customer catalogue rejects stale future partial foreign oversized and unavailable data without fallback", async () => {
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
