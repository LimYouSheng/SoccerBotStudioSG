import { afterEach, expect, it, vi } from "vitest";
import { createLiveIdentityService } from "./identity";
afterEach(() => vi.unstubAllGlobals());
const identity = {
  email: "synthetic@example.invalid",
  expiresAt: Date.now() + 600000,
};
const challenge = {
  email: identity.email,
  challengeId: "11111111-1111-4111-8111-111111111111",
  expiresAt: identity.expiresAt,
  resendAfter: 0,
};
it("live identity requires a fresh bot proof and sends it only after guest access", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  const service = createLiveIdentityService(),
    signal = new AbortController().signal;
  await expect(service.challenge(identity.email, signal)).rejects.toThrow(
    "unavailable",
  );
  expect(request).not.toHaveBeenCalled();
  request
    .mockResolvedValueOnce(Response.json({ access: "guest" }))
    .mockResolvedValueOnce(
      Response.json({
        challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt,
        resendAfter: 0,
      }),
    );
  expect(
    await service.challenge(identity.email, signal, "synthetic-token"),
  ).toEqual(challenge);
  expect(request.mock.calls.map((c) => c[0])).toEqual([
    "/api/access",
    "/api/identity/challenges",
  ]);
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
    email: identity.email,
    botToken: "synthetic-token",
  });
});
it("live identity authenticates guest and verifies through same-origin server reads without browser storage", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access: "guest" }))
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(Response.json(identity));
  vi.stubGlobal("fetch", request);
  const service = createLiveIdentityService(),
    signal = new AbortController().signal;
  await service.guest(signal);
  expect(await service.verify(challenge, "123456", false, signal)).toEqual(
    identity,
  );
  expect(request.mock.calls.map((c) => c[0])).toEqual([
    "/api/access",
    "/api/identity/verify",
    "/api/identity",
  ]);
  for (const [, options] of request.mock.calls)
    expect(options).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
  expect(service.current()).toEqual(identity);
});
it("live identity discards verification arriving after signout and never pre-fills unbound provider records", async () => {
  let finish!: (value: Response) => void;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(Response.json({ access: "revoked" }));
  vi.stubGlobal("fetch", request);
  const service = createLiveIdentityService(),
    signal = new AbortController().signal;
  const pending = service.verify(challenge, "123456", true, signal);
  await service.signOut(signal);
  finish(Response.json(identity));
  await expect(pending).rejects.toThrow("unavailable");
  expect(service.current()).toBeNull();
  expect(await service.profile(identity.email, signal)).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
});
it("live identity rejects stale mismatched oversized and unavailable responses without demo success", async () => {
  const service = createLiveIdentityService(),
    signal = new AbortController().signal;
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  for (const response of [
    Response.json({ ...identity, email: "foreign@example.invalid" }),
    Response.json({ ...identity, expiresAt: 1 }),
    new Response("x".repeat(4097)),
    new Response(null, { status: 503 }),
  ]) {
    request.mockResolvedValueOnce(response);
    await expect(
      service.verify(challenge, "123456", false, signal),
    ).rejects.toThrow();
    expect(service.current()).toBeNull();
  }
  expect(request).toHaveBeenCalledTimes(4);
});
it("live remembered refresh creates only fresh guest access and rereads restored identity", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access: "guest" }))
    .mockResolvedValueOnce(Response.json(null))
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(Response.json(identity));
  vi.stubGlobal("fetch", request);
  const service = createLiveIdentityService(),
    signal = new AbortController().signal;
  expect(await service.refresh(signal)).toEqual(identity);
  expect(request.mock.calls.map((c) => [c[0], c[1].method])).toEqual([
    ["/api/access", "POST"],
    ["/api/identity", "GET"],
    ["/api/identity/restore", "POST"],
    ["/api/identity", "GET"],
  ]);
  expect(service.current()).toEqual(identity);
});
it("live remembered restoration arriving after signout cannot repopulate cached identity", async () => {
  let finish!: (response: Response) => void;
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access: "guest" }))
    .mockResolvedValueOnce(Response.json(null))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(Response.json({ access: "revoked" }));
  vi.stubGlobal("fetch", request);
  const service = createLiveIdentityService(),
    signal = new AbortController().signal;
  const pending = service.refresh(signal);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  await service.signOut(signal);
  finish(Response.json(identity));
  await expect(pending).rejects.toThrow("unavailable");
  expect(service.current()).toBeNull();
  expect(request).toHaveBeenCalledTimes(4);
});
it("live verification transmits explicit consent and all-device signout uses its protected operation", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(Response.json({ access: "revoked" }));
  vi.stubGlobal("fetch", request);
  const service = createLiveIdentityService(),
    signal = new AbortController().signal;
  await service.verify(challenge, "123456", true, signal);
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
    challengeId: challenge.challengeId,
    email: challenge.email,
    code: "123456",
    remember: true,
  });
  await service.signOut(signal, true);
  expect(request.mock.calls[2][0]).toBe("/api/identity/all-devices");
  expect(service.current()).toBeNull();
});
