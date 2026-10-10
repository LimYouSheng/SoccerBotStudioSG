import { expect, test, type Page } from "@playwright/test";

// CI-only synthetic transports. No widget script, email or provider is contacted.
const sitekey = "0x4AAAAAAFSTbdgbJQsvM5vy";
const challengeId = "10000000-0000-4000-8000-000000000001";
async function fixture(page: Page, delivery = false) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  let verified = false;
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
      status = 200;
      result = verified
        ? { email: "synthetic@example.test", expiresAt: Date.now() + 600000 }
        : null;
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
      status = 200;
      result = {
        email: "synthetic@example.test",
        expiresAt: Date.now() + 600000,
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
  expect(evidence.unexpected).toEqual([]);
});
