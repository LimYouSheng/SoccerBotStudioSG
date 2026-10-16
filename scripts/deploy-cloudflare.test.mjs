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
import {
  validateDeployment,
  verifySandboxSettings,
  awaitDeploymentHealth,
} from "./deploy-cloudflare.mjs";
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
    triggers: { crons: ["* * * * *"] },
    vars: {
      ...config.vars,
      PROVIDER_ACCESS: "trusted-reads",
      LIVE_CUSTOMER_ACCESS: "enabled",
      PREMIUM_SERVICE_ID: "3",
      IDENTITY_DELIVERY: "ongoing",
      LIVE_READBACK: "enabled",
      CHECKOUT_PAYMENT_ROUTE: "hitpay",
      HITPAY_CHECKOUT: "enabled",
      HITPAY_RECOVERY: "enabled",
      HITPAY_WEBHOOK: "enabled",
      HITPAY_MERCHANT: "app404",
      HITPAY_BUSINESS_ID: "a2d2119d-79f1-41fa-9d65-6e311d06da35",
      HITPAY_CONTRACT_ACCEPTED: "sandbox-reviewed",
      SIMPLYBOOK_EXTERNAL_PAYMENT: "sandbox-reviewed",
      SIMPLYBOOK_EXTERNAL_PROCESSOR: "manual",
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

test("deployment readiness observes previous revision until the exact new revision is ready", async () => {
  const old = "b".repeat(40),
    seen = [old, old, revision],
    pauses = [];
  const result = await awaitDeploymentHealth({
    revision,
    previousRevision: old,
    read: async () => ({
      revision: seen.shift(),
      liveCustomerAccess: "enabled",
      effectiveProviderAccess: "trusted-reads",
      providerCredentialsPresent: true,
    }),
    pause: async (ms) => pauses.push(ms),
  });
  assert.deepEqual(result.observedRevisions, [old, old, revision]);
  assert.deepEqual(pauses, [2000, 2000]);
});
test("deployment readiness remains bounded and refuses foreign revisions failed reads or missing credentials", async () => {
  const old = "b".repeat(40);
  let reads = 0,
    pauses = 0;
  await assert.rejects(
    awaitDeploymentHealth({
      revision,
      previousRevision: old,
      read: async () => {
        reads++;
        return { revision: old };
      },
      pause: async () => {
        pauses++;
      },
    }),
    /16 observations/,
  );
  assert.equal(reads, 16);
  assert.equal(pauses, 15);
  for (const read of [
    async () => ({ revision: "c".repeat(40) }),
    async () => {
      throw new Error("health failed");
    },
    async () => ({
      revision,
      liveCustomerAccess: "enabled",
      effectiveProviderAccess: "trusted-reads",
      providerCredentialsPresent: false,
    }),
  ]) {
    await assert.rejects(
      awaitDeploymentHealth({
        revision,
        previousRevision: old,
        read,
        pause: async () => assert.fail("failure must not be retried"),
      }),
    );
  }
});

test("deployment checks actual sandbox flags and secret presence without requiring secret values", () => {
  const f = fixture();
  try {
    const config = validateDeployment(f.root, revision);
    const bindings = Object.entries(config.vars).map(([name, text]) => ({
      name,
      text,
      type: "plain_text",
    }));
    for (const name of [
      "HITPAY_SANDBOX_API_KEY",
      "HITPAY_WEBHOOK_SALT",
      "SIMPLYBOOK_DEV_SIGNING_SECRET",
    ])
      bindings.push({ name, type: "secret_text" });
    verifySandboxSettings({ bindings }, config);
    for (const name of [
      "CHECKOUT_PAYMENT_ROUTE",
      "HITPAY_MERCHANT",
      "HITPAY_RECOVERY",
      "HITPAY_WEBHOOK_SALT",
    ]) {
      assert.throws(() =>
        verifySandboxSettings(
          { bindings: bindings.filter((b) => b.name !== name) },
          config,
        ),
      );
    }
    const changed = structuredClone(bindings);
    changed.find((b) => b.name === "HITPAY_CHECKOUT").text = "disabled";
    assert.throws(() => verifySandboxSettings({ bindings: changed }, config));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
