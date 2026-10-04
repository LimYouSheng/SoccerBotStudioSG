import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results/browser-artifacts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/browser.json" }],
    ["./scripts/browser-evidence.mjs"],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    {
      name: "phone-webkit",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
    {
      name: "tablet-webkit",
      use: { ...devices["iPad (gen 7)"], browserName: "webkit" },
    },
  ],
  webServer: {
    command: "node scripts/serve-export.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
