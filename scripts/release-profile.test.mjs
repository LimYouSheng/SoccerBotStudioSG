import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseProfile, emailSitekey } from "./release-profile.mjs";
import { validateResults } from "./verify-test-results.mjs";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { checkPagesPolicy } from "./check-pages-policy.mjs";

test("release profiles refuse implicit live composition and mismatched public bindings", () => {
  const live = {
    RELEASE_PROFILE: "live-email",
    NEXT_PUBLIC_BOOKING_MODE: "live",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: emailSitekey,
    NEXT_PUBLIC_BASE_PATH: "",
  };
  assert.equal(releaseProfile(live).browserSuite, "live-email");
  assert.equal(releaseProfile({}).bookingMode, "demo");
  for (const change of [
    { RELEASE_PROFILE: "other" },
    { RELEASE_PROFILE: "closed-demo" },
    { NEXT_PUBLIC_BOOKING_MODE: "demo" },
    { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" },
    { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "foreign" },
    { NEXT_PUBLIC_BASE_PATH: "/SoccerBotStudioSG" },
  ])
    assert.throws(() => releaseProfile({ ...live, ...change }));
});

test("live browser evidence cannot substitute demo cases or omit an engine", () => {
  const inventory = [
    { file: "tests/live-email.spec.ts", title: "live case" },
    { file: "tests/customer.spec.ts", title: "demo case" },
  ];
  const projects = ["desktop-chromium", "phone-webkit", "tablet-webkit"];
  const report = {
    config: { projects: projects.map((name) => ({ name })) },
    errors: [],
    stats: { expected: 3, unexpected: 0, flaky: 0, skipped: 0 },
    suites: [
      {
        specs: [
          {
            file: "live-email.spec.ts",
            title: "live case",
            ok: true,
            tests: projects.map((projectName) => ({
              projectName,
              expectedStatus: "passed",
              status: "expected",
              annotations: [],
              results: [{ status: "passed", retry: 0, errors: [] }],
            })),
          },
        ],
      },
    ],
  };
  assert.deepEqual(
    validateResults("browser", report, inventory, process.cwd(), "live-email"),
    [],
  );
  assert.ok(validateResults("browser", report, inventory).length);
  const demo = structuredClone(report);
  demo.suites[0].specs[0].file = "customer.spec.ts";
  demo.suites[0].specs[0].title = "demo case";
  assert.deepEqual(validateResults("browser", demo, inventory), []);
  assert.ok(
    validateResults("browser", demo, inventory, process.cwd(), "live-email")
      .length,
  );
  report.suites[0].specs[0].tests.pop();
  assert.ok(
    validateResults("browser", report, inventory, process.cwd(), "live-email")
      .length,
  );
});

test("live CI cannot omit gates change the sitekey or gain deployment permissions", () => {
  const original = YAML.parse(
    readFileSync(".github/workflows/verify.yml", "utf8"),
  );
  assert.deepEqual(checkPagesPolicy(original), []);
  for (const change of [
    (d) => delete d.jobs["live-email"],
    (d) => d.jobs["live-email"].steps.splice(3, 1),
    (d) =>
      (d.jobs["live-email"].env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "foreign"),
    (d) => (d.jobs["live-email"].permissions = { contents: "write" }),
    (d) => (d.jobs["live-email"].if = "false"),
    (d) => (d.jobs["live-email"]["continue-on-error"] = true),
  ]) {
    const changed = structuredClone(original);
    change(changed);
    assert.ok(checkPagesPolicy(changed).length);
  }
});
