import { test, expect, type Page } from "@playwright/test";
import { sitePath } from "../src/content/site-path";
async function start(page: Page) {
  await page.goto(sitePath("/experiment/"));
  const prompt = page.getByRole("dialog", {
    name: "Get the SoccerBot Player App",
  });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(prompt).toHaveCount(0);
  await page.getByRole("button", { name: "Start synthetic checkout" }).click();
  const link = page.getByRole("link", { name: "Open checkout", exact: true });
  await expect(link).toBeVisible();
  return link;
}
async function outcome(page: Page, label: string) {
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: /Open checkout/ }).click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("heading", { name: "Simulated checkout" }),
  ).toBeVisible();
  await popup.getByRole("button", { name: label, exact: true }).click();
  await expect(
    popup.getByRole("heading", { name: "Synthetic evidence saved" }),
  ).toBeVisible();
  // Await the real bounded read rather than extending assertion timeouts or sleeping.
  const read = page.waitForResponse(
    (r) => r.url().endsWith("/confirmation") && [200, 401].includes(r.status()),
  );
  await page.bringToFront();
  await read;
  return popup;
}
test("synthetic checkout opens separately and only canonical evidence confirms the preserved attempt", async ({
  page,
}, info) => {
  const link = await start(page);
  const url = await link.getAttribute("href");
  const original = page.url();
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await page.screenshot({
    path: info.outputPath("01-pending.png"),
    fullPage: true,
  });
  const opening = page.waitForEvent("popup");
  await link.click();
  const popup = await opening;
  await expect(
    popup.getByRole("heading", { name: "Simulated checkout" }),
  ).toBeVisible();
  expect(
    await popup.evaluate(() => ({
      opener: window.opener,
      referrer: document.referrer,
    })),
  ).toEqual({ opener: null, referrer: "" });
  await popup.screenshot({
    path: info.outputPath("02-checkout.png"),
    fullPage: true,
  });
  await popup.close();
  await page.bringToFront();
  expect(page.url()).toBe(original);
  await page.evaluate(() => {
    history.replaceState(
      null,
      "",
      location.href + "&paid=true&status=confirmed",
    );
    window.postMessage({ status: "confirmed", paid: true }, "*");
  });
  await expect(
    page.getByRole("heading", { name: "Booking confirmed", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open checkout again" }),
  ).toHaveAttribute("href", url!);
  await outcome(page, "Simulate successful payment");
  await expect(
    page.getByRole("heading", { name: "Booking confirmed", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("03-confirmed.png"),
    fullPage: true,
  });
});
test("synthetic paid but invalid booking needs recovery instead of claiming success", async ({
  page,
}, info) => {
  await start(page);
  await outcome(page, "Simulate payment needing review");
  await expect(
    page.getByRole("heading", { name: "Your booking needs review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Booking confirmed", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/does not mean your payment was cancelled/),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("04-recovery.png"),
    fullPage: true,
  });
});
test("synthetic access revocation hides protected details and stops checking", async ({
  page,
}) => {
  await start(page);
  await outcome(page, "Expire synthetic access");
  await expect(
    page.getByRole("heading", { name: "Confirmation unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText(/access has expired or was revoked/),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Current booking summary" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open checkout/ })).toHaveCount(
    0,
  );
});
test("reload and duplicate tabs retain one checking window with a shared server allowance", async ({
  page,
  context,
}) => {
  await start(page);
  const id = new URL(page.url()).searchParams.get("attempt")!;
  const budget = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`soccerbot-checking:${id}`)!),
    id,
  );
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Current booking summary" }),
  ).toBeVisible();
  const duplicate = await context.newPage();
  await duplicate.goto(page.url());
  await expect(
    duplicate.getByRole("region", { name: "Current booking summary" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem(`soccerbot-checking:${id}`)!).deadline,
      id,
    ),
  ).toBe(budget.deadline);
  const responses = await Promise.all(
    [0, 1, 2].map(() =>
      context.request.get(`/api/attempts/${id}/confirmation`),
    ),
  );
  expect(
    responses.filter((r) => r.status() === 200).length,
  ).toBeLessThanOrEqual(1);
  expect(responses.every((r) => [200, 429].includes(r.status()))).toBe(true);
  for (const r of responses)
    expect(Number(r.headers()["x-checking-deadline"])).toBe(budget.deadline);
  await duplicate.close();
});
test("the Payment preview entry and temporary checking failure retain customer selections and contact", async ({
  page,
}) => {
  const { addDays, dateLabel, todaySG } = await import("../src/domain/dates");
  await page.goto(sitePath("/book/account/"));
  await page
    .getByRole("dialog", { name: "Get the SoccerBot Player App" })
    .getByRole("button", { name: "Not now", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByRole("link", { name: "See available times" }).click();
  await page
    .getByRole("button", {
      name: dateLabel(addDays(todaySG(), 1)),
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /09:00–09:40/ }).click();
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Full name", { exact: false })
    .fill("Synthetic Customer");
  await page
    .getByLabel("Email address", { exact: false })
    .fill("synthetic@example.com");
  await page
    .getByLabel("Mobile number", { exact: false })
    .fill("+65 8123 4567");
  await page.getByRole("button", { name: "Review booking" }).click();
  await page.getByRole("checkbox", { name: /I’ve reviewed/ }).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const before = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("soccerbot-next-demo-v2")!),
  );
  await page
    .getByRole("link", { name: "Try separate checkout · Synthetic Preview" })
    .click();
  await page.route("**/api/attempts/*/confirmation", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"temporarily_unavailable"}',
    }),
  );
  await page.getByRole("button", { name: "Start synthetic checkout" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirmation unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Current booking summary" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("soccerbot-next-demo-v2")!),
    ),
  ).toEqual(before);
});
