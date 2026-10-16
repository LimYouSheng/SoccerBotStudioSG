import { createBookingMechanism } from "../worker/tests/booking-mechanism-fixture.mjs";
import { expect, test, type Page } from "@playwright/test";

// CI-only synthetic transports. No widget script, email or provider is contacted.
const sitekey = "0x4AAAAAAFSTbdgbJQsvM5vy";
const challengeId = "10000000-0000-4000-8000-000000000001";
async function fixture(page: Page, delivery = false, remembered = false) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  let verified = remembered;
  let remember = remembered;
  let contact: { name: string; phone: string } | null = null;
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (
      url.href ===
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    ) {
      await route.fulfill({
        contentType: "application/javascript",
        body: `
        window.turnstile = {
          render(container, options) {
            container.dataset.sitekey = options.sitekey;
            container.dataset.action = options.action;
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Complete synthetic email check';
            button.onclick = () => options.callback('synthetic-proof');
            container.append(button);
            return 'synthetic-widget';
          },
          remove() {}
        };
      `,
      });
      return;
    }
    if (url.href === "https://soccerbotstudiosg.simplybook.asia/v2/") {
      // Synthetic frame only: preserve the no-provider-network browser gate.
      await route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Synthetic initialization</title>",
      });
      return;
    }
    if (url.origin !== "http://127.0.0.1:4173") {
      unexpected.push(url.origin);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const method = request.method();
    const body: unknown = request.postData() ? request.postDataJSON() : null;
    calls.push({ path: url.pathname, method, body });
    let status = 503,
      result: unknown = { error: "identity_unavailable" };
    if (url.pathname === "/api/identity" && method === "GET") {
      status = 200;
      result = verified
        ? {
            email: "synthetic@example.test",
            expiresAt: Date.now() + 600000,
            remember,
          }
        : null;
    } else if (
      delivery &&
      url.pathname === "/api/identity/contact" &&
      method === "GET"
    ) {
      status = verified ? 200 : 401;
      result = verified
        ? { email: "synthetic@example.test", contact }
        : { error: "identity_unavailable" };
    } else if (
      delivery &&
      url.pathname === "/api/identity/contact" &&
      method === "POST"
    ) {
      status = verified && remember ? 200 : 401;
      if (status === 200) {
        const input = body as { name: string; phone: string };
        contact = { name: input.name, phone: input.phone };
        result = { email: "synthetic@example.test", saved: true };
      }
    } else if (
      delivery &&
      url.pathname === "/api/identity/restore" &&
      method === "POST"
    ) {
      status = 200;
      result = null;
    } else if (delivery && url.pathname === "/api/access") {
      status = method === "DELETE" ? 200 : 201;
      if (method === "DELETE") verified = false;
      result = {};
    } else if (
      delivery &&
      url.pathname === "/api/identity/challenges" &&
      method === "POST"
    ) {
      status = 201;
      result = {
        challengeId,
        expiresAt: Date.now() + 600000,
        resendAfter: Date.now() + 60000,
      };
    } else if (
      delivery &&
      url.pathname === "/api/identity/verify" &&
      method === "POST"
    ) {
      verified = true;
      remember = (body as { remember?: boolean }).remember === true;
      status = 200;
      result = {
        email: "synthetic@example.test",
        expiresAt: Date.now() + 600000,
        remember,
      };
    }
    await route.fulfill({ status, json: result });
  });
  await page.goto("/book/account/");
  const prompt = page.getByRole("dialog", {
    name: "Get the SoccerBot Player App",
  });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Not now", exact: true }).click();
  return { calls, unexpected };
}

test("live guest denial stays on account without Preview fallback", async ({
  page,
}) => {
  const evidence = await fixture(page);
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Email verification is unavailable. You can continue as a guest.",
  );
  await expect(page).toHaveURL(/\/book\/account\/$/);
  expect(evidence.calls.filter((c) => c.method === "POST")).toEqual([
    { path: "/api/access", method: "POST", body: null },
    { path: "/api/access", method: "POST", body: null },
  ]);
  expect(evidence.unexpected).toEqual([]);
});

test("live email requires the supplied widget proof before protected requests", async ({
  page,
}) => {
  const evidence = await fixture(page);
  await page
    .getByRole("button", { name: "Continue with email", exact: true })
    .click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("synthetic@example.test");
  const widget = page.getByLabel("Email security check", { exact: true });
  await expect(widget).toHaveAttribute("data-sitekey", sitekey);
  await expect(widget).toHaveAttribute("data-action", "verify-email");
  await expect(
    page.getByText("Email sign-in preview", { exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Continue with email", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Email verification is unavailable. You can continue as a guest.",
  );
  expect(evidence.calls.filter((c) => c.method === "POST")).toEqual([
    { path: "/api/access", method: "POST", body: null },
  ]);
  expect(evidence.unexpected).toEqual([]);
});

test("synthetic live verification reads server identity and keeps native booking unavailable", async ({
  page,
}) => {
  const evidence = await fixture(page, true);
  await page
    .getByRole("button", { name: "Continue with email", exact: true })
    .click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("synthetic@example.test");
  await page
    .getByRole("button", {
      name: "Complete synthetic email check",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Continue with email", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verify your email", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Demo code", { exact: false })).toHaveCount(0);
  await page.getByLabel("Verification code", { exact: true }).fill("246810");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(page).toHaveURL(/\/book\/session\/$/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Session information is unavailable. Your details have been kept.",
  );
  await expect(
    page.getByRole("link", { name: "See available times" }),
  ).toHaveCount(0);
  expect(evidence.calls.filter((c) => c.method === "POST")).toEqual([
    { path: "/api/access", method: "POST", body: null },
    { path: "/api/identity/restore", method: "POST", body: null },
    { path: "/api/access", method: "POST", body: null },
    {
      path: "/api/identity/challenges",
      method: "POST",
      body: { email: "synthetic@example.test", botToken: "synthetic-proof" },
    },
    {
      path: "/api/identity/verify",
      method: "POST",
      body: {
        email: "synthetic@example.test",
        challengeId,
        code: "246810",
        remember: false,
      },
    },
  ]);
  expect(
    evidence.calls.filter(
      (c) => c.path === "/api/identity" && c.method === "GET",
    ).length,
  ).toBeGreaterThanOrEqual(2);
  expect(
    evidence.calls.filter((c) => c.path === "/api/identity/contact"),
  ).toEqual([{ path: "/api/identity/contact", method: "GET", body: null }]);
  expect(evidence.unexpected).toEqual([]);
});

test("remembered live account edits and rereads contact while native booking stays unavailable", async ({
  page,
}) => {
  const evidence = await fixture(page, true, true);
  await page
    .getByRole("button", { name: "Manage saved contact", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved contact details", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Full name", { exact: false })
    .fill("Synthetic Contact");
  await page
    .getByLabel("Mobile number", { exact: false })
    .fill("+65 8123 4567");
  await page
    .getByRole("button", { name: "Save contact details", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Contact details saved for your next visit.",
  );
  await page
    .getByRole("button", { name: "Back to booking options", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Manage saved contact", exact: true })
    .click();
  await expect(page.getByLabel("Full name", { exact: false })).toHaveValue(
    "Synthetic Contact",
  );
  await expect(page.getByLabel("Mobile number", { exact: false })).toHaveValue(
    "+65 8123 4567",
  );
  expect(
    evidence.calls.filter(
      (c) => c.path === "/api/identity/contact" && c.method === "POST",
    ),
  ).toEqual([
    {
      path: "/api/identity/contact",
      method: "POST",
      body: {
        email: "synthetic@example.test",
        name: "Synthetic Contact",
        phone: "+65 8123 4567",
      },
    },
  ]);
  await page
    .getByRole("button", { name: "Back to booking options", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue signed in", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Session information is unavailable. Your details have been kept.",
  );
  expect(evidence.unexpected).toEqual([]);
});

async function mechanismTransport(
  page: Page,
  mechanism: Awaited<ReturnType<typeof createBookingMechanism>>,
) {
  let attemptId = "";
  const calls: { path: string; method: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.href === "https://soccerbotstudiosg.simplybook.asia/v2/") {
      await route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Synthetic initialization</title>",
      });
      return;
    }
    if (url.href === mechanism.checkoutUrl) {
      await route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><h1>Synthetic HitPay checkout</h1>",
      });
      return;
    }
    if (url.origin !== "http://127.0.0.1:4173") {
      unexpected.push(url.origin);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const body: unknown = request.postData() ? request.postDataJSON() : null;
    calls.push({ path: url.pathname, method: request.method(), body });
    // Loopback transport adapter only: do not fabricate application responses.
    // Secure __Host cookies cannot be used by the HTTP static preview origin.
    const headers = new Headers(await request.allHeaders());
    headers.delete("host");
    headers.delete("content-length");
    if (headers.get("origin") === url.origin)
      headers.set("origin", mechanism.origin);
    // WebKit interception omits Cookie from request headers. Read the actual
    // browser jar; never invent an access token or bypass server authentication.
    const cookies = await page.context().cookies(url.origin);
    headers.set(
      "cookie",
      cookies
        .filter((cookie) => cookie.name === "soccerbot-mechanism-access")
        .map((cookie) => `__Host-soccerbot-access=${cookie.value}`)
        .join("; "),
    );
    const response = await mechanism.mf.dispatchFetch(
      mechanism.origin + url.pathname + url.search,
      {
        method: request.method(),
        headers,
        body: request.postData() || undefined,
      },
    );
    const responseHeaders = Object.fromEntries(response.headers);
    if (responseHeaders["set-cookie"]) {
      responseHeaders["set-cookie"] = responseHeaders["set-cookie"]
        .replace("__Host-soccerbot-access=", "soccerbot-mechanism-access=")
        .replace("; Secure", "");
      // WebKit does not persist Set-Cookie from this intercepted response.
      // Carry only the actual server-issued capability into the loopback jar.
      const [pair, ...attributes] = responseHeaders["set-cookie"].split(";");
      const separator = pair.indexOf("=");
      const age = attributes.find((value) =>
        value.trim().startsWith("Max-Age="),
      );
      expect(age).toBeDefined();
      await page.context().addCookies([
        {
          name: pair.slice(0, separator),
          value: pair.slice(separator + 1),
          url: url.origin,
          httpOnly: true,
          secure: false,
          sameSite: "Strict",
          expires:
            Math.floor(Date.now() / 1000) +
            Number(age!.trim().slice("Max-Age=".length)),
        },
      ]);
    }
    const responseBody = await response.text();
    if (url.pathname === "/api/booking/prepare" && response.status === 201)
      attemptId = JSON.parse(responseBody).attemptId;
    // Always settle the intercepted route, even when navigation canceled it.
    // Returning without a route action leaves Playwright cleanup waiting.
    try {
      await route.fulfill({
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
      });
    } catch (error) {
      if (!request.failure() && !page.isClosed()) throw error;
    }
  });
  return { calls, unexpected, attemptId: () => attemptId };
}

test("native guest journey preserves players contact and one checkout across refresh", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism();
  try {
    const { date, startMs, checkoutUrl } = mechanism;
    const transport = await mechanismTransport(page, mechanism);
    const { calls, unexpected } = transport;
    const warmedMonths = new Set<string>();
    const calendarReady = page.waitForResponse((response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith("/api/calendar/") && response.status() === 200)
        warmedMonths.add(path);
      return warmedMonths.size === 4;
    });
    await page.goto("/");
    await page
      .getByRole("dialog", { name: "Get the SoccerBot Player App" })
      .getByRole("button", { name: "Not now", exact: true })
      .click();
    await calendarReady;
    expect(
      calls.filter((c) => c.path.startsWith("/api/calendar/")),
    ).toHaveLength(4);
    expect(calls.filter((c) => c.path === "/api/catalogue")).toHaveLength(1);
    expect(calls.filter((c) => c.path === "/api/access")).toHaveLength(0);
    await page.getByRole("link", { name: "Book now", exact: true }).click();
    await page
      .getByRole("button", { name: "Continue as guest", exact: true })
      .click();
    await expect(page).toHaveURL(/\/book\/session\/$/);
    await page
      .getByRole("button", { name: "Add one player", exact: true })
      .click();
    await page
      .getByRole("link", { name: "See available times", exact: true })
      .click();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const monthOffset =
      (+date.slice(0, 4) - +today.slice(0, 4)) * 12 +
      +date.slice(5, 7) -
      +today.slice(5, 7);
    await page
      .getByLabel("Calendar month", { exact: true })
      .selectOption(String(monthOffset));
    const label = new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(`${date}T04:00:00Z`));
    await page.getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("group", { name: "Session times" })
      .getByRole("button", { name: /08:10–08:50/ })
      .click();
    expect(
      calls.filter((c) => c.path.startsWith("/api/calendar/")),
    ).toHaveLength(4);
    expect(calls.filter((c) => c.path === "/api/catalogue")).toHaveLength(1);
    expect(
      calls.filter((c) => c.path.startsWith("/api/booking/availability/")),
    ).toHaveLength(0);
    await page.getByRole("link", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your details", exact: true }),
    ).toBeVisible();
    expect(
      calls.filter((c) => c.path.startsWith("/api/booking/availability/")),
    ).toHaveLength(0);
    await page
      .getByLabel("Full name", { exact: false })
      .fill("Synthetic Guest");
    await page
      .getByLabel("Email address", { exact: false })
      .fill("synthetic@example.test");
    await page
      .getByLabel("Mobile number", { exact: false })
      .fill("+6591234567");
    await page
      .getByLabel("Preferred contact method", { exact: false })
      .selectOption("email");
    await page
      .getByLabel("Academy / school / organisation", { exact: false })
      .fill("Synthetic School");
    const holdResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.startsWith("/api/booking/native/") &&
        url.search === "?hold=1" &&
        response.request().method() === "POST"
      );
    });
    await page
      .getByRole("button", { name: "Review booking", exact: true })
      .click();
    expect((await holdResponse).status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Review booking", exact: true }),
    ).toBeVisible();
    expect(
      calls.filter((c) => c.path.startsWith("/api/booking/availability/")),
    ).toHaveLength(1);
    expect(
      calls.filter(
        (c) => c.path === `/api/booking/native/${transport.attemptId()}`,
      ),
    ).toHaveLength(1);
    expect(
      calls.filter(
        (c) => c.path === `/api/booking/hitpay/${transport.attemptId()}`,
      ),
    ).toHaveLength(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Review booking", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic Guest", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: /I’ve reviewed all selected/ })
      .check();
    await page
      .getByRole("button", { name: "Continue to payment", exact: true })
      .click();
    await expect(page).toHaveURL(checkoutUrl);
    await expect(
      page.getByRole("heading", { name: "Synthetic HitPay checkout" }),
    ).toBeVisible();
    expect(
      calls.filter((c) => c.path === "/api/booking/prepare")[0].body,
    ).toMatchObject({
      accepted: false,
      holding: true,
      contact: {
        name: "Synthetic Guest",
        email: "synthetic@example.test",
        phone: "+6591234567",
        academy: "Synthetic School",
      },
      sessions: [
        {
          serviceId: "2",
          instructorId: "14",
          startMs,
          players: 2,
          totalMinor: 8800,
        },
      ],
    });
    await page.goto(
      `http://127.0.0.1:4173/confirmation/?attempt=${transport.attemptId()}`,
    );
    await page.reload();
    await expect(
      page.getByRole("link", { name: "Open checkout", exact: true }),
    ).toHaveCount(0);
    expect(
      calls.filter(
        (c) =>
          c.path === `/api/booking/hitpay/${transport.attemptId()}` &&
          c.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      calls.filter((c) => c.path.startsWith("/api/booking/availability/")),
    ).toHaveLength(1);
    await expect(
      page.getByRole("heading", { name: "Booking confirmed", exact: true }),
    ).toHaveCount(0);
    expect(
      calls.filter(
        (c) =>
          c.path === `/api/booking/native/${transport.attemptId()}` &&
          c.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      calls.filter(
        (c) => c.path === "/api/identity/contact" && c.method === "POST",
      ),
    ).toHaveLength(0);
    expect(unexpected).toEqual([]);
    const bookingIndex = mechanism.calls.findIndex(
      (c) => c.body?.method === "book",
    );
    expect(bookingIndex).toBeGreaterThanOrEqual(0);
    expect(
      mechanism.calls.filter((c) => c.body?.method === "book"),
    ).toHaveLength(1);
    expect(
      mechanism.calls.filter(
        (c) => c.url.includes("hit-pay.com") && c.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      mechanism.calls.slice(bookingIndex + 1).filter((c) => {
        const params = c.body?.params;
        // Shared month-cache refresh is allowed after a hold; revalidating
        // that reserved slot in the checkout path is not.
        return (
          c.body?.method === "getAvailableUnits" ||
          (c.body?.method === "getStartTimeMatrix" &&
            Array.isArray(params) &&
            params[0] === date &&
            params[1] === date)
        );
      }),
    ).toHaveLength(0);
    expect(mechanism.unexpected).toEqual([]);
  } finally {
    try {
      // Stop polling and cache warming before draining intercepted requests.
      // Otherwise the still-mounted app can create work during teardown.
      await test.step("Stop browser traffic", async () => {
        if (!page.isClosed()) await page.goto("about:blank");
      });
      await test.step("Drain mechanism routes", () =>
        page.unrouteAll({ behavior: "wait" }));
    } finally {
      await test.step("Dispose isolated Worker", () => mechanism.close());
    }
  }
});

test("real payment recovery confirms the browser return from verified provider state", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism();
  try {
    await mechanismTransport(page, mechanism);
    // Setup uses the same public routes, auth and coordinator as the browser.
    const access = await mechanism.mf.dispatchFetch(
      mechanism.origin + "/api/access",
      { method: "POST", headers: { origin: mechanism.origin } },
    );
    expect(access.status).toBe(201);
    const cookie = access.headers.get("set-cookie")!.split(";")[0];
    await page.context().addCookies([
      {
        name: "soccerbot-mechanism-access",
        value: cookie.slice(cookie.indexOf("=") + 1),
        url: "http://127.0.0.1:4173",
        httpOnly: true,
        sameSite: "Strict",
        secure: false,
      },
    ]);
    const headers = {
      origin: mechanism.origin,
      cookie,
      "content-type": "application/json",
    };
    const prepared = await mechanism.mf.dispatchFetch(
      mechanism.origin + "/api/booking/prepare",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          key: crypto.randomUUID(),
          holding: true,
          accepted: false,
          contact: {
            name: "Synthetic Guest",
            email: "synthetic@example.test",
            phone: "+6591234567",
            contactMethod: "email",
            academy: "",
          },
          sessions: [
            {
              serviceId: "2",
              instructorId: "14",
              startMs: mechanism.startMs,
              players: 2,
              totalMinor: 8800,
            },
          ],
        }),
      },
    );
    expect(prepared.status).toBe(201);
    const { attemptId } = (await prepared.json()) as { attemptId: string };
    const held = await mechanism.mf.dispatchFetch(
      mechanism.origin + `/api/booking/native/${attemptId}?hold=1`,
      { method: "POST", headers },
    );
    expect(await held.json()).toMatchObject({
      state: "associated",
      paymentAvailable: false,
    });
    const checkout = await mechanism.mf.dispatchFetch(
      mechanism.origin + `/api/booking/hitpay/${attemptId}`,
      { method: "POST", headers, body: JSON.stringify({ accepted: true }) },
    );
    expect(await checkout.json()).toMatchObject({
      state: "associated",
      paymentAvailable: true,
    });
    expect((await mechanism.completePayment()).status).toBe(202);
    await mechanism.recover();
    const confirmation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/attempts/${attemptId}/confirmation` &&
        response.status() === 200,
    );
    await page.goto(`/confirmation/?attempt=${attemptId}`);
    await page
      .getByRole("dialog", { name: "Get the SoccerBot Player App" })
      .getByRole("button", { name: "Not now", exact: true })
      .click();
    expect(await (await confirmation).json()).toMatchObject({
      status: "confirmed",
    });
    await expect(
      page.getByRole("heading", { name: "Booking confirmed", exact: true }),
    ).toBeVisible();
    expect(
      mechanism.calls.filter((call) => call.url.endsWith("/accept-payment")),
    ).toHaveLength(1);
    expect(mechanism.unexpected).toEqual([]);
  } finally {
    try {
      // Stop polling and cache warming before draining intercepted requests.
      // Otherwise the still-mounted app can create work during teardown.
      await test.step("Stop browser traffic", async () => {
        if (!page.isClosed()) await page.goto("about:blank");
      });
      await test.step("Drain mechanism routes", () =>
        page.unrouteAll({ behavior: "wait" }));
    } finally {
      await test.step("Dispose isolated Worker", () => mechanism.close());
    }
  }
});
