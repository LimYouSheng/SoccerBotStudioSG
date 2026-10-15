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

test("native guest journey preserves players contact and one checkout across refresh", async ({
  page,
}) => {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + 3 * 86400000));
  const startMs = Date.parse(`${date}T08:10:00+08:00`);
  const attemptId = "20000000-0000-4000-8000-000000000001";
  const checkoutUrl =
    "https://securecheckout.sandbox.hit-pay.com/payment-request/@soccerbot/20000000-0000-4000-8000-000000000002/checkout";
  const offer = {
    serviceId: "12",
    serviceName: "Native Session",
    instructorId: "14",
    instructorName: "Native Trainer",
    startMs,
    priceMinor: 8800,
    currency: "SGD",
  };
  const calls: { path: string; method: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  let prepared: { contact: unknown; sessions: { players: number }[] } | null =
    null;
  let committed = false;
  let paymentStarted = false;
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.href === "https://soccerbotstudiosg.simplybook.asia/v2/") {
      // Synthetic frame only: preserve the no-provider-network browser gate.
      await route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Synthetic initialization</title>",
      });
      return;
    }
    if (url.href === checkoutUrl) {
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
    let status = 200,
      result: unknown;
    if (url.pathname === "/api/access") {
      status = 201;
      result = {};
    } else if (
      ["/api/identity", "/api/identity/restore"].includes(url.pathname)
    )
      result = null;
    else if (url.pathname === "/api/booking/current")
      result = prepared
        ? {
            state: paymentStarted
              ? "checking"
              : committed
                ? "held"
                : "prepared",
            attemptId,
            contact: prepared.contact,
            sessions: [{ ...offer, players: prepared.sessions[0].players }],
          }
        : { state: "empty" };
    else if (url.pathname === "/api/catalogue")
      result = {
        environment: "developer",
        observedAtMs: Date.now(),
        complete: true,
        services: [
          {
            id: "12",
            name: "Native Session",
            active: true,
            durationMinutes: 40,
            recurring: false,
            priceMinor: 8800,
            currency: "SGD",
            instructorIds: ["14"],
          },
        ],
        instructors: [{ id: "14", name: "Native Trainer", active: true }],
      };
    else if (url.pathname.startsWith("/api/calendar/")) {
      const month = url.pathname.split("/").at(-1);
      result = {
        month,
        serviceId: "12",
        observedAtMs: Date.now(),
        dates: date.startsWith(month + "-")
          ? [{ date, available: true, offers: [offer] }]
          : [],
      };
    } else if (url.pathname.startsWith("/api/booking/calendar/12/")) {
      const month = url.pathname.split("/").at(-1);
      result = {
        month,
        observedAtMs: Date.now(),
        dates: date.startsWith(month + "-")
          ? [{ date, observedAtMs: Date.now(), offers: [offer] }]
          : [],
      };
    } else if (url.pathname.startsWith("/api/booking/availability/12/")) {
      const requested = url.pathname.split("/").at(-1);
      result = {
        date: requested,
        observedAtMs: Date.now(),
        offers: requested === date ? [offer] : [],
      };
    } else if (
      url.pathname === "/api/booking/prepare" &&
      request.method() === "POST"
    ) {
      prepared = body as typeof prepared;
      result = { attemptId, state: "prepared" };
    } else if (
      url.pathname === `/api/booking/native/${attemptId}` &&
      request.method() === "POST"
    ) {
      expect(url.searchParams.get("hold")).toBe("1");
      committed = true;
      result = { attemptId, state: "associated", paymentAvailable: false };
    } else if (
      url.pathname === `/api/booking/hitpay/${attemptId}` &&
      request.method() === "POST"
    ) {
      expect(committed).toBe(true);
      expect(body).toEqual({ accepted: true });
      paymentStarted = true;
      result = { attemptId, state: "associated", paymentAvailable: true };
    } else if (url.pathname === `/api/attempts/${attemptId}/checkout`)
      result = {
        attemptId,
        mode: "live",
        checkout: {
          state: "available",
          url: checkoutUrl,
          expiresAtMs: Date.now() + 300000,
        },
        summary: {
          players: 2,
          totalMinor: 8800,
          currency: "SGD",
          sessions: [{ startMs, players: 2 }],
        },
        checking: {
          deadlineMs: Date.now() + 600000,
          nextCheckMs: Date.now(),
          pollAfterMs: 30000,
        },
      };
    else if (url.pathname === `/api/attempts/${attemptId}/confirmation`)
      result = { status: "pending", reason: "payment_pending" };
    else {
      status = 503;
      result = { error: "unavailable" };
    }
    await route.fulfill({ status, json: result });
  });
  await page.goto("/");
  await page
    .getByRole("dialog", { name: "Get the SoccerBot Player App" })
    .getByRole("button", { name: "Not now", exact: true })
    .click();
  await expect
    .poll(() => calls.filter((c) => c.path.startsWith("/api/calendar/")).length)
    .toBe(4);
  await expect
    .poll(() => calls.filter((c) => c.path === "/api/catalogue").length)
    .toBe(1);
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
  expect(calls.filter((c) => c.path.startsWith("/api/calendar/"))).toHaveLength(
    4,
  );
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
  await page.getByLabel("Full name", { exact: false }).fill("Synthetic Guest");
  await page
    .getByLabel("Email address", { exact: false })
    .fill("synthetic@example.test");
  await page.getByLabel("Mobile number", { exact: false }).fill("+6591234567");
  await page
    .getByLabel("Preferred contact method", { exact: false })
    .selectOption("email");
  await page
    .getByLabel("Academy / school / organisation", { exact: false })
    .fill("Synthetic School");
  await page
    .getByRole("button", { name: "Review booking", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review booking", exact: true }),
  ).toBeVisible();
  expect(
    calls.filter((c) => c.path.startsWith("/api/booking/availability/")),
  ).toHaveLength(1);
  expect(
    calls.filter((c) => c.path === `/api/booking/native/${attemptId}`),
  ).toHaveLength(1);
  expect(
    calls.filter((c) => c.path === `/api/booking/hitpay/${attemptId}`),
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
        serviceId: "12",
        instructorId: "14",
        startMs,
        players: 2,
        totalMinor: 8800,
      },
    ],
  });
  await page.goto(`http://127.0.0.1:4173/confirmation/?attempt=${attemptId}`);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Open checkout", exact: true }),
  ).toHaveCount(0);
  expect(
    calls.filter(
      (c) =>
        c.path === `/api/booking/hitpay/${attemptId}` && c.method === "POST",
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
        c.path === `/api/booking/native/${attemptId}` && c.method === "POST",
    ),
  ).toHaveLength(1);
  expect(
    calls.filter(
      (c) => c.path === "/api/identity/contact" && c.method === "POST",
    ),
  ).toHaveLength(0);
  expect(unexpected).toEqual([]);
});
