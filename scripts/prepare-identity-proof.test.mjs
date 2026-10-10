import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareIdentityProof } from "./prepare-identity-proof.mjs";
import { exportInventory } from "./check-export.mjs";
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "soccerbot-proof-packet-"));
  const release = path.join(root, "developer-release");
  mkdirSync(path.join(release, "migrations"), { recursive: true });
  const source = "a".repeat(40),
    checkout = "b".repeat(40);
  const write = (file, value) =>
    writeFileSync(path.join(root, file), JSON.stringify(value));
  const config = {
    name: "soccerbot-dev",
    account_id: "517f4f85eb8f982b483dbc05b797fd88",
    vars: {
      APP_ORIGIN: "https://soccerbot-dev.limyousheng-94.workers.dev",
      SOURCE_REVISION: source,
      PROVIDER_ACCESS: "disabled",
      IDENTITY_DELIVERY: "disabled",
      CAMPAIGN_END_MS: "0",
    },
    d1_databases: [{ database_id: "297a991b-70a7-438d-a0e3-39fa3a7f2cee" }],
  };
  write("developer-release/wrangler.json", config);
  const migrations = [
    "0013_remembered_identity.sql",
    "0014_identity_proof_window.sql",
  ];
  for (const name of migrations)
    writeFileSync(
      path.join(release, "migrations", name),
      readFileSync(`migrations/${name}`),
    );
  const manifest = {
    sourceRevision: source,
    testedCheckout: checkout,
    releaseProfile: "live-email",
    bookingMode: "live",
    basePath: "",
    identityDelivery: "disabled",
    providerAccess: "disabled",
    campaignEndMs: 0,
    pendingRemoteMigrations: migrations,
    turnstileSitekey: "synthetic-key",
    files: exportInventory(release),
  };
  write("developer-release/manifest.json", manifest);
  write("developer-release-check.json", {
    status: "passed",
    sourceRevision: source,
  });
  write("verification-worker.json", { status: "passed" });
  write("verification-browser.json", {
    status: "passed",
    gitHead: checkout,
    browserExecuted: true,
    releaseProfile: "live-email",
    bookingMode: "live",
    basePath: "",
    turnstileSitekey: "synthetic-key",
  });
  return {
    root,
    release,
    write,
    manifest,
    config,
    output: path.join(root, "packet"),
  };
}
test("identity proof packet binds sealed source and preserves finite closure reserves without activation", () => {
  const f = fixture();
  try {
    const p = prepareIdentityProof(f.release, f.output);
    assert.equal(p.status, "prepared-not-authorized");
    assert.equal(p.sourceRevision, f.manifest.sourceRevision);
    assert.equal(p.limits.management, 37);
    assert.equal(p.protectedReserve.management, 10);
    assert.equal(p.limits.email, 6);
    assert.equal(p.limits.siteverify, 8);
    assert.equal(p.limits.provider, 0);
    assert.equal(p.activationParameters[4], "OWNER_READY_UTC_MS");
    assert.equal(p.migrations.length, 2);
    assert.throws(
      () => prepareIdentityProof(f.release, f.output),
      /Preserve prior packet/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("identity proof packet refuses changed sealed bytes unverified receipts and wrong release composition", () => {
  const changes = [
    (f) =>
      writeFileSync(
        path.join(f.release, "migrations/0014_identity_proof_window.sql"),
        "changed",
      ),
    (f) =>
      f.write("developer-release-check.json", {
        status: "failed",
        sourceRevision: f.manifest.sourceRevision,
      }),
    (f) =>
      f.write("developer-release-check.json", {
        status: "passed",
        sourceRevision: "c".repeat(40),
      }),
    (f) => f.write("verification-worker.json", { status: "failed" }),
    (f) =>
      f.write("verification-browser.json", {
        status: "passed",
        browserExecuted: false,
      }),
    (f) =>
      f.write("developer-release/manifest.json", {
        ...f.manifest,
        releaseProfile: "closed-demo",
      }),
    (f) =>
      f.write("developer-release/manifest.json", {
        ...f.manifest,
        pendingRemoteMigrations: [],
      }),
    (f) => {
      f.config.vars.IDENTITY_DELIVERY = "finite-test";
      f.write("developer-release/wrangler.json", f.config);
      f.manifest.files = exportInventory(f.release);
      delete f.manifest.files["manifest.json"];
      f.write("developer-release/manifest.json", f.manifest);
    },
  ];
  for (const change of changes) {
    const f = fixture();
    try {
      change(f);
      assert.throws(() => prepareIdentityProof(f.release, f.output));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});
