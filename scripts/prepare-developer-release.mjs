// Offline packaging only. Never deploys, queries an account or applies remote SQL.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import ts from "typescript";
import { checkExport, exportInventory } from "./check-export.mjs";
import { releaseProfile } from "./release-profile.mjs";
const profile = releaseProfile();

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const checkout = git("rev-parse", "HEAD");
const source = process.env.RELEASE_SOURCE_REVISION || checkout;
assert.match(source, /^[a-f0-9]{40}$/);
// A PR's CI checkout may be GitHub's tested merge commit. Bind both identities;
// no claim that the PR SHA itself is that generated commit.
assert.equal(
  git("rev-parse", `${source}^{tree}`),
  git("rev-parse", "HEAD^{tree}"),
);
assert.equal(git("status", "--porcelain", "--untracked-files=no"), "");
const browser = read("test-results/verification-browser.json");
const backend = read("test-results/verification-worker.json");
assert.equal(browser.status, "passed");
assert.equal(browser.gitHead, checkout);
assert.equal(browser.basePath, "");
assert.equal(
  browser.bookingMode,
  profile.bookingMode,
  "Browser evidence must cover the exact release composition",
);
assert.equal(browser.releaseProfile, profile.name);
assert.equal(browser.turnstileSitekey, profile.sitekey);
assert.equal(browser.browserSuite, profile.browserSuite);
assert.equal(browser.browserExecuted, true);
assert.equal(backend.status, "passed");
assert.deepEqual(exportInventory("out"), browser.export.files);
checkExport("out", "");
const config = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync("wrangler.jsonc", "utf8"),
).config;
assert.equal(config.name, "soccerbot-dev");
assert.equal(config.account_id, "517f4f85eb8f982b483dbc05b797fd88");
assert.equal(config.vars.PROVIDER_ACCESS, "disabled");
assert.equal(config.vars.CAMPAIGN_END_MS, "0");
assert.equal(config.vars.IDENTITY_DELIVERY, "disabled");
const directory = "test-results/developer-release";
assert.equal(
  existsSync(directory),
  false,
  "Preserve prior release; use a fresh evidence directory",
);
mkdirSync(directory);
execFileSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "deploy",
    "--dry-run",
    "--outdir",
    `${directory}/worker`,
    "--var",
    `SOURCE_REVISION:${source}`,
  ],
  {
    stdio: "inherit",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
cpSync("out", `${directory}/assets`, { recursive: true });
cpSync("migrations", `${directory}/migrations`, { recursive: true });
delete config.$schema;
config.main = "./worker/index.js";
config.no_bundle = true;
config.assets.directory = "./assets";
config.d1_databases[0].migrations_dir = "./migrations";
config.vars.SOURCE_REVISION = source;
writeFileSync(
  `${directory}/wrangler.json`,
  JSON.stringify(config, null, 2) + "\n",
);
const manifest = {
  format: 1,
  sourceRevision: source,
  testedCheckout: checkout,
  testedTree: git("rev-parse", "HEAD^{tree}"),
  basePath: "",
  bookingMode: browser.bookingMode,
  releaseProfile: profile.name,
  turnstileSitekey: profile.sitekey,
  identityDelivery: "disabled",
  providerAccess: "disabled",
  campaignEndMs: 0,
  pendingRemoteMigrations: [
    "0009_identity_challenges.sql",
    "0010_customer_read_scopes.sql",
    "0011_identity_delivery.sql",
  ],
  priorWorkerVersion: "a0b4befb-079b-4836-9967-b1f5fe101bd7",
  acceptance:
    profile.name === "live-email"
      ? "synthetic live-email frontend; delivery closed; no provider or mailbox acceptance"
      : "closed foundation only; native integration remains unavailable",
  files: exportInventory(directory),
};
writeFileSync(
  `${directory}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Prepared ${directory}; zero remote operations.`);
