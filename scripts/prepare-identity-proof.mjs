// Offline packet preparation only. Never dispatches HTTP or applies SQL.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { exportInventory } from "./check-export.mjs";
export function prepareIdentityProof(release, output) {
  const read = (name) =>
    JSON.parse(readFileSync(path.join(release, name), "utf8"));
  const manifest = read("manifest.json");
  const config = read("wrangler.json");
  assert.match(manifest.sourceRevision, /^[a-f0-9]{40}$/);
  assert.equal(manifest.releaseProfile, "live-email");
  assert.equal(manifest.bookingMode, "live");
  assert.equal(manifest.basePath, "");
  assert.equal(manifest.identityDelivery, "disabled");
  assert.equal(manifest.providerAccess, "disabled");
  assert.equal(manifest.campaignEndMs, 0);
  const actual = exportInventory(release);
  delete actual["manifest.json"];
  assert.deepEqual(actual, manifest.files, "Exact sealed bytes are required");
  const migrations = [
    "0013_remembered_identity.sql",
    "0014_identity_proof_window.sql",
  ];
  assert.deepEqual(manifest.pendingRemoteMigrations, migrations);
  assert.equal(config.name, "soccerbot-dev");
  assert.equal(config.account_id, "517f4f85eb8f982b483dbc05b797fd88");
  assert.equal(
    config.vars.APP_ORIGIN,
    "https://soccerbot-dev.limyousheng-94.workers.dev",
  );
  assert.equal(config.vars.SOURCE_REVISION, manifest.sourceRevision);
  assert.equal(config.vars.PROVIDER_ACCESS, "disabled");
  assert.equal(config.vars.IDENTITY_DELIVERY, "disabled");
  assert.equal(config.vars.CAMPAIGN_END_MS, "0");
  assert.equal(
    config.d1_databases[0].database_id,
    "297a991b-70a7-438d-a0e3-39fa3a7f2cee",
  );
  const evidence = path.dirname(release);
  const receipt = (name) =>
    JSON.parse(readFileSync(path.join(evidence, name), "utf8"));
  const checked = receipt("developer-release-check.json");
  assert.equal(checked.status, "passed");
  assert.equal(checked.sourceRevision, manifest.sourceRevision);
  assert.equal(receipt("verification-worker.json").status, "passed");
  const browser = receipt("verification-browser.json");
  assert.equal(browser.status, "passed");
  assert.equal(browser.gitHead, manifest.testedCheckout);
  assert.equal(browser.browserExecuted, true);
  assert.equal(browser.releaseProfile, "live-email");
  assert.equal(browser.bookingMode, "live");
  assert.equal(browser.basePath, "");
  assert.equal(browser.turnstileSitekey, manifest.turnstileSitekey);
  const packet = {
    format: 1,
    status: "prepared-not-authorized",
    sourceRevision: manifest.sourceRevision,
    testedCheckout: manifest.testedCheckout,
    manifestSha256: createHash("sha256")
      .update(readFileSync(path.join(release, "manifest.json")))
      .digest("hex"),
    target: {
      account: config.account_id,
      worker: config.name,
      database: config.d1_databases[0].database_id,
      origin: config.vars.APP_ORIGIN,
    },
    campaignDeadline: "2026-10-12T08:18:56Z",
    window: {
      singleton: 3,
      maximumMs: 3600000,
      sender: "SoccerBotStudioSG Dev <noreply@auth.app404.ai>",
      recipient: "sheng@app404.ai",
      ownerReadyRequired: true,
    },
    limits: {
      management: 37,
      deployments: 4,
      directWorkerHttp: 24,
      ownerApplicationApi: 120,
      email: 6,
      siteverify: 8,
      provider: 0,
      payment: 0,
      automaticRetries: 0,
    },
    protectedReserve: {
      management: 10,
      deployments: 2,
      purpose: "closure and rollback only",
    },
    phases: [
      {
        name: "preflight",
        management: 7,
        operations: [
          "GET Worker settings",
          "GET deployments",
          "GET current version",
          "GET script-settings",
          "GET schedules",
          "POST D1 schema/history read",
          "POST D1 baseline fingerprint read",
        ],
      },
      {
        name: "migrations",
        management: 3,
        operations: [
          "POST D1 sealed 0013 plus history insert",
          "POST D1 sealed 0014 plus history insert",
          "POST D1 schema/history/preservation read",
        ],
      },
      {
        name: "closed-install",
        management: 12,
        deployments: 1,
        operations: [
          "POST assets-upload-session",
          "at most 8 returned-bucket uploads; stop if more required",
          "PUT exact sealed Worker with disabled modes",
          "GET settings",
          "GET deployments",
        ],
      },
      {
        name: "enable",
        management: 3,
        deployments: 1,
        operations: [
          "PUT same sealed Worker, finite-test only, keep assets/bindings",
          "GET settings",
          "GET deployments",
        ],
      },
      {
        name: "open",
        management: 2,
        operations: [
          "POST parameterized proof INSERT RETURNING after owner readiness",
          "POST separate scope/counter readback",
        ],
      },
      {
        name: "close",
        management: 6,
        deployments: 1,
        operations: [
          "POST parameterized close UPDATE RETURNING",
          "POST proof/dispatch/revocation readback",
          "PUT same sealed Worker, delivery disabled",
          "GET settings",
          "GET deployments",
          "POST final preservation/counters read",
        ],
      },
      {
        name: "rollback-reserve",
        management: 4,
        deployments: 1,
        operations: [
          "GET reviewed closed version",
          "POST deployments selecting closed version at 100%",
          "GET settings",
          "GET deployments",
        ],
      },
    ],
    migrations: migrations.map((name) => ({
      name,
      sha256: manifest.files[`migrations/${name}`],
    })),
    activationSql:
      "INSERT INTO identity_delivery_window(singleton,source_revision,origin,sender,recipient,opened_ms,expires_ms,state) VALUES(3,?,?,?,?,?,?,'open') RETURNING singleton,source_revision,origin,opened_ms,expires_ms,state",
    activationParameters: [
      manifest.sourceRevision,
      config.vars.APP_ORIGIN,
      "SoccerBotStudioSG Dev <noreply@auth.app404.ai>",
      "sheng@app404.ai",
      "OWNER_READY_UTC_MS",
      "OPENED_MS_PLUS_3600000_NOT_AFTER_CAMPAIGN_DEADLINE",
    ],
    closureSql:
      "UPDATE identity_delivery_window SET state='closed' WHERE singleton=3 AND source_revision=? AND state='open' RETURNING singleton,source_revision,state,opened_ms,expires_ms",
    closureParameters: [manifest.sourceRevision],
    protocol: [
      "t+0: profile A fresh verification without Remember me; verify no remembered cookie. Sign out.",
      "t+2: profile A request code B; do not redeem.",
      "t+4: same guest request code C; reject original B challenge/code; redeem C with consent; replay C once and require rejection. Test restart and two tabs.",
      "t+17 or later: profile B/device B independently verifies with consent (D). Verify profile A remains independently usable.",
      "t+19 or later: profile A signs out, gets a fresh guest and verifies again (E). Within five minutes invoke all-device sign-out; profile B must lose identity.",
      "t+21 or later: profile A new guest verifies with consent (F). Leave idle for more than 30 minutes, close/reopen and restore. Confirm identity, changed guest ownership and no prior booking capability. Sign out; new profile remains unverified.",
      "Stop forward testing by t+55; explicitly close, disable, verify counts/revocations and preservation. No seventh email or replacement window.",
    ],
    stopRules: [
      "No remote execution without approval of this exact scope and current campaign bounds",
      "Require both old windows closed and no third row; source, schema or binding drift stops",
      "Require full 60-minute owner session plus 15-minute closure reserve before campaign deadline",
      "Unknown dispatch/migration/deploy outcome stops forward work; no slot replay",
      "Three emails per rolling 15 minutes and one per minute remain enforced; do not spend a bot call while rate-limited",
      "No callbacks, provider profile lookup, booking, scheduler, secrets, DNS or production changes",
      "Natural expiry blocks identity use but is not evidence of explicit closure",
      "Keep additive schema; never restore data backwards or erase reservations",
    ],
  };
  assert.equal(
    packet.phases.reduce((n, phase) => n + phase.management, 0),
    packet.limits.management,
  );
  assert.equal(
    packet.phases.reduce((n, phase) => n + (phase.deployments || 0), 0),
    packet.limits.deployments,
  );
  assert.equal(existsSync(output), false, "Preserve prior packet output");
  mkdirSync(output, { recursive: true });
  writeFileSync(
    path.join(output, "packet.json"),
    JSON.stringify(packet, null, 2) + "\n",
  );
  return packet;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [release, output] = process.argv.slice(2);
  assert.ok(
    release && output,
    "Usage: node scripts/prepare-identity-proof.mjs <verified-release> <new-output-directory>",
  );
  const packet = prepareIdentityProof(release, output);
  console.log(
    `Prepared ${packet.sourceRevision}; zero remote operations; approval required.`,
  );
}
