// GitHub main deployment consumes the verified artifact; it never builds it.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportInventory } from "./check-export.mjs";
export function validateDeployment(directory, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  const read = (file) =>
    JSON.parse(readFileSync(`${directory}/${file}`, "utf8"));
  const manifest = read("developer-release/manifest.json");
  const inventory = exportInventory(`${directory}/developer-release`);
  delete inventory["manifest.json"];
  assert.deepEqual(inventory, manifest.files, "Artifact file hashes changed");
  assert.equal(manifest.sourceRevision, revision);
  assert.equal(manifest.testedCheckout, revision);
  assert.equal(manifest.releaseProfile, "live-email");
  assert.equal(manifest.bookingMode, "live");
  assert.equal(manifest.basePath, "");
  const worker = read("verification-worker.json");
  const browser = read("verification-browser.json");
  const artifact = read("developer-release-check.json");
  for (const receipt of [worker, browser, artifact])
    assert.equal(receipt.status, "passed");
  assert.equal(browser.gitHead, revision);
  assert.equal(browser.browserExecuted, true);
  assert.equal(browser.bookingMode, "live");
  assert.equal(browser.releaseProfile, "live-email");
  assert.equal(browser.basePath, "");
  assert.equal(artifact.sourceRevision, revision);
  assert.equal(artifact.testedCheckout, revision);
  const closed = read("developer-release/wrangler.json");
  const config = read("developer-release/wrangler-live.json");
  assert.deepEqual(config, {
    ...closed,
    vars: {
      ...closed.vars,
      PROVIDER_ACCESS: "trusted-reads",
      LIVE_CUSTOMER_ACCESS: "enabled",
      PREMIUM_SERVICE_ID: "3",
    },
  });
  assert.equal(config.name, "soccerbot-dev");
  assert.equal(config.account_id, "517f4f85eb8f982b483dbc05b797fd88");
  assert.equal(
    config.d1_databases[0].database_id,
    "297a991b-70a7-438d-a0e3-39fa3a7f2cee",
  );
  assert.equal(config.vars.SOURCE_REVISION, revision);
  assert.equal(config.no_bundle, true);
  assert.equal(config.main, "./worker/index.js");
  assert.equal(config.assets.directory, "./assets");
  assert.equal(config.vars.CAMPAIGN_END_MS, "0");
  return config;
}
// Cloudflare can acknowledge activation before every edge reports the new
// revision. Observe only the known previous revision while propagation settles;
// never redeploy, accept a third revision, or retry failed/malformed health reads.
export async function awaitDeploymentHealth({
  revision,
  previousRevision,
  read,
  pause,
}) {
  const observedRevisions = [];
  for (let observation = 0; observation < 16; observation++) {
    const health = await read();
    assert.match(health.revision, /^[a-f0-9]{40}$/);
    observedRevisions.push(health.revision);
    if (health.revision === revision) {
      assert.equal(health.liveCustomerAccess, "enabled");
      assert.equal(health.effectiveProviderAccess, "trusted-reads");
      assert.equal(health.providerCredentialsPresent, true);
      return { health, observedRevisions };
    }
    assert.equal(
      health.revision,
      previousRevision,
      "Unexpected deployment revision",
    );
    console.log(
      `Waiting for deployed revision (${observation + 1}/16): ${health.revision}`,
    );
    if (observation < 15) await pause(2000);
  }
  throw new Error("Deployed revision did not propagate within 16 observations");
}
async function readHealth(origin) {
  const response = await fetch(`${origin}/api/health`, {
    headers: {
      accept: "application/json",
      "User-Agent": "SoccerBot-deployment-verification",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function deploy() {
  assert.equal(process.env.GITHUB_REF, "refs/heads/main");
  assert.ok(
    ["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME),
  );
  assert.ok(
    process.env.CLOUDFLARE_API_TOKEN,
    "Configure the repository CLOUDFLARE_API_TOKEN secret",
  );
  const directory = "work/deploy-evidence";
  const revision = process.env.GITHUB_SHA;
  const config = validateDeployment(directory, revision);
  const configPath = resolve(directory, "developer-release/wrangler-live.json");
  const wrangler = (args) =>
    execFileSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        ...args,
        "--config",
        configPath,
      ],
      {
        stdio: "inherit",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
  const previous = await readHealth(config.vars.APP_ORIGIN);
  assert.match(previous.revision, /^[a-f0-9]{40}$/);
  // Applied migrations are skipped by D1; only reviewed artifact SQL is supplied.
  wrangler(["d1", "migrations", "apply", "STATE", "--remote"]);
  wrangler(["deploy", "--no-bundle"]);
  const { health, observedRevisions } = await awaitDeploymentHealth({
    revision,
    previousRevision: previous.revision,
    read: () => readHealth(config.vars.APP_ORIGIN),
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  writeFileSync(
    `${directory}/deployment.json`,
    JSON.stringify(
      {
        sourceRevision: revision,
        status: "deployed",
        observedRevisions,
        versionId: health.versionId,
        origin: config.vars.APP_ORIGIN,
        liveCustomerAccess: "enabled",
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Deployed verified source ${revision} to ${config.vars.APP_ORIGIN}`,
  );
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await deploy();
