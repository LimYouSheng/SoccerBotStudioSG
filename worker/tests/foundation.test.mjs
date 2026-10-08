import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import ts from "typescript";
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from "miniflare";
import { seedFoundation } from "./foundation-fixture.mjs";
const config = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync("wrangler.jsonc", "utf8"),
).config;
let mf,
  db,
  outbound = 0;
const logs = [];
const root = mkdtempSync(path.join(tmpdir(), "soccerbot-foundation-"));
class Capture extends Log {
  log(message) {
    logs.push(message);
  }
}
before(async () => {
  const { outputFiles } = await build({
    entryPoints: ["worker/tests/foundation-harness.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:workers", "node:async_hooks"],
  });
  mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "foundation-test",
      modules: true,
      script: outputFiles[0].text,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      cf: false,
      bindings: {
        ...config.vars,
        APP_ORIGIN: "https://soccerbot.test",
        SIMPLYBOOK_DEV_API_KEY: "SYNTHETIC_PRIVATE_PUBLIC_KEY",
        SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "SYNTHETIC_PRIVATE_ADMIN_KEY",
        SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-developer",
        SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-operator",
      },
      d1Databases: { STATE: "synthetic-state", FOREIGN: "foreign-state" },
      durableObjects: {
        COORDINATOR: {
          className: "SoccerBotAccountCoordinator",
          useSQLite: true,
        },
      },
      serviceBindings: { ASSETS: () => new Response("synthetic-asset") },
      outboundService: () => {
        outbound++;
        throw new Error("SYNTHETIC_PRIVATE_NETWORK_ERROR");
      },
      log: new Capture(LogLevel.DEBUG),
      handleStructuredLogs: (entry) => logs.push(entry.message),
    }),
    resourcePersistencePath: root,
    isolatedResourcePersistencePath: root,
  });
  await mf.ready;
  db = await mf.getD1Database("STATE");
  for (const name of [
    "0001_developer_journal.sql",
    "0002_developer_operations.sql",
    "0003_session_effects.sql",
    "0004_operator_read_scopes.sql",
  ])
    await db.exec(
      readFileSync("migrations/" + name, "utf8")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  // Populated pre-upgrade operation data must survive the additive identity table.
  await db.exec(
    "INSERT INTO developer_operations VALUES('synthetic-old','provider_identity',1,'running',NULL)",
  );
  await seedFoundation(mf, db);
  const foreign = await mf.getD1Database("FOREIGN");
  await seedFoundation(mf, foreign);
  // Separate database with a different account manifest, not a missing-table error.
  await foreign.exec(
    "DROP TRIGGER immutable_foundation_identity_update; UPDATE foundation_identity SET account_id='other-account'",
  );
});
after(async () => {
  await mf.dispose();
  rmSync(root, { recursive: true, force: true });
  assert.equal(outbound, 0);
});
async function call(input = {}) {
  const r = await mf.dispatchFetch("https://test-driver.test/", {
    method: "POST",
    body: JSON.stringify(input),
  });
  assert.equal(r.status, 200);
  return r.json();
}
function deniedBeforeProtected(r) {
  assert.equal(r.status, 503);
  assert.ok(
    !r.queries.some((q) =>
      /guest_access|attempts|developer_operations/.test(q),
    ),
  );
}
test("foundation valid bindings emit correlated storage evidence without secret markers", async () => {
  const r = await call();
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).providerAccess, "disabled");
  assert.match(r.headers["x-request-id"], /^[a-f0-9-]{36}$/);
  assert.ok(
    logs.some(
      (l) =>
        l.includes(r.headers["x-request-id"]) &&
        l.includes("foundation_trace") &&
        l.includes('"storage"'),
    ),
  );
  assert.ok(!JSON.stringify({ r, logs }).includes("SYNTHETIC_PRIVATE"));
});
test("foundation missing and malformed configuration denies before protected reads", async () => {
  for (const vars of [
    { ENVIRONMENT: "production" },
    { DEPLOYMENT_ACCOUNT_ID: "other" },
    { STATE_DATABASE_ID: "other" },
    { APP_ORIGIN: "http://soccerbot.test" },
    { CAMPAIGN_ID: "new-budget" },
    { CAMPAIGN_END_MS: "not-a-time" },
    { ACCESS_LIFETIME_MS: "0" },
  ])
    deniedBeforeProtected(await call({ vars }));
  for (const missing of [
    "ENVIRONMENT",
    "DEPLOYMENT_ACCOUNT_ID",
    "STATE_DATABASE_ID",
    "APP_ORIGIN",
    "STATE",
    "COORDINATOR",
    "ASSETS",
  ])
    deniedBeforeProtected(await call({ missing }));
});
test("foundation foreign database and coordinator namespace identities fail closed", async () => {
  deniedBeforeProtected(await call({ foreign: true }));
  const row = await db.prepare("SELECT * FROM foundation_identity").first();
  assert.equal(row.database_id, config.vars.STATE_DATABASE_ID);
  // A different singleton identity models a namespace mismatch, using actual idFromName.
  await db.exec(
    "DROP TRIGGER immutable_foundation_identity_update; UPDATE foundation_identity SET coordinator_id='" +
      "0".repeat(64) +
      "'",
  );
  deniedBeforeProtected(await call());
  await db
    .prepare("UPDATE foundation_identity SET coordinator_id=?")
    .bind(row.coordinator_id)
    .run();
  await db.exec(
    "CREATE TRIGGER immutable_foundation_identity_update BEFORE UPDATE ON foundation_identity BEGIN SELECT RAISE(ABORT, 'immutable foundation identity'); END;",
  );
});
test("foundation manifests are immutable and populated uncertain operations survive upgrade", async () => {
  assert.equal(
    (
      await db
        .prepare(
          "SELECT state FROM developer_operations WHERE capability_hash='synthetic-old'",
        )
        .first()
    ).state,
    "running",
  );
  await assert.rejects(
    db.exec("UPDATE foundation_identity SET environment='developer'"),
    /immutable foundation identity/,
  );
  await assert.rejects(
    db.exec("DELETE FROM foundation_identity"),
    /immutable foundation identity/,
  );
});
test("foundation rejects forged host cross-origin GET and unsupported methods", async () => {
  assert.equal((await call({ host: "https://forged.test" })).status, 403);
  assert.equal(
    (await call({ headers: { origin: "https://forged.test" } })).status,
    403,
  );
  for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"])
    assert.equal((await call({ method })).status, 404);
  assert.equal(
    (await call({ path: "/api/health?token=SYNTHETIC_PRIVATE_URL" })).status,
    400,
  );
});
test(
  "foundation bounds stalled bodies with a fixed one-second deadline",
  { timeout: 5000 },
  async () => {
    const r = await call({
      path: "/api/access",
      method: "POST",
      stalled: true,
    });
    assert.equal(r.status, 408);
    assert.deepEqual(r.queries, []);
  },
);
test("foundation invalid customer access never reaches attempt or operator data", async () => {
  for (const headers of [{}, { cookie: "__Host-soccerbot-access=bad" }]) {
    const r = await call({
      path: "/api/attempts/00000000-0000-4000-8000-000000000000/confirmation",
      headers,
    });
    assert.equal(r.status, 401);
    assert.ok(!r.queries.some((q) => /attempts|guest_access/.test(q)));
  }
  const guest = await call({ path: "/api/access", method: "POST" });
  const cookie = guest.headers["set-cookie"].split(";")[0];
  const r = await call({
    path: "/api/developer/provider-identity",
    method: "POST",
    headers: { cookie },
  });
  assert.equal(r.status, 401);
  assert.ok(!r.queries.some((q) => /developer_operations/.test(q)));
});
test("foundation concurrent requests isolate correlations and redact injected failures", async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      call({ headers: { "x-request-id": "SYNTHETIC_PRIVATE_CORRELATION" } }),
    ),
  );
  assert.equal(new Set(results.map((r) => r.headers["x-request-id"])).size, 8);
  const bad = await call({
    missing: "STATE",
    headers: { authorization: "Bearer SYNTHETIC_PRIVATE_BEARER" },
  });
  assert.equal(bad.status, 503);
  assert.ok(
    !JSON.stringify({ results, bad, logs }).includes("SYNTHETIC_PRIVATE"),
  );
});
