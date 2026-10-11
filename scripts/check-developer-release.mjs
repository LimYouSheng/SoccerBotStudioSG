// Inspect the exact packaged bytes with isolated workerd/D1. No remote bindings.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from "miniflare";
import { exportInventory, checkExport } from "./check-export.mjs";
import { releaseProfile } from "./release-profile.mjs";
const profile = releaseProfile();
const directory = "test-results/developer-release";
const read = (file) => JSON.parse(readFileSync(`${directory}/${file}`, "utf8"));
const manifest = read("manifest.json"),
  config = read("wrangler.json");
const files = exportInventory(directory);
delete files["manifest.json"];
assert.deepEqual(files, manifest.files);
assert.equal(config.no_bundle, true);
assert.equal(manifest.bookingMode, profile.bookingMode);
assert.equal(manifest.releaseProfile, profile.name);
assert.equal(manifest.turnstileSitekey, profile.sitekey);
assert.equal(manifest.identityDelivery, "disabled");
assert.equal(config.vars.SOURCE_REVISION, manifest.sourceRevision);
assert.equal(config.vars.PROVIDER_ACCESS, "disabled");
assert.equal(config.vars.CAMPAIGN_END_MS, "0");
assert.equal(config.vars.IDENTITY_DELIVERY, "disabled");
checkExport(`${directory}/assets`, "");
let outbound = 0;
const temporary = mkdtempSync(path.join(tmpdir(), "soccerbot-release-"));
const mf = new Miniflare({
  ...convertV4MiniflareOptions({
    name: "release-check",
    modules: true,
    script: readFileSync(`${directory}/worker/index.js`, "utf8"),
    cf: false,
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    bindings: config.vars,
    d1Databases: { STATE: "synthetic-state" },
    durableObjects: {
      COORDINATOR: {
        className: "SoccerBotAccountCoordinator",
        useSQLite: true,
      },
    },
    serviceBindings: { ASSETS: () => new Response(null, { status: 404 }) },
    outboundService: () => {
      outbound++;
      throw new Error("No outbound release verification");
    },
  }),
  log: new Log(LogLevel.ERROR),
  resourcePersistencePath: temporary,
  isolatedResourcePersistencePath: temporary,
});
try {
  await mf.ready;
  const db = await mf.getD1Database("STATE");
  const migrate = async (name) =>
    db.exec(
      readFileSync(`${directory}/migrations/${name}`, "utf8")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  const names = Object.keys(manifest.files)
    .filter((f) => f.startsWith("migrations/"))
    .map((f) => f.slice(11))
    .sort();
  for (const name of names.slice(0, 5)) await migrate(name);
  const ns = await mf.getDurableObjectNamespace("COORDINATOR");
  await db
    .prepare("INSERT INTO foundation_identity VALUES(1,?,?,?,?)")
    .bind(
      config.account_id,
      "developer",
      config.vars.STATE_DATABASE_ID,
      ns.idFromName("simplybook-developer-account").toString(),
    )
    .run();
  const identity = await db
    .prepare("SELECT * FROM foundation_identity")
    .first();
  const id = crypto.randomUUID(),
    now = Date.now();
  const intent = JSON.stringify({
    accountId: "synthetic-account",
    environmentId: "developer",
    customerId: "synthetic-customer",
    currency: "SGD",
    totalMinor: 8800,
    taxMinor: 0,
    sessions: [
      {
        serviceId: "2",
        instructorId: "2",
        startMs: now + 86400000,
        players: 1,
        totalMinor: 8800,
        taxMinor: 0,
      },
    ],
  });
  const origin = config.vars.APP_ORIGIN;
  const access = await mf.dispatchFetch(`${origin}/api/access`, {
    method: "POST",
    headers: { origin },
  });
  assert.equal(access.status, 201);
  const cookie = access.headers.get("set-cookie").split(";")[0];
  const owner = (await db.prepare("SELECT owner_id FROM guest_access").first())
    .owner_id;
  await db
    .prepare(
      "INSERT INTO attempts(id,owner_id,idempotency_key,intent_json,intent_hash,created_ms,deadline_ms,state) VALUES(?,?,?,?,?,?,?,'dispatching')",
    )
    .bind(
      id,
      owner,
      "synthetic-release-0001",
      intent,
      "synthetic-hash",
      now,
      now + 600000,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO dispatches VALUES(?,?,'booking.create',1,?,'unknown')",
    )
    .bind(crypto.randomUUID(), id, now)
    .run();
  const before = await db.prepare("SELECT * FROM attempts").first();
  const effects = await db.prepare("SELECT * FROM dispatches").all();
  await db
    .prepare(
      "INSERT INTO developer_operations VALUES('synthetic-retained','historical_comparison',1,'running',NULL)",
    )
    .run();
  const grants = (await db.prepare("SELECT * FROM developer_operations").all())
    .results;
  assert.deepEqual(manifest.pendingRemoteMigrations, [
    "0013_remembered_identity.sql",
    "0014_identity_proof_window.sql",
  ]);
  // Old-state compatibility remains tested locally, never re-applied remotely.
  for (const name of names.slice(5, 8)) await migrate(name);
  const appliedEight = {
    attempts: (await db.prepare("SELECT * FROM attempts ORDER BY id").all())
      .results,
    grants: (
      await db
        .prepare("SELECT * FROM developer_operations ORDER BY capability_hash")
        .all()
    ).results,
  };
  for (const name of names.slice(8, 12)) await migrate(name);
  // Preserve every application table and column; D1 owns its protected _cf_METADATA table.
  const priorTables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_METADATA' ORDER BY name",
      )
      .all()
  ).results.map((row) => row.name);
  const snapshots = new Map();
  for (const table of priorTables)
    snapshots.set(
      table,
      (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())
        .results,
    );
  for (const name of manifest.pendingRemoteMigrations) await migrate(name);
  for (const table of priorTables)
    assert.deepEqual(
      (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())
        .results,
      snapshots.get(table),
    );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM remembered_identity").first())
      .n,
    0,
  );

  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM identity_delivery_window")
        .first()
    ).n,
    0,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM identity_delivery_dispatches")
        .first()
    ).n,
    0,
  );
  assert.deepEqual(
    (await db.prepare("SELECT * FROM attempts ORDER BY id").all()).results,
    appliedEight.attempts,
  );
  assert.deepEqual(
    (
      await db
        .prepare("SELECT * FROM developer_operations ORDER BY capability_hash")
        .all()
    ).results,
    appliedEight.grants,
  );
  assert.deepEqual(
    (await db.prepare("SELECT * FROM developer_operations").all()).results,
    grants,
  );
  await db
    .prepare(
      "INSERT INTO developer_operations VALUES('synthetic-discovery','native_field_discovery',1,'blocked',NULL)",
    )
    .run();
  const after = await db.prepare("SELECT * FROM attempts").first();
  const { confirmation_next_ms, confirmation_checks, ...retained } = after;
  assert.deepEqual(retained, before);
  assert.equal(confirmation_next_ms, 0);
  assert.equal(confirmation_checks, 0);
  assert.deepEqual(
    await db.prepare("SELECT * FROM foundation_identity").first(),
    identity,
  );
  assert.deepEqual(
    (await db.prepare("SELECT * FROM dispatches").all()).results,
    effects.results,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM recovery_work WHERE attempt_id=?")
        .bind(id)
        .first()
    ).state,
    "due",
  );
  const health = await mf.dispatchFetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).revision, manifest.sourceRevision);
  const delivery = await mf.dispatchFetch(`${origin}/api/identity/challenges`, {
    method: "POST",
    headers: { cookie, origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sheng@app404.ai",
      botToken: "synthetic-unused",
    }),
  });
  assert.equal(delivery.status, 503);
  assert.deepEqual(await delivery.json(), { error: "identity_unavailable" });
  const url = `${origin}/api/attempts/${id}/checkout`;
  assert.equal((await mf.dispatchFetch(url)).status, 401);
  const context = await mf.dispatchFetch(url, { headers: { cookie } });
  assert.equal(context.status, 200);
  assert.deepEqual((await context.json()).checkout, { state: "unavailable" });
  const confirmation = await mf.dispatchFetch(
    `${origin}/api/attempts/${id}/confirmation`,
    { headers: { cookie } },
  );
  assert.equal(confirmation.status, 200);
  assert.equal((await confirmation.json()).status, "pending");
  await mf.dispatchFetch(`${origin}/api/access`, {
    method: "DELETE",
    headers: { origin, cookie },
  });
  assert.equal(
    (await mf.dispatchFetch(url, { headers: { cookie } })).status,
    401,
  );
  assert.equal(outbound, 0);
  writeFileSync(
    "test-results/developer-release-check.json",
    JSON.stringify(
      {
        status: "passed",
        sourceRevision: manifest.sourceRevision,
        testedCheckout: manifest.testedCheckout,
        checks: [
          "file hashes",
          "root export",
          "0001–0012 application state and pending0013/0014 preserve all existing columns identities unknown effects and operator grants",
          "empty identity delivery authority and default-closed HTTP",
          "exact Worker revision",
          "protected checkout unavailable",
          "durable pending confirmation",
          "revoked access denied",
        ],
        providerRequests: outbound,
        remoteOperations: 0,
        releaseProfile: profile.name,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await mf.dispose();
  rmSync(temporary, { recursive: true, force: true });
}
console.log("Exact developer release passed isolated checks; not deployed.");
