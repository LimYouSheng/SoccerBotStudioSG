import { createBookingMechanism } from "../worker/tests/booking-mechanism-fixture.mjs";
import { expect, test, type Page, type Route } from "@playwright/test";

// CI-only synthetic transports. No widget script, email or provider is contacted.
const sitekey = "0x4AAAAAAFSTbdgbJQsvM5vy";
const challengeId = "10000000-0000-4000-8000-000000000001";
async function fixture(
  page: Page,
  delivery = false,
  remembered = false,
  identityReady?: Promise<void>,
) {
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
      await identityReady;
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
  let restoreIdentity!: () => void;
  const identityReady = new Promise<void>((resolve) => {
    restoreIdentity = resolve;
  });
  const evidence = await fixture(page, true, true, identityReady);
  const guest = page.getByRole("button", {
    name: "Continue as guest",
    exact: true,
  });
  const before = await guest.boundingBox();
  expect(before).not.toBeNull();
  restoreIdentity();
  await expect(
    page.getByRole("button", { name: "Continue signed in", exact: true }),
  ).toBeVisible();
  const signedInEmail = page.getByText("synthetic@example.test", {
    exact: true,
  });
  await expect(signedInEmail).toHaveCSS("font-weight", "700");
  await expect(signedInEmail).toHaveCSS("color", "rgb(23, 96, 120)");
  expect(
    await signedInEmail.evaluate((node) =>
      parseFloat(getComputedStyle(node).fontSize),
    ),
  ).toBeGreaterThanOrEqual(18);
  const accountActions = page.locator(".account-actions .button");
  await expect(accountActions).toHaveCount(3);
  const actionBoxes = await accountActions.evaluateAll((buttons) =>
    buttons.map((button) => {
      const { x, y, width, height } = button.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  for (let index = 1; index < actionBoxes.length; index++) {
    expect(actionBoxes[index].y).toBe(actionBoxes[0].y);
    expect(actionBoxes[index].height).toBe(actionBoxes[0].height);
    expect(actionBoxes[index].x).toBeGreaterThan(
      actionBoxes[index - 1].x + actionBoxes[index - 1].width,
    );
  }
  const after = await guest.boundingBox();
  expect(after).toEqual(before);
  await page
    .getByRole("button", { name: "Manage saved contact", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved contact details", exact: true }),
  ).toBeVisible();
  const saveButton = await page
    .getByRole("button", { name: "Save contact details", exact: true })
    .boundingBox();
  const backButton = await page
    .getByRole("button", { name: "Back to booking options", exact: true })
    .boundingBox();
  const profile = await page.locator("#details-form .surface").boundingBox();
  expect(saveButton).not.toBeNull();
  expect(backButton).not.toBeNull();
  expect(profile).not.toBeNull();
  expect(saveButton!.y - (profile!.y + profile!.height)).toBeGreaterThanOrEqual(
    27,
  );
  expect(
    Math.max(
      backButton!.x - (saveButton!.x + saveButton!.width),
      backButton!.y - (saveButton!.y + saveButton!.height),
    ),
  ).toBeGreaterThanOrEqual(15);
  await page
    .getByLabel("Full name", { exact: false })
    .fill("Synthetic Contact");
  await page
    .getByLabel("Mobile number", { exact: false })
    .fill("+65 8123 4567");
  await page
    .getByRole("button", { name: "Save contact details", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Saving contact details…", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#details-form").getByRole("status")).toHaveText(
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
  beforeDispatch?: (path: string) => Promise<void>,
  dropResponse?: (path: string) => boolean,
) {
  let attemptId = "";
  const calls: { path: string; method: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  const pending = new Set<Promise<void>>();
  const handle = async (route: Route) => {
    const request = route.request(),
      url = new URL(request.url());
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
    await beforeDispatch?.(url.pathname);
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
    if (dropResponse?.(url.pathname)) {
      try {
        await route.abort("connectionclosed");
      } catch (error) {
        // Navigation may already have canceled this request. Preserve real
        // interception failures; a canceled response is already lost.
        if (!request.failure() && !page.isClosed()) throw error;
      }
      return;
    }
    if (
      (url.pathname === "/api/booking/prepare" && response.status === 201) ||
      (url.pathname.startsWith("/api/booking/hold/") && response.status === 200)
    )
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
  };
  await page.route("**/*", (route) => {
    const work = handle(route);
    pending.add(work);
    return work.finally(() => pending.delete(work));
  });
  return {
    calls,
    unexpected,
    attemptId: () => attemptId,
    async drain() {
      // Drain our provider/response work, not Playwright's unresolved internal
      // handled promise for a route canceled by document navigation.
      await page.unrouteAll();
      await Promise.all([...pending]);
    },
  };
}

test("native guest journey preserves players contact and one checkout across refresh", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism();
  const transport = await mechanismTransport(page, mechanism);
  try {
    const { date, startMs, checkoutUrl } = mechanism;
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
    const guest = page.getByRole("button", {
      name: "Continue as guest",
      exact: true,
    });
    const email = page.getByRole("button", {
      name: "Continue with email",
      exact: true,
    });
    await expect(guest).toBeVisible();
    await expect(email).toBeVisible();
    const guestBox = (await guest.boundingBox())!;
    const emailBox = (await email.boundingBox())!;
    expect(Math.abs(guestBox.width - emailBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(guestBox.height - emailBox.height)).toBeLessThanOrEqual(1);
    if (Math.abs(guestBox.x - emailBox.x) > 1)
      expect(Math.abs(guestBox.y - emailBox.y)).toBeLessThanOrEqual(1);
    else expect(Math.abs(guestBox.x - emailBox.x)).toBeLessThanOrEqual(1);
    await guest.click();
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
      .getByRole("button", { name: /12:10–12:50/ })
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
        url.pathname.startsWith("/api/booking/hold/") &&
        url.search === "" &&
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
    ).toHaveLength(0);
    expect(
      calls.filter(
        (c) => c.path === `/api/booking/hold/${transport.attemptId()}`,
      ),
    ).toHaveLength(1);
    expect(
      calls.filter(
        (c) => c.path === `/api/booking/hitpay/${transport.attemptId()}`,
      ),
    ).toHaveLength(0);
    expect(calls.filter((c) => c.path === "/api/booking/prepare")).toHaveLength(
      0,
    );
    const displayReadsBeforeRestore = calls.filter(
      (call) =>
        call.path.startsWith("/api/calendar/") ||
        call.path === "/api/catalogue",
    ).length;
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
    expect(
      calls.filter(
        (call) =>
          call.path.startsWith("/api/calendar/") ||
          call.path === "/api/catalogue",
      ),
    ).toHaveLength(displayReadsBeforeRestore);
    await expect(
      page.getByRole("heading", { name: "Synthetic HitPay checkout" }),
    ).toBeVisible();
    expect(
      calls.filter(
        (c) => c.path === `/api/booking/hold/${transport.attemptId()}`,
      )[0].body,
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
    ).toHaveLength(0);
    await expect(
      page.getByRole("heading", { name: "Booking confirmed", exact: true }),
    ).toHaveCount(0);
    expect(
      calls.filter(
        (c) =>
          c.path === `/api/booking/hold/${transport.attemptId()}` &&
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
      await test.step("Drain mechanism routes", () => transport.drain());
    } finally {
      await test.step("Dispose isolated Worker", () => mechanism.close());
    }
  }
});

async function prepareBrowserAttempt(
  page: Page,
  mechanism: Awaited<ReturnType<typeof createBookingMechanism>>,
) {
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
  return { headers, attemptId };
}

test("real payment recovery confirms the browser return from verified provider state", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism();
  let releaseDismiss!: () => void;
  let dismissGate = new Promise<void>((resolve) => {
    releaseDismiss = resolve;
  });
  const transport = await mechanismTransport(page, mechanism, (path) =>
    path.endsWith("/dismiss") ? dismissGate : Promise.resolve(),
  );
  try {
    const { headers, attemptId } = await prepareBrowserAttempt(page, mechanism);
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
    // The authenticated webhook must wake production recovery itself. No
    // manual cron invocation or fabricated application confirmation response.
    const savedConfirmation = page.waitForResponse(async (response) => {
      const path = new URL(response.url()).pathname;
      if (
        response.status() !== 200 ||
        ![
          `/api/attempts/${attemptId}/checkout`,
          `/api/attempts/${attemptId}/confirmation`,
        ].includes(path)
      )
        return false;
      const body = await response.json();
      return (
        body.confirmation?.attemptId === attemptId ||
        body.status === "confirmed"
      );
    });
    await page.goto(`/confirmation/?attempt=${attemptId}`);
    await page
      .getByRole("dialog", { name: "Get the SoccerBot Player App" })
      .getByRole("button", { name: "Not now", exact: true })
      .click();
    const verifiedResponse = await (await savedConfirmation).json();
    expect(
      verifiedResponse.confirmation?.attemptId === attemptId ||
        verifiedResponse.status === "confirmed",
    ).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Booking confirmed", exact: true }),
    ).toBeVisible();
    expect(
      mechanism.calls.filter((call) => call.url.endsWith("/accept-payment")),
    ).toHaveLength(1);
    expect(mechanism.unexpected).toEqual([]);
    const confirmationReads = transport.calls.filter((call) =>
      call.path.endsWith("/confirmation"),
    ).length;
    await page.evaluate((id) => {
      localStorage.setItem(
        `soccerbot-checking:${id}`,
        JSON.stringify({ deadline: Date.now() - 1, next: 0, count: 120 }),
      );
    }, attemptId);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Booking confirmed", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Client Details" }),
    ).toBeVisible();
    await expect(page.getByText(/Saved confirmation · Verified/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Open checkout" })).toHaveCount(
      0,
    );
    expect(
      transport.calls.filter((call) => call.path.endsWith("/confirmation")),
    ).toHaveLength(confirmationReads);
    expect(
      mechanism.calls.filter((call) => call.url.endsWith("/accept-payment")),
    ).toHaveLength(1);
    expect(mechanism.unexpected).toEqual([]);
    await page.getByRole("button", { name: "Make another booking" }).click();
    await expect(page).toHaveURL(/\/book\/account\/$/);
    await expect(
      page.getByRole("button", { name: "Continue as guest", exact: true }),
    ).toBeVisible();
    // Navigation must finish while the real dismiss request is still blocked.
    const dismissed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/dismiss") &&
        response.status() === 200,
    );
    releaseDismiss();
    await dismissed;
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Continue as guest", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/book\/account\/$/);
    // Explicit exit releases routing, but the protected old receipt remains.
    await page.goto(`/confirmation/?attempt=${attemptId}`);
    await expect(
      page.getByRole("heading", { name: "Client Details" }),
    ).toBeVisible();
    dismissGate = new Promise<void>((resolve) => {
      releaseDismiss = resolve;
    });
    const homeButton = page.getByRole("link", {
      name: "Back to home",
      exact: true,
    });
    const homeBox = await homeButton.boundingBox();
    const actionsBox = await page
      .locator(".confirmation-actions")
      .boundingBox();
    expect(homeBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(homeBox!.x).toBeCloseTo(actionsBox!.x, 0);
    expect(homeBox!.width).toBeCloseTo(actionsBox!.width, 0);
    expect(homeBox!.y).toBeGreaterThan(actionsBox!.y + actionsBox!.height);
    await page.getByRole("link", { name: "Back to home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    const homeDismissed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/dismiss") &&
        response.status() === 200,
    );
    releaseDismiss();
    await homeDismissed;
    await page.goto("/book/account/");
    await expect(
      page.getByRole("button", { name: "Continue as guest", exact: true }),
    ).toBeVisible();
    expect(
      mechanism.calls.filter((call) => call.url.endsWith("/accept-payment")),
    ).toHaveLength(1);
    expect(mechanism.unexpected).toEqual([]);
  } finally {
    releaseDismiss();
    try {
      // Stop polling and cache warming before draining intercepted requests.
      // Otherwise the still-mounted app can create work during teardown.
      await test.step("Stop browser traffic", async () => {
        if (!page.isClosed()) await page.goto("about:blank");
      });
      await test.step("Drain mechanism routes", () => transport.drain());
    } finally {
      await test.step("Dispose isolated Worker", () => mechanism.close());
    }
  }
});

test("concurrent browser tabs reuse one hold and payment and reject revoked access", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism();
  const other = await page.context().newPage();
  const transport = await mechanismTransport(page, mechanism);
  const secondTransport = await mechanismTransport(other, mechanism);
  try {
    const { attemptId } = await prepareBrowserAttempt(page, mechanism);
    await Promise.all([
      page.goto("/book/account/"),
      other.goto("/book/account/"),
    ]);
    const submit = (tab: Page, path: string, body?: unknown) =>
      tab.evaluate(
        async ({ path, body }) => {
          const response = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          return { status: response.status, body: await response.json() };
        },
        { path, body },
      );
    const holds = await Promise.all([
      submit(page, `/api/booking/native/${attemptId}?hold=1`),
      submit(other, `/api/booking/native/${attemptId}?hold=1`),
    ]);
    expect(holds.map((result) => result.status)).toEqual([200, 200]);
    expect(holds.some((result) => result.body.state === "associated")).toBe(
      true,
    );
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(1);
    const availabilityReads = mechanism.calls.filter(
      (call) => call.body?.method === "getStartTimeMatrix",
    ).length;
    const payments = await Promise.all([
      submit(page, `/api/booking/hitpay/${attemptId}`, { accepted: true }),
      submit(other, `/api/booking/hitpay/${attemptId}`, { accepted: true }),
    ]);
    expect(payments.map((result) => result.status)).toEqual([200, 200]);
    expect(
      mechanism.calls.filter(
        (call) =>
          call.method === "POST" &&
          new URL(call.url).pathname === "/v1/payment-requests",
      ),
    ).toHaveLength(1);
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(1);
    expect(
      mechanism.calls.filter(
        (call) => call.body?.method === "getStartTimeMatrix",
      ),
    ).toHaveLength(availabilityReads);
    // Model server-side session revocation, then reuse the actual browser cookie.
    await mechanism.db
      .prepare("UPDATE guest_access SET revoked_ms=?")
      .bind(Date.now())
      .run();
    const providerCalls = mechanism.calls.length;
    const denied = await submit(
      other,
      `/api/booking/native/${attemptId}?hold=1`,
    );
    expect(denied.status).toBe(401);
    expect(mechanism.calls).toHaveLength(providerCalls);
    expect(mechanism.unexpected).toEqual([]);
  } finally {
    await Promise.all([page.goto("about:blank"), other.goto("about:blank")]);
    await Promise.all([transport.drain(), secondTransport.drain()]);
    await other.close();
    await mechanism.close();
  }
});

// Failure journeys use the real Worker/API/storage implementation. Only provider
// replies or the delivery of an already-completed HTTP response are faulted.
async function guestDetails(
  page: Page,
  mechanism: Awaited<ReturnType<typeof createBookingMechanism>>,
  batch = false,
) {
  const months = new Set<string>();
  const warmed = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/calendar/") && response.status() === 200)
      months.add(path);
    return months.size === 4;
  });
  await page.goto("/");
  await page
    .getByRole("dialog", { name: "Get the SoccerBot Player App" })
    .getByRole("button", { name: "Not now", exact: true })
    .click();
  await warmed;
  await page.getByRole("link", { name: "Book now", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue as guest", exact: true })
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
  const offset =
    (+mechanism.date.slice(0, 4) - +today.slice(0, 4)) * 12 +
    +mechanism.date.slice(5, 7) -
    +today.slice(5, 7);
  await page
    .getByLabel("Calendar month", { exact: true })
    .selectOption(String(offset));
  const label = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${mechanism.date}T04:00:00Z`));
  await page.getByRole("button", { name: label, exact: true }).click();
  await page
    .getByRole("group", { name: "Session times" })
    .getByRole("button", { name: /12:10–12:50/ })
    .click();
  if (batch)
    await page
      .getByRole("group", { name: "Session times" })
      .getByRole("button", { name: /13:00–13:40/ })
      .click();
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your details", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Full name", { exact: false }).fill("Synthetic Guest");
  await page
    .getByLabel("Email address", { exact: false })
    .fill("synthetic@example.test");
  await page.getByLabel("Mobile number", { exact: false }).fill("+6591234567");
  const contactMethod = page.getByLabel("Preferred contact method", {
    exact: false,
  });
  await expect(contactMethod).toHaveValue("email");
  await expect(contactMethod.locator("option")).toHaveText([
    "Email",
    "Call",
    "SMS",
    "WhatsApp",
  ]);
  await contactMethod.selectOption("email");
  await page
    .getByLabel("Academy / school / organisation", { exact: false })
    .fill("Synthetic School");
}
async function stopMechanism(
  page: Page,
  mechanism: Awaited<ReturnType<typeof createBookingMechanism>>,
  transport: Awaited<ReturnType<typeof mechanismTransport>>,
) {
  try {
    if (!page.isClosed()) await page.goto("about:blank");
    await transport.drain();
  } finally {
    await mechanism.close();
  }
}
async function reviewResponse(page: Page) {
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith("/api/booking/hold/") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Review booking", exact: true })
    .click();
  return response;
}
async function assertNoPaymentOrConfirmation(
  page: Page,
  mechanism: Awaited<ReturnType<typeof createBookingMechanism>>,
) {
  await expect(
    page.getByRole("heading", { name: "Booking confirmed", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open checkout", exact: true }),
  ).toHaveCount(0);
  expect(
    mechanism.calls.filter(
      (call) => new URL(call.url).hostname === "api.sandbox.hit-pay.com",
    ),
  ).toHaveLength(0);
  expect(mechanism.unexpected).toEqual([]);
}

test("real API rejected slot returns to selection and retains contact without creating a booking", async ({
  page,
}) => {
  let reject = false;
  const mechanism = await createBookingMechanism({
    respond: async (call) =>
      reject && call.body?.method === "getAvailableUnits"
        ? Response.json({ jsonrpc: "2.0", id: call.body.id, result: [] })
        : undefined,
  });
  const transport = await mechanismTransport(page, mechanism);
  try {
    await guestDetails(page, mechanism);
    reject = true;
    const response = await reviewResponse(page);
    expect((await response.json()).state).toBe("selection_unavailable");
    await expect(page).toHaveURL(/\/book\/time\/$/);
    await expect(
      page.getByText(
        "This selection is no longer available or has changed. Please choose again. Your details have been kept.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(0);
    const row = await mechanism.db
      .prepare("SELECT intent_json FROM attempts")
      .first<{ intent_json: string }>();
    expect(JSON.parse(row!.intent_json).contact).toMatchObject({
      name: "Synthetic Guest",
      academy: "Synthetic School",
    });
    await assertNoPaymentOrConfirmation(page, mechanism);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
});

test("real API price drift rejects review before creation instead of silently changing the total", async ({
  page,
}) => {
  let drift = false;
  const mechanism = await createBookingMechanism({
    respond: async (call) =>
      drift && call.body?.method === "getEventList"
        ? Response.json({
            jsonrpc: "2.0",
            id: call.body.id,
            result: {
              2: {
                id: 2,
                name: "Native Session",
                duration: "40",
                is_active: "1",
                is_public: "1",
                is_recurring: "0",
                price: "89",
                currency: "SGD",
                unit_map: [14],
              },
            },
          })
        : undefined,
  });
  const transport = await mechanismTransport(page, mechanism);
  try {
    await guestDetails(page, mechanism);
    drift = true;
    const response = await reviewResponse(page);
    expect((await response.json()).state).toBe("restart_required");
    await expect(page).toHaveURL(/\/book\/time\/$/);
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(0);
    const row = await mechanism.db
      .prepare("SELECT intent_json FROM attempts")
      .first<{ intent_json: string }>();
    expect(JSON.parse(row!.intent_json).totalMinor).toBe(8800);
    await assertNoPaymentOrConfirmation(page, mechanism);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
});

async function uncertainHolding(
  page: Page,
  fault: "preflight" | "creation" | "readback",
) {
  let enabled = false;
  const method = {
    preflight: "getEventList",
    creation: "book",
    readback: "getBookingDetails",
  }[fault];
  const mechanism = await createBookingMechanism({
    respond: async (call) =>
      enabled && call.body?.method === method
        ? new Response(null, { status: 503 })
        : undefined,
  });
  const transport = await mechanismTransport(page, mechanism);
  try {
    await guestDetails(page, mechanism);
    enabled = true;
    const response = await reviewResponse(page);
    expect(response.status()).toBe(200);
    expect((await response.json()).state).toBe(
      fault === "preflight" ? "prerequisites_unavailable" : "recovery_required",
    );
    await expect(page).toHaveURL(/\/book\/payment\/$/);
    await expect(
      page.getByRole("status", {
        name: "Checking your payment and booking…",
        exact: true,
      }),
    ).toBeVisible();
    await assertNoPaymentOrConfirmation(page, mechanism);
    const row = await mechanism.db
      .prepare(
        "SELECT id,intent_hash,association_json,deadline_ms FROM attempts",
      )
      .first();
    expect(row).toBeTruthy();
    expect(Boolean(row!.association_json)).toBe(fault === "readback");
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(fault === "preflight" ? 0 : 1);
    const restored = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/booking/current",
    );
    await page.reload();
    await restored;
    await expect(
      page.getByRole("heading", { name: "Booking confirmed", exact: true }),
    ).toHaveCount(0);
    expect(
      await mechanism.db
        .prepare(
          "SELECT id,intent_hash,association_json,deadline_ms FROM attempts",
        )
        .first(),
    ).toEqual(row);
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(fault === "preflight" ? 0 : 1);
    expect(
      (await mechanism.db
        .prepare("SELECT COUNT(*) AS n FROM hitpay_holds")
        .first<{ n: number }>())!.n,
    ).toBe(0);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
}

test("real API provider outage before creation shows unresolved state and cannot create a payment", async ({
  page,
}) => {
  await uncertainHolding(page, "preflight");
});
test("real API unknown creation response retains one attempt across reload without replay", async ({
  page,
}) => {
  await uncertainHolding(page, "creation");
});
test("real API failed booking readback retains created references and blocks checkout", async ({
  page,
}) => {
  await uncertainHolding(page, "readback");
});

test("real API revoked access during Details keeps the form and prevents provider creation", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism();
  const transport = await mechanismTransport(page, mechanism);
  try {
    await guestDetails(page, mechanism);
    await mechanism.db
      .prepare("UPDATE guest_access SET revoked_ms=?")
      .bind(Date.now())
      .run();
    const response = await reviewResponse(page);
    expect(response.status()).toBe(401);
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Online booking is unavailable. Your selections have been kept.",
    );
    await expect(page.getByLabel("Full name", { exact: false })).toHaveValue(
      "Synthetic Guest",
    );
    await expect(
      page.getByLabel("Academy / school / organisation", { exact: false }),
    ).toHaveValue("Synthetic School");
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(0);
    await assertNoPaymentOrConfirmation(page, mechanism);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
});

test("real API lost successful hold response restores the existing reservation without recreating it", async ({
  page,
}) => {
  let dropped = false;
  const mechanism = await createBookingMechanism();
  const transport = await mechanismTransport(
    page,
    mechanism,
    undefined,
    (path) => {
      if (!dropped && path.startsWith("/api/booking/hold/")) {
        dropped = true;
        return true;
      }
      return false;
    },
  );
  try {
    await guestDetails(page, mechanism);
    await page
      .getByRole("button", { name: "Review booking", exact: true })
      .click();
    await expect(page).toHaveURL(/\/book\/review\/$/);
    await expect(
      page.getByRole("heading", { name: "Review booking", exact: true }),
    ).toBeVisible();
    expect(dropped).toBe(true);
    const held = await mechanism.db
      .prepare("SELECT attempt_id FROM hitpay_holds")
      .first<{ attempt_id: string }>();
    expect(held).toBeTruthy();
    const restored = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/booking/current" &&
        response.status() === 200,
    );
    await page.reload();
    expect(await (await restored).json()).toMatchObject({
      attemptId: held!.attempt_id,
      state: "held",
    });
    await expect(page).toHaveURL(/\/book\/review\/$/);
    await expect(
      page.getByRole("heading", { name: "Review booking", exact: true }),
    ).toBeVisible();
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(1);
    expect(
      transport.calls.filter((call) =>
        call.path.startsWith("/api/booking/hold/"),
      ),
    ).toHaveLength(1);
    await assertNoPaymentOrConfirmation(page, mechanism);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
});

test("real API payment creation failure preserves the hold and never returns to slot selection", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism({
    respond: async (call) =>
      new URL(call.url).hostname === "api.sandbox.hit-pay.com" &&
      call.method === "POST"
        ? new Response(null, { status: 503 })
        : undefined,
  });
  const transport = await mechanismTransport(page, mechanism);
  try {
    await guestDetails(page, mechanism);
    expect((await reviewResponse(page)).status()).toBe(200);
    await expect(page).toHaveURL(/\/book\/review\/$/);
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Continue to payment", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Payment checkout could not be verified",
    );
    await expect(page).toHaveURL(/\/book\/review\/$/);
    await expect(
      page.getByRole("link", { name: "Review selections", exact: true }),
    ).toHaveCount(0);
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(1);
    expect(
      (await mechanism.db
        .prepare("SELECT COUNT(*) AS n FROM hitpay_holds")
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (await mechanism.db
        .prepare("SELECT COUNT(*) AS n FROM hitpay_payments")
        .first<{ n: number }>())!.n,
    ).toBe(1);
    await expect(
      page.getByRole("heading", { name: "Booking confirmed", exact: true }),
    ).toHaveCount(0);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
});

test("real API failed completed dismissal opens the first step and explicit retry retains the saved receipt", async ({
  page,
}) => {
  let failDismissal = true;
  const mechanism = await createBookingMechanism();
  const transport = await mechanismTransport(
    page,
    mechanism,
    undefined,
    (path) => {
      if (failDismissal && path.endsWith("/dismiss")) {
        failDismissal = false;
        return true;
      }
      return false;
    },
  );
  try {
    const { headers, attemptId } = await prepareBrowserAttempt(page, mechanism);
    const held = await mechanism.mf.dispatchFetch(
      mechanism.origin + `/api/booking/native/${attemptId}?hold=1`,
      { method: "POST", headers },
    );
    expect(await held.json()).toMatchObject({ state: "associated" });
    const payment = await mechanism.mf.dispatchFetch(
      mechanism.origin + `/api/booking/hitpay/${attemptId}`,
      { method: "POST", headers, body: JSON.stringify({ accepted: true }) },
    );
    expect(await payment.json()).toMatchObject({ paymentAvailable: true });
    expect((await mechanism.completePayment()).status).toBe(202);
    const savedConfirmation = page.waitForResponse(async (response) => {
      const path = new URL(response.url()).pathname;
      if (
        response.status() !== 200 ||
        ![
          `/api/attempts/${attemptId}/checkout`,
          `/api/attempts/${attemptId}/confirmation`,
        ].includes(path)
      )
        return false;
      const body = await response.json();
      return (
        body.confirmation?.attemptId === attemptId ||
        body.status === "confirmed"
      );
    });
    await page.goto(`/confirmation/?attempt=${attemptId}`);
    await page
      .getByRole("dialog", { name: "Get the SoccerBot Player App" })
      .getByRole("button", { name: "Not now", exact: true })
      .click();
    await savedConfirmation;
    await expect(
      page.getByRole("heading", { name: "Booking confirmed", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Client Details", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Make another booking", exact: true })
      .click();
    await expect(page).toHaveURL(/\/book\/account\/$/);
    await expect(
      page.getByRole("button", { name: "Continue as guest", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Your confirmation is saved",
    );
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("soccerbot.completed-exit"),
      ),
    ).toBe(attemptId);
    // The first dismissal completed on the server, but its HTTP response was
    // lost. Retry under the same owner must acknowledge the archived result.
    expect(failDismissal).toBe(false);
    const dismissed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/dismiss") &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await dismissed;
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("soccerbot.completed-exit"),
      ),
    ).toBeNull();
    await page.goto(`/confirmation/?attempt=${attemptId}`);
    await expect(
      page.getByRole("heading", { name: "Client Details", exact: true }),
    ).toBeVisible();
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(1);
    expect(
      mechanism.calls.filter((call) => call.url.endsWith("/accept-payment")),
    ).toHaveLength(1);
    expect(
      transport.calls.filter((call) => call.path.endsWith("/dismiss")),
    ).toHaveLength(2);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
});

test("real API catalogue outage exposes retry without inventing sessions or renewing provider calls", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism({
    respond: async (call) =>
      new URL(call.url).pathname === "/admin/auth"
        ? new Response(null, { status: 403 })
        : undefined,
  });
  const transport = await mechanismTransport(page, mechanism);
  try {
    await page.goto("/book/account/");
    await page
      .getByRole("dialog", { name: "Get the SoccerBot Player App" })
      .getByRole("button", { name: "Not now", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Continue as guest", exact: true })
      .click();
    await expect(page).toHaveURL(/\/book\/session\/$/);
    await expect(
      page.getByText(
        "Session information is unavailable. Your details have been kept.",
        { exact: true },
      ),
    ).toBeVisible();
    const before = mechanism.calls.length;
    const retry = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/catalogue" &&
        response.status() === 503,
    );
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await retry;
    await expect(
      page.getByText(
        "Session information is unavailable. Your details have been kept.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(mechanism.calls).toHaveLength(before);
    await expect(
      page.getByRole("link", { name: "See available times", exact: true }),
    ).toHaveCount(0);
    await assertNoPaymentOrConfirmation(page, mechanism);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
});

test("real API batch hold checks each session once and restores one complete unpaid reservation", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism({ batch: true });
  const transport = await mechanismTransport(page, mechanism);
  try {
    await guestDetails(page, mechanism, true);
    const before = mechanism.calls.length;
    expect(await (await reviewResponse(page)).json()).toMatchObject({
      state: "associated",
      paymentAvailable: false,
    });
    await expect(page).toHaveURL(/\/book\/review\/$/);
    const methods = mechanism.calls
      .slice(before)
      .map((call) => call.body?.method)
      .filter(Boolean);
    expect(
      methods.filter((method) => method === "getAvailableUnits"),
    ).toHaveLength(2);
    expect(
      methods.filter((method) => method === "getStartTimeMatrix"),
    ).toHaveLength(2);
    expect(methods.filter((method) => method === "book")).toHaveLength(2);
    expect(methods.filter((method) => method === "createBatch")).toHaveLength(
      1,
    );
    expect(methods.filter((method) => method === "closeBatch")).toHaveLength(1);
    const held = await mechanism.db
      .prepare("SELECT attempt_id FROM hitpay_holds")
      .first();
    expect(held).toBeTruthy();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Review booking", exact: true }),
    ).toBeVisible();
    expect(
      await mechanism.db.prepare("SELECT attempt_id FROM hitpay_holds").first(),
    ).toEqual(held);
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(2);
    await assertNoPaymentOrConfirmation(page, mechanism);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
});

async function failedBatch(page: Page, unknown: boolean) {
  let creations = 0;
  const mechanism = await createBookingMechanism({
    batch: true,
    respond: async (call) => {
      if (call.body?.method === "book") {
        creations++;
        if (unknown && creations === 2)
          return new Response(null, { status: 503 });
      }
      if (
        !unknown &&
        creations === 1 &&
        call.body?.method === "getAvailableUnits"
      )
        return Response.json({ jsonrpc: "2.0", id: call.body.id, result: [] });
      return undefined;
    },
  });
  const transport = await mechanismTransport(page, mechanism);
  try {
    await guestDetails(page, mechanism, true);
    expect(await (await reviewResponse(page)).json()).toMatchObject({
      state: "recovery_required",
      paymentAvailable: false,
    });
    await expect(page).toHaveURL(/\/book\/payment\/$/);
    const rows = await mechanism.db
      .prepare(
        "SELECT step,outcome,reference_id FROM session_effects WHERE step LIKE 'session:%' ORDER BY step",
      )
      .all();
    expect(rows.results).toEqual(
      unknown
        ? [
            { step: "session:0", outcome: "observed", reference_id: "701" },
            { step: "session:1", outcome: "unknown", reference_id: null },
          ]
        : [{ step: "session:0", outcome: "observed", reference_id: "701" }],
    );
    expect(
      mechanism.calls.filter((call) => call.body?.method === "closeBatch"),
    ).toHaveLength(0);
    expect(
      await mechanism.db
        .prepare("SELECT COUNT(*) AS n FROM hitpay_holds")
        .first(),
    ).toEqual({ n: 0 });
    await page.reload();
    await expect(
      page.getByRole("status", {
        name: "Checking your payment and booking…",
        exact: true,
      }),
    ).toBeVisible();
    expect(creations).toBe(unknown ? 2 : 1);
    expect(
      await mechanism.db
        .prepare(
          "SELECT step,outcome,reference_id FROM session_effects WHERE step LIKE 'session:%' ORDER BY step",
        )
        .all(),
    ).toMatchObject({ results: rows.results });
    await assertNoPaymentOrConfirmation(page, mechanism);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
}
test("real API later batch conflict retains the first booking without checkout or recreation", async ({
  page,
}) => {
  await failedBatch(page, false);
});
test("real API unknown second batch creation retains both effect outcomes across reload without payment", async ({
  page,
}) => {
  await failedBatch(page, true);
});

test("real API exhausted browser checking window retains the original deadline and uncertain booking without payment", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism({
    respond: async (call) =>
      call.body?.method === "book"
        ? new Response(null, { status: 503 })
        : undefined,
  });
  const transport = await mechanismTransport(page, mechanism);
  try {
    const { headers, attemptId } = await prepareBrowserAttempt(page, mechanism);
    const hold = await mechanism.mf.dispatchFetch(
      mechanism.origin + `/api/booking/native/${attemptId}?hold=1`,
      { method: "POST", headers },
    );
    expect(await hold.json()).toMatchObject({
      state: "recovery_required",
      paymentAvailable: false,
    });
    const row = await mechanism.db
      .prepare("SELECT id,intent_hash,deadline_ms FROM attempts WHERE id=?")
      .bind(attemptId)
      .first();
    await page.addInitScript((id) => {
      localStorage.setItem(
        `soccerbot-checking:${id}`,
        JSON.stringify({ deadline: Date.now() - 1, next: 0, count: 120 }),
      );
    }, attemptId);
    await page.goto(`/confirmation/?attempt=${attemptId}`);
    await page
      .getByRole("dialog", { name: "Get the SoccerBot Player App" })
      .getByRole("button", { name: "Not now", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Your booking needs review",
        exact: true,
      }),
    ).toBeVisible();
    await assertNoPaymentOrConfirmation(page, mechanism);
    expect(
      await mechanism.db
        .prepare("SELECT id,intent_hash,deadline_ms FROM attempts WHERE id=?")
        .bind(attemptId)
        .first(),
    ).toEqual(row);
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(1);
    expect(
      await mechanism.db
        .prepare(
          "SELECT outcome FROM session_effects WHERE attempt_id=? AND step='session:0'",
        )
        .bind(attemptId)
        .first(),
    ).toEqual({ outcome: "unknown" });
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
});

async function optimisticHold(page: Page, failReadback: boolean) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let readbackStarted!: () => void;
  const created = new Promise<void>((resolve) => {
    readbackStarted = resolve;
  });
  let releaseComment!: () => void;
  let commentStarted!: () => void;
  const commentGate = new Promise<void>((resolve) => {
    releaseComment = resolve;
  });
  const commenting = new Promise<void>((resolve) => {
    commentStarted = resolve;
  });
  const mechanism = await createBookingMechanism({
    respond: async (call) => {
      if (call.url.endsWith("/admin/bookings/701/comment")) {
        commentStarted();
        await commentGate;
      }
      if (call.body?.method === "getBookingDetails") {
        readbackStarted();
        await gate;
        if (failReadback) return new Response(null, { status: 503 });
      }
      return undefined;
    },
  });
  const transport = await mechanismTransport(page, mechanism);
  let reviewRequests = 0;
  await page.route("**/book/review/**", async (route) => {
    reviewRequests++;
    await route.continue();
  });
  try {
    await guestDetails(page, mechanism);
    const result = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/api/booking/hold/") &&
        response.status() === 200,
    );
    await page
      .getByRole("button", { name: "Review booking", exact: true })
      .click();
    await commenting;
    await expect(
      page.getByRole("heading", { name: "Review booking", exact: true }),
    ).toHaveCount(0);
    releaseComment();
    // Assert the creation milestone, not a five-second budget for preflight.
    // The original request stays blocked at readback throughout UI assertions.
    await created;
    await expect(
      page.getByRole("heading", { name: "Review booking", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Verifying your reservation…" }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole("list", { name: "Booking progress" })
        .getByRole("listitem")
        .filter({ hasText: "Review" }),
    ).toHaveAttribute("aria-current", "step");
    await expect(
      page.getByRole("link", { name: "Back", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Edit selections", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator(".booking-flow-overlay, .page-loading-emblem"),
    ).toHaveCount(0);
    expect(
      await mechanism.db
        .prepare("SELECT COUNT(*) AS n FROM hitpay_holds")
        .first(),
    ).toEqual({ n: 0 });
    const review = await page
      .getByRole("heading", { name: "Review booking", exact: true })
      .elementHandle();
    release();
    expect(await (await result).json()).toMatchObject({
      state: failReadback ? "recovery_required" : "associated",
    });
    if (!failReadback) {
      await expect(page).toHaveURL(/\/book\/review\/$/);
      expect(reviewRequests).toBe(0);
      expect(await review?.evaluate((element) => element.isConnected)).toBe(
        true,
      );
      await expect(
        page.getByRole("heading", { name: "Review booking", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(".booking-flow-overlay, .page-loading-emblem"),
      ).toHaveCount(0);
    }
    await expect(page).toHaveURL(
      failReadback ? /\/book\/payment\/$/ : /\/book\/review\/$/,
    );
    if (!failReadback) {
      await page.getByRole("checkbox").check();
      await expect(
        page.getByRole("button", { name: "Continue to payment", exact: true }),
      ).toBeEnabled();
    } else
      await expect(
        page.getByRole("button", { name: "Continue to payment", exact: true }),
      ).toHaveCount(0);
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(1);
    await assertNoPaymentOrConfirmation(page, mechanism);
  } finally {
    releaseComment();
    release();
    await stopMechanism(page, mechanism, transport);
  }
}
test("real API created hold opens pending Review before readback and enables payment only after verification", async ({
  page,
}) => {
  await optimisticHold(page, false);
});
test("real API optimistic Review preserves the original attempt when booking readback fails", async ({
  page,
}) => {
  await optimisticHold(page, true);
});

test("real API unpaid return shows the pending confirmation layout without claiming payment or allowing downloads", async ({
  page,
}) => {
  const mechanism = await createBookingMechanism();
  const transport = await mechanismTransport(page, mechanism);
  try {
    const { headers, attemptId } = await prepareBrowserAttempt(page, mechanism);
    const held = await mechanism.mf.dispatchFetch(
      mechanism.origin + `/api/booking/native/${attemptId}?hold=1`,
      { method: "POST", headers },
    );
    expect(await held.json()).toMatchObject({ state: "associated" });
    await page.goto(`/confirmation/?attempt=${attemptId}`);
    await page
      .getByRole("dialog", { name: "Get the SoccerBot Player App" })
      .getByRole("button", { name: "Not now", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Client Details", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Session Details" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", {
        name: "Checking your payment and booking…",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Booking confirmed", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Download/ })).toHaveCount(0);
    await expect(page.getByLabel("Booking actions")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Back to home", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("Paid", { exact: true })).toHaveCount(0);
    expect(
      mechanism.calls.filter((call) => call.body?.method === "book"),
    ).toHaveLength(1);
    await assertNoPaymentOrConfirmation(page, mechanism);
  } finally {
    await stopMechanism(page, mechanism, transport);
  }
});
