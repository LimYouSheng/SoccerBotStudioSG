import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportInventory } from "./check-export.mjs";
import { validateDeployment } from "./deploy-cloudflare.mjs";
const revision = "a".repeat(40);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soccerbot-deploy-"));
  mkdirSync(join(root, "developer-release"));
  const write = (name, value) =>
    writeFileSync(join(root, name), JSON.stringify(value));
  const config = {
    name: "soccerbot-dev",
    account_id: "517f4f85eb8f982b483dbc05b797fd88",
    d1_databases: [{ database_id: "297a991b-70a7-438d-a0e3-39fa3a7f2cee" }],
    main: "./worker/index.js",
    no_bundle: true,
    assets: { directory: "./assets" },
    vars: {
      SOURCE_REVISION: revision,
      CAMPAIGN_END_MS: "0",
      PROVIDER_ACCESS: "disabled",
      LIVE_CUSTOMER_ACCESS: "disabled",
    },
  };
  write("developer-release/wrangler.json", config);
  write("developer-release/wrangler-live.json", {
    ...config,
    vars: {
      ...config.vars,
      PROVIDER_ACCESS: "trusted-reads",
      LIVE_CUSTOMER_ACCESS: "enabled",
      PREMIUM_SERVICE_ID: "3",
    },
  });
  write("developer-release/manifest.json", {
    sourceRevision: revision,
    testedCheckout: revision,
    releaseProfile: "live-email",
    bookingMode: "live",
    basePath: "",
    files: exportInventory(join(root, "developer-release")),
  });
  write("verification-worker.json", { status: "passed" });
  write("verification-browser.json", {
    status: "passed",
    gitHead: revision,
    browserExecuted: true,
    bookingMode: "live",
    releaseProfile: "live-email",
    basePath: "",
  });
  write("developer-release-check.json", {
    status: "passed",
    sourceRevision: revision,
    testedCheckout: revision,
  });
  const change = (name, mutate) => {
    const value = JSON.parse(readFileSync(join(root, name), "utf8"));
    mutate(value);
    write(name, value);
  };
  return { root, change };
}
test("Cloudflare deploy accepts only unchanged artifact bytes with matching main evidence", () => {
  const f = fixture();
  try {
    assert.equal(
      validateDeployment(f.root, revision).vars.LIVE_CUSTOMER_ACCESS,
      "enabled",
    );
    assert.throws(() => validateDeployment(f.root, "b".repeat(40)));
    f.change("developer-release/wrangler-live.json", (config) => {
      config.vars.SOURCE_REVISION = "b".repeat(40);
    });
    assert.throws(() => validateDeployment(f.root, revision), /hashes changed/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("Cloudflare deploy refuses failed or substituted browser and Worker receipts", () => {
  for (const [name, mutate] of [
    [
      "verification-worker.json",
      (value) => {
        value.status = "failed";
      },
    ],
    [
      "verification-browser.json",
      (value) => {
        value.browserExecuted = false;
      },
    ],
    [
      "verification-browser.json",
      (value) => {
        value.gitHead = "b".repeat(40);
      },
    ],
    [
      "verification-browser.json",
      (value) => {
        value.basePath = "/foreign";
      },
    ],
    [
      "developer-release-check.json",
      (value) => {
        value.status = "failed";
      },
    ],
  ]) {
    const f = fixture();
    try {
      f.change(name, mutate);
      assert.throws(() => validateDeployment(f.root, revision));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});
