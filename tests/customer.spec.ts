import { sitePath } from "../src/content/site-path";
import { expect, test, type Page } from "@playwright/test";
import { addDays, dateLabel } from "../src/domain/dates";
const DEMO_TODAY = "2026-10-05";
test.beforeEach(async ({ page }) => {
  // Payment deadlines need Date.now() to advance alongside the timers.
  await page.clock.install({ time: new Date("2026-10-05T08:00:00+08:00") });
});
async function openSite(page: Page, route: string) {
  await page.goto(sitePath(route));
  const prompt = page.getByRole("dialog", {
    name: "Get the SoccerBot Player App",
  });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(prompt).toHaveCount(0);
}
async function chooseSlots(page: Page, multiple = false) {
  await openSite(page, "/book/account/");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByRole("link", { name: "See available times" }).click();
  await page
    .getByRole("button", {
      name: dateLabel(addDays(DEMO_TODAY, 1)),
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /09:00–09:40/ }).click();
  if (multiple) {
    await page
      .getByRole("button", {
        name: dateLabel(addDays(DEMO_TODAY, 2)),
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: /09:00–09:40/ }).click();
  }
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
  await page.getByRole("button", { name: "Review booking" }).click();
  await page.getByRole("checkbox", { name: /I’ve reviewed/ }).check();
}
async function payAttempt(page: Page, outcome = "success") {
  await page.getByRole("button", { name: /^Pay \$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Processing payment", exact: true }),
  ).toBeVisible();
  if (outcome !== "success") {
    // Adverse provider states are test fixtures, never controls in the customer UI.
    await page.evaluate((outcome) => {
      const key = "soccerbot-next-demo-v2";
      const stored = JSON.parse(sessionStorage.getItem(key)!);
      stored.attempt.outcome = outcome;
      sessionStorage.setItem(key, JSON.stringify(stored));
    }, outcome);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Processing payment", exact: true }),
    ).toBeVisible();
  }
  await page.clock.runFor(5000);
}
async function payment(page: Page, outcome = "success") {
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payAttempt(page, outcome);
}
test("public routes remove staff access and fit the viewport", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openSite(page, "/");
  await expect(
    page.getByRole("heading", { name: "Your next session starts here." }),
  ).toBeAttached();
  await expect(
    page.getByText(/staff login|staff access|command centre/i),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "The studio", exact: true }).click();
  await expect(page.locator(".page-loading .loading-logo")).toBeVisible();
  await expect(page.locator(".page-loading")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Inside the arena." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.goto(sitePath("/"));
  await page
    .getByRole("link", { name: "Explore the studio", exact: true })
    .click();
  await expect(page.locator(".page-loading .loading-logo")).toBeVisible();
  await expect(page.locator(".page-loading")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Inside the arena." }),
  ).toBeVisible();
  const response = await page.goto(sitePath("/admin/"));
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
  await expect(page.getByText("Studio 1", { exact: true })).toBeVisible();
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
  await payAttempt(page, "pending");
  await expect(
    page.getByRole("heading", { name: "Payment pending", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Payment pending", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check payment status" }).click();
  await expect(
    page.getByRole("heading", { name: "Processing payment", exact: true }),
  ).toBeVisible();
  await page.clock.runFor(5000);
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
    page.getByRole("link", { name: "Contact the studio", exact: true }),
  ).toHaveAttribute("href", /^tel:/);
});
test("50-minute cadence, automatic instructors, contact validation and final-slot conflict", async ({
  page,
}) => {
  await chooseSlots(page);
  await page.getByRole("button", { name: "Review booking" }).click();
  await expect(page.locator("#name")).toBeFocused();
  await expect(page.locator("#details-form input")).toHaveCount(4);
  await expect(page.locator("#details-form select")).toHaveCount(1);
  await expect(page.locator("#details-form textarea")).toHaveCount(0);
  await details(page);
  await page.evaluate(() => {
    const stored = JSON.parse(
      sessionStorage.getItem("soccerbot-next-demo-v2")!,
    );
    const slot = stored.draft.slots[0];
    sessionStorage.setItem(
      "soccerbot-next-demo-inventory",
      JSON.stringify([`Studio 1|${slot.date}|${slot.start}`]),
    );
  });
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "no longer available",
  );
  await page.getByRole("link", { name: "Review selections" }).click();
  await expect(page.getByRole("button", { name: /09:50–10:30/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /09:40–10:20/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Preview controls", { exact: true })).toHaveCount(
    0,
  );
});
test("email verification rejects an incorrect code and continues after correction", async ({
  page,
}) => {
  await openSite(page, "/book/account/");
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
  await openSite(page, "/enquiry/");
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
  await openSite(page, "/");
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
  await openSite(page, "/");
  for (const [route, selector] of [
    ["/", ".nav-book"],
    ["/", ".offer-home"],
    ["/studio/", ".studio-bottom .button"],
  ]) {
    await page.goto(sitePath(route));
    await expect(
      page.getByRole("main").getByRole("heading", { level: 1 }),
    ).toHaveCount(1);
    const link = page.locator(selector);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", sitePath("/book/account/"));
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
  await openSite(page, "/");
  await page.getByRole("link", { name: /^Book now —/ }).click();
  await expect(
    page.getByRole("button", { name: "Skip arena transition" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/book\/account\/$/);
  await expect(
    page.getByRole("button", { name: "Skip arena transition" }),
  ).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(sitePath("/"));
  await page.getByRole("link", { name: /^Book now —/ }).click();
  await expect(page).toHaveURL(/\/book\/account\/$/);
  await expect(page.locator(".pitch-entry, .page-loading")).toHaveCount(0);
});
test("oracle booking sizing and rotation disclaimers persist through checkout", async ({
  page,
}) => {
  async function fullWidth(selector: string, parent: string) {
    await expect(page.locator(selector)).toBeVisible();
    const width = await page
      .locator(selector)
      .evaluate((element) => element.getBoundingClientRect().width);
    const container = await page
      .locator(parent)
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(Math.abs(width - container)).toBeLessThanOrEqual(1);
  }
  await openSite(page, "/book/account/");
  await expect(page.locator(".footer-logo")).toHaveAttribute(
    "src",
    sitePath("/assets/e1fb2d17fd4c.svg"),
  );
  await expect(page.locator(".nav .official-logo")).toHaveAttribute(
    "src",
    sitePath("/assets/c275ccd87afb.svg"),
  );
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(
    page.getByRole("heading", { name: "Your session", exact: true }),
  ).toBeVisible();
  await fullWidth(".actions .button", ".actions");
  await expect(
    page.locator(".session-product .fixed-session-length"),
  ).toContainText("40 minutes");
  const playerWidth = await page
    .locator(".player-selection")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        element.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)
      );
    });
  const counterWidth = await page
    .locator(".counter")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(Math.abs(playerWidth - counterWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Add one player" }).click();
  await expect(page.locator(".counter output")).toHaveText("2 players");
  const productFontSize = await page
    .locator(".session-product h2")
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(productFontSize).toBeCloseTo(20, 5);
  await expect(page.locator(".section-title")).toHaveCSS(
    "font-style",
    "normal",
  );
  await page.getByRole("link", { name: "See available times" }).click();
  await page
    .getByRole("button", {
      name: dateLabel(addDays(DEMO_TODAY, 1)),
      exact: true,
    })
    .click();
  await expect(page.getByRole("button", { name: /09:00–09:40/ })).toContainText(
    "Faisal Shahril",
  );
  await expect(page.getByRole("button", { name: /12:20–13:00/ })).toContainText(
    "Daniel Tan",
  );
  await expect(page.getByRole("button", { name: /15:40–16:20/ })).toContainText(
    "Instructor 3",
  );
  await expect(page.getByRole("button", { name: /18:10–18:50/ })).toContainText(
    "Instructor 4",
  );
  await expect(page.getByRole("button", { name: /20:40–21:20/ })).toHaveCount(
    0,
  );
  const crossing = page.getByRole("button", { name: /11:30–12:10/ });
  await expect(crossing).toContainText("Crosses the 12:00 instructor rotation");
  await crossing.click();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.getByRole("button", { name: /12:20–13:00/ }).click();
  const instructors = page.getByRole("region", { name: "Your instructors" });
  await expect(instructors.getByRole("article")).toHaveCount(2);
  await expect(
    instructors.getByRole("article", { name: "Faisal Shahril", exact: true }),
  ).toBeVisible();
  await expect(
    instructors.getByRole("article", { name: "Daniel Tan", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue", exact: true }),
  ).toBeVisible();
  const positions = await page.locator(".aside-wrap").evaluate((element) => ({
    continueBottom: element
      .querySelector(".basket-continue")!
      .getBoundingClientRect().bottom,
    instructorsTop: element
      .querySelector(".booking-instructors")!
      .getBoundingClientRect().top,
  }));
  expect(positions.instructorsTop).toBeGreaterThanOrEqual(
    positions.continueBottom,
  );
  await expect(page.locator(".summary .rotation-notice")).toContainText(
    "stays for the full session",
  );
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await fullWidth(".actions .button", ".actions");
  await expect(page.locator("#name")).toHaveCSS("min-height", "52px");
  await details(page);
  await fullWidth(".actions .button", ".actions");
  await expect(page.locator(".series-list .rotation-notice")).toContainText(
    "Crosses the 12:00 instructor rotation",
  );
  await payment(page);
  await expect(
    page.getByRole("heading", { name: "Booking confirmed", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".confirmation-card .rotation-notice"),
  ).toContainText("stays for the full session");
  await expect(page.locator("main details")).toHaveCount(0);
  await expect(page.locator(".confirmation-section > h2")).toHaveText([
    "Client Details",
    "Session Details",
    "Location",
    "Amount",
    "Disclaimers",
  ]);
  await expect(
    page
      .locator(".confirmation-card")
      .getByText("Demo Customer", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.locator(".confirmation-card").getByText("Studio 1", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.locator(".confirmation-card .session-instructor"),
  ).toHaveText(["Faisal Shahril", "Daniel Tan"]);
  await expect(page.getByText("Preview controls", { exact: true })).toHaveCount(
    0,
  );
  const columns = await page
    .locator(".confirmation-actions")
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
  expect(columns).toBe(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("leave booking uses equal-width sentence-case actions with home left and stay right", async ({
  page,
}) => {
  await chooseSlots(page);
  await page
    .getByRole("link", { name: "SOCCERBOTSTUDIO Singapore home" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Leave this booking?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".dialog-actions button")).toHaveText([
    "Back to home",
    "Stay",
  ]);
  const actions = await dialog
    .locator(".dialog-actions button")
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        width: button.getBoundingClientRect().width,
        x: button.getBoundingClientRect().x,
        casing: getComputedStyle(button).textTransform,
      })),
    );
  expect(Math.abs(actions[0].width - actions[1].width)).toBeLessThanOrEqual(1);
  expect(actions[0].x).toBeLessThan(actions[1].x);
  expect(actions.map((action) => action.casing)).toEqual(["none", "none"]);
  await dialog.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(page).toHaveURL(/\/book\/details\/$/);
  await page
    .getByRole("link", { name: "SOCCERBOTSTUDIO Singapore home" })
    .click();
  await dialog
    .getByRole("button", { name: "Back to home", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(sitePath("/") + "$"));
});
test("first visit offers the Player App and dismissal persists while the navbar download remains", async ({
  page,
}) => {
  await page.goto(sitePath("/"));
  const prompt = page.getByRole("dialog", {
    name: "Get the SoccerBot Player App",
  });
  await expect(prompt).toBeVisible();
  await expect(
    prompt.getByRole("link", { name: "Download app", exact: true }),
  ).toHaveAttribute("href", "https://soccerbot360.com/en/player-app");
  await prompt.getByRole("button", { name: "Not now", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your next session starts here." }),
  ).toBeVisible();
  await expect(prompt).toHaveCount(0);
  await expect(page.locator(".nav-download")).toBeVisible();
  await expect(page.locator(".nav-download")).toHaveAttribute(
    "href",
    "https://soccerbot360.com/en/player-app",
  );
  await page.getByRole("link", { name: "The studio", exact: true }).click();
  await expect(page.locator(".page-loading .loading-logo")).toBeVisible();
  await expect(page.locator(".page-loading")).toHaveCount(0);
  await expect(prompt).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("header blue and the typography hierarchy stay consistent across every booking step", async ({
  page,
}) => {
  const brand = "rgb(5, 10, 47)";
  const pageSize = page.viewportSize()!.width <= 700 ? 32 : 40;
  async function pageHeading(name: string) {
    const heading = page
      .getByRole("main")
      .getByRole("heading", { level: 1, name, exact: true });
    await expect(heading).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("heading", { level: 1 }),
    ).toHaveCount(1);
    expect(
      await heading.evaluate((node) =>
        parseFloat(getComputedStyle(node).fontSize),
      ),
    ).toBeCloseTo(pageSize, 5);
    await expect(heading).toHaveCSS("color", brand);
    await expect(heading).toHaveCSS("font-weight", "900");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  async function sectionType(selector: string) {
    const headings = page.locator(selector);
    expect(await headings.count()).toBeGreaterThan(0);
    const styles = await headings.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          size: parseFloat(style.fontSize),
          weight: style.fontWeight,
          style: style.fontStyle,
          color: style.color,
        };
      }),
    );
    for (const style of styles) {
      expect(style.size).toBeCloseTo(20, 5);
      expect(style.weight).toBe("700");
      expect(style.style).toBe("normal");
      expect(style.color).toBe(brand);
    }
  }
  await openSite(page, "/book/account/");
  await pageHeading("Start your booking");
  await expect(page.locator(".site-header")).toHaveCSS(
    "background-color",
    brand,
  );
  await expect(page.locator("body")).toHaveCSS("font-family", /Roboto/);
  await expect(page.locator("body")).toHaveCSS("font-size", "16px");
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () =>
        document.fonts.check("700 16px Roboto") &&
        document.fonts.check("italic 900 32px Roboto"),
    ),
  ).toBe(true);
  await sectionType(".access-option h2");
  const guest = page.getByRole("button", { name: "Continue as guest" });
  // Inspect the resting action, with the pointer away from the button.
  await page.mouse.move(0, 0);
  await expect(guest).toHaveCSS("background-color", brand);
  await expect(guest).toHaveCSS("text-transform", "none");
  await expect(guest).toHaveCSS("font-size", "16px");
  await guest.click();
  await pageHeading("Your session");
  await sectionType(".session-product h2, .session-inclusions h2");
  await expect(page.locator(".session-product p")).toHaveCSS(
    "font-size",
    "16px",
  );
  await page.getByRole("link", { name: "See available times" }).click();
  await pageHeading("Select dates and times");
  await page
    .getByRole("button", {
      name: dateLabel(addDays(DEMO_TODAY, 1)),
      exact: true,
    })
    .click();
  const crossing = page.getByRole("button", { name: /11:30–12:10/ });
  await crossing.click();
  await expect(crossing).toHaveCSS("background-color", brand);
  await expect(crossing.locator(".time-instructor")).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(crossing.locator(".rotation-notice")).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(page.locator(".trainer-heading")).toHaveCSS(
    "background-color",
    brand,
  );
  await expect(page.locator(".trainer-bio")).toHaveCSS("font-size", "14px");
  await expect(page.locator(".trainer-identity h3")).toHaveCSS(
    "font-size",
    "18px",
  );
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await pageHeading("Your details");
  await sectionType("#details-form h2");
  await expect(page.locator("label[for='name']")).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(page.locator("#name")).toHaveCSS("font-size", "16px");
  await expect(page.locator("#name")).toHaveCSS("min-height", "52px");
  await details(page);
  await pageHeading("Review booking");
  await sectionType(".review-head h2, .review-block > h2");
  await expect(page.locator(".booking-facts")).toHaveCSS("font-size", "16px");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await pageHeading("Payment");
  await sectionType(".payment-layout .section-title");
  await expect(page.locator(".method.selected")).toHaveCSS(
    "border-top-color",
    brand,
  );
  await payAttempt(page);
  await pageHeading("Booking confirmed");
  await sectionType(".confirmation-section > h2");
  await expect(page.locator(".confirmation-card .paid strong")).toHaveCSS(
    "font-size",
    "24px",
  );
  await expect(page.locator(".confirmation-card .paid strong")).toHaveCSS(
    "color",
    brand,
  );
  await expect(page.locator("main details")).toHaveCount(0);
});

test("elapsed selections block checkout on an open page and remain removable before a future multi-session payment", async ({
  page,
}) => {
  await chooseSlots(page);
  await details(page);
  await page.clock.pauseAt(new Date("2026-10-06T08:59:59.999+08:00"));
  await expect(
    page.getByRole("button", { name: "Continue to payment" }),
  ).toBeEnabled();
  await page.clock.runFor(1);
  await expect(
    page.getByRole("heading", { name: "Select dates and times" }),
  ).toBeVisible();
  const basket = page.getByRole("complementary", {
    name: "Your booking summary",
  });
  await expect(
    basket.getByText("Session has started — remove to continue."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /09:00–09:40/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("soccerbot-next-demo-v2")!).draft
          .slots.length,
    ),
  ).toBe(1);
  await page
    .getByRole("button", { name: "Remove 2026-10-06 at 09:00" })
    .click();
  await expect(
    page.getByRole("button", { name: /09:00–09:40/ }),
  ).toBeDisabled();
  await page.clock.runFor(1);
  await expect(
    page.getByRole("button", { name: /09:00–09:40/ }),
  ).toBeDisabled();
  await page.clock.resume();
  await page.getByRole("button", { name: /09:50–10:30/ }).click();
  await page
    .getByRole("button", { name: dateLabel("2026-10-07"), exact: true })
    .click();
  await page.getByRole("button", { name: /09:00–09:40/ }).click();
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await details(page);
  await payment(page);
  await expect(
    page.getByRole("heading", { name: "Booking confirmed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Selected sessions" }).getByRole("listitem"),
  ).toHaveCount(2);
  const paid = await page.evaluate(() => {
    const { draft, attempt } = JSON.parse(
      sessionStorage.getItem("soccerbot-next-demo-v2")!,
    );
    return { draft, attempt };
  });
  await page.clock.setSystemTime(new Date("2027-01-01T00:00:00+08:00"));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Booking confirmed", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const { draft, attempt } = JSON.parse(
        sessionStorage.getItem("soccerbot-next-demo-v2")!,
      );
      return { draft, attempt };
    }),
  ).toEqual(paid);
  await expect(page.getByText(/Session has started/)).toHaveCount(0);
});
