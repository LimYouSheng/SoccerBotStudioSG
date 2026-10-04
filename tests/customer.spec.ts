import { expect, test, type Page } from "@playwright/test";
import { addDays, dateLabel } from "../src/domain/dates";
const DEMO_TODAY = "2026-10-05";
test.beforeEach(async ({ page }) => {
  // Payment deadlines need Date.now() to advance alongside the timers.
  await page.clock.install({ time: new Date("2026-10-05T08:00:00+08:00") });
});
async function chooseSlots(page: Page, multiple = false) {
  await page.goto("/book/account/");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByRole("link", { name: "See available times" }).click();
  await page
    .getByRole("button", {
      name: dateLabel(addDays(DEMO_TODAY, 1)),
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /10:00–10:40/ }).click();
  if (multiple) {
    await page
      .getByRole("button", {
        name: dateLabel(addDays(DEMO_TODAY, 2)),
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: /10:00–10:40/ }).click();
  }
  await page.getByRole("radio", { name: /Faisal Shahril/ }).check();
  await page.getByRole("link", { name: "Continue", exact: true }).click();
}
async function details(page: Page) {
  await page.getByLabel("Full name", { exact: false }).fill("Demo Customer");
  await page
    .getByLabel("Email address", { exact: false })
    .fill("customer@example.com");
  await page
    .getByLabel("Mobile number", { exact: false })
    .fill("+65 8123 4567");
  await page.getByLabel("Participant age group").selectOption("adult");
  await page.getByLabel("Football experience").selectOption("new");
  await page.getByLabel("Emergency contact name").fill("Emergency Person");
  await page.getByLabel("Emergency contact mobile").fill("+65 9123 4567");
  await page
    .getByLabel("Emergency contact relationship")
    .selectOption("family");
  await page.getByRole("button", { name: "Review booking" }).click();
  await page.getByRole("checkbox", { name: /I’ve reviewed/ }).check();
}
async function payment(page: Page, outcome = "success") {
  await page.getByRole("button", { name: "Continue to payment" }).click();
  if (outcome !== "success") {
    await page.getByText("Preview controls", { exact: true }).click();
    await page.getByLabel("Payment outcome").selectOption(outcome);
  }
  await page.getByRole("button", { name: /^Pay \$/ }).click();
}
test("public routes remove staff access and fit the viewport", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your next session starts here." }),
  ).toBeAttached();
  await expect(
    page.getByText(/staff login|staff access|command centre/i),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "The studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Inside the arena." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const response = await page.goto("/admin/");
  expect(response?.status()).toBe(404);
  expect(errors).toEqual([]);
});
test("guest multi-date booking survives reload and exports calendar and PDF", async ({
  page,
}) => {
  await chooseSlots(page, true);
  await details(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Review booking", exact: true }),
  ).toBeVisible();
  await payment(page);
  await expect(
    page.getByRole("heading", { name: "Booking confirmed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Studio 1", { exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const calendar = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to calendar" }).click();
  expect((await calendar).suggestedFilename()).toMatch(/\.ics$/);
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download booking details" }).click();
  expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Booking confirmed", exact: true }),
  ).toBeVisible();
});
test("declined and pending payments remain controlled through retry and refresh", async ({
  page,
}) => {
  await chooseSlots(page);
  await details(page);
  await payment(page, "declined");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "wasn’t completed",
  );
  await page.getByText("Preview controls", { exact: true }).click();
  await page.getByLabel("Payment outcome").selectOption("pending");
  await page.getByRole("button", { name: /^Pay \$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Payment pending", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Payment pending", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check payment status" }).click();
  await expect(
    page.getByRole("heading", { name: "Booking confirmed", exact: true }),
  ).toBeVisible();
});
test("late payment has a contact path without another payment", async ({
  page,
}) => {
  await chooseSlots(page);
  await details(page);
  await payment(page, "late");
  await expect(
    page.getByRole("heading", { name: "Payment under review" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pay \$/ })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Contact the studio", exact: true }).first(),
  ).toHaveAttribute("href", /^tel:/);
});
test("50-minute cadence, required instructor, guardian validation and final-slot conflict", async ({
  page,
}) => {
  await chooseSlots(page);
  await page.getByRole("button", { name: "Review booking" }).click();
  await expect(page.locator("#name")).toBeFocused();
  await page.getByLabel("Full name", { exact: false }).fill("Demo Customer");
  await page
    .getByLabel("Email address", { exact: false })
    .fill("customer@example.com");
  await page
    .getByLabel("Mobile number", { exact: false })
    .fill("+65 8123 4567");
  await page.getByLabel("Participant age group").selectOption("child");
  await page.getByLabel("Football experience").selectOption("new");
  await expect(
    page.getByRole("heading", { name: "Parent / guardian contact" }),
  ).toBeVisible();
  await page.getByLabel("Parent / guardian name").fill("Guardian Person");
  await page.getByLabel("Parent / guardian mobile").fill("+65 9123 4567");
  await page.getByRole("button", { name: "Review booking" }).click();
  await expect(page).toHaveURL(/\/book\/details\/$/);
  await expect(page.getByLabel("Emergency contact relationship")).toBeFocused();
  await page
    .getByLabel("Emergency contact relationship")
    .selectOption("guardian");
  await page.getByRole("button", { name: "Review booking" }).click();
  await page.getByRole("checkbox", { name: /I’ve reviewed/ }).check();
  await page.getByText("Preview controls", { exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Final slot taken before payment" })
    .check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "no longer available",
  );
  await page.getByRole("link", { name: "Review selections" }).click();
  await expect(page.getByRole("button", { name: /10:50–11:30/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /10:40–11:20/ })).toHaveCount(
    0,
  );
});
test("email verification rejects an incorrect code and continues after correction", async ({
  page,
}) => {
  await page.goto("/book/account/");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill("customer@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "incorrect",
  );
  await page.getByLabel("Verification code").fill("360360");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Your session", exact: true }),
  ).toBeVisible();
});
test("enquiry and assistant work without external submission", async ({
  page,
}) => {
  await page.goto("/enquiry/");
  await page.getByLabel("Full name").fill("Demo Customer");
  await page.getByLabel("Email address").fill("demo@example.com");
  await expect(page.getByLabel("Full name")).toHaveValue("Demo Customer");
  await page.getByLabel("Contact number").fill("+65 8123 4567");
  await page.getByLabel("Enquiry type").selectOption("Corporate booking");
  await page
    .getByLabel("Your requirements")
    .fill("A group session for our team.");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(page.getByText("Preview · No enquiry sent.")).toBeVisible();
  await page.getByRole("button", { name: "Open studio assistant" }).click();
  await page
    .getByRole("button", { name: "Sessions & prices", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText("S$88");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open studio assistant" }),
  ).toBeFocused();
});

test("hero entry restores the arena scene and click-to-skip without a logo overlay", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^Book now —/ }).click();
  const transition = page.getByRole("button", {
    name: "Skip arena transition",
  });
  await expect(transition).toBeVisible();
  await expect(transition.locator("[data-scene-part]")).toHaveCount(47);
  await expect(page.locator(".page-loading")).toHaveCount(0);
  await transition.click();
  await expect(page).toHaveURL(/\/book\/account\/$/);
  await expect(transition).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Start your booking" }),
  ).toBeVisible();
});
test("home navigation offer and studio booking buttons display the branded loader", async ({
  page,
}) => {
  for (const [route, selector] of [
    ["/", ".nav-book"],
    ["/", ".offer-home"],
    ["/studio/", ".studio-bottom .button"],
  ]) {
    await page.goto(route);
    await expect(
      page.getByRole("main").getByRole("heading", { level: 1 }),
    ).toHaveCount(1);
    const link = page.locator(selector);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "/book/account/");
    await link.click();
    await expect(page.locator(".page-loading .loading-logo")).toBeVisible();
    await expect(page).toHaveURL(/\/book\/account\/$/);
    await expect(page.locator(".page-loading")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Start your booking" }),
    ).toBeVisible();
  }
});
test("hero completes naturally and reduced motion bypasses both transition surfaces", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^Book now —/ }).click();
  await expect(
    page.getByRole("button", { name: "Skip arena transition" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/book\/account\/$/);
  await expect(
    page.getByRole("button", { name: "Skip arena transition" }),
  ).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("link", { name: /^Book now —/ }).click();
  await expect(page).toHaveURL(/\/book\/account\/$/);
  await expect(page.locator(".pitch-entry, .page-loading")).toHaveCount(0);
});
