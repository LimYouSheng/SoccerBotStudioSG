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
const liveConfig = read("wrangler-live.json");
assert.deepEqual(liveConfig, {
  ...config,
  triggers: { crons: ["* * * * *"] },
  vars: {
    ...config.vars,
    PROVIDER_ACCESS: "trusted-reads",
    LIVE_CUSTOMER_ACCESS: "enabled",
    PREMIUM_SERVICE_ID: "3",
    IDENTITY_DELIVERY: "ongoing",
    LIVE_READBACK: "enabled",
  },
});
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
    "0027_ongoing_identity_delivery.sql",
    "0028_ongoing_native_readback.sql",
    "0029_direct_hitpay.sql",
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
  for (const name of names.slice(8, 14)) await migrate(name);
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
  // Retain additive-upgrade coverage even though these migrations are now applied.
  for (const name of names.slice(14, 16)) await migrate(name);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM native_checkout_grants").first())
      .n,
    0,
  );
  // Exercise the applied compatible table rebuild with a real retained grant.
  await db
    .prepare(
      "INSERT INTO native_checkout_grants(capability_hash,source_revision,contract_json,not_before_ms,expires_ms,starting_used,maximum_used,state,result_json) SELECT capability_hash,?, '{}',1,2,15,64,'blocked',? FROM guest_access LIMIT 1",
    )
    .bind(
      "a".repeat(40),
      JSON.stringify({ state: "prerequisites_unavailable" }),
    )
    .run();
  const retainedNative = (
    await db
      .prepare("SELECT * FROM native_checkout_grants ORDER BY capability_hash")
      .all()
  ).results;
  assert.equal(retainedNative.length, 1);
  for (const name of names.slice(16, 18)) await migrate(name);
  assert.deepEqual(
    (
      await db
        .prepare(
          "SELECT * FROM native_checkout_grants ORDER BY capability_hash",
        )
        .all()
    ).results,
    retainedNative,
  );
  // The new schema admits only the reviewed ceiling and preserves retained fields.
  await db.prepare("UPDATE native_checkout_grants SET maximum_used=176").run();
  await assert.rejects(
    db.prepare("UPDATE native_checkout_grants SET maximum_used=177").run(),
  );
  await migrate("0019_native_grant_ceiling_224.sql");
  assert.equal(
    (
      await db
        .prepare("SELECT maximum_used FROM native_checkout_grants")
        .first()
    ).maximum_used,
    176,
  );
  await db.prepare("UPDATE native_checkout_grants SET maximum_used=208").run();
  await assert.rejects(
    db.prepare("UPDATE native_checkout_grants SET maximum_used=209").run(),
  );
  await migrate("0020_native_grant_ceiling_256.sql");
  assert.equal(
    (
      await db
        .prepare("SELECT maximum_used FROM native_checkout_grants")
        .first()
    ).maximum_used,
    208,
  );
  await db.prepare("UPDATE native_checkout_grants SET maximum_used=240").run();
  await assert.rejects(
    db.prepare("UPDATE native_checkout_grants SET maximum_used=241").run(),
  );
  await migrate("0021_native_grant_ceiling_512.sql");
  assert.equal(
    (
      await db
        .prepare("SELECT maximum_used FROM native_checkout_grants")
        .first()
    ).maximum_used,
    240,
  );
  await db.prepare("UPDATE native_checkout_grants SET maximum_used=496").run();
  await assert.rejects(
    db.prepare("UPDATE native_checkout_grants SET maximum_used=497").run(),
  );
  await db
    .prepare("UPDATE native_checkout_grants SET maximum_used=?")
    .bind(retainedNative[0].maximum_used)
    .run();
  assert.deepEqual(
    (
      await db
        .prepare(
          "SELECT * FROM native_checkout_grants ORDER BY capability_hash",
        )
        .all()
    ).results,
    retainedNative,
  );
  // The pending capture migration must preserve every applied table and start closed.
  const appliedTables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_METADATA' ORDER BY name",
      )
      .all()
  ).results.map((row) => row.name);
  const appliedSnapshots = new Map();
  for (const table of appliedTables)
    appliedSnapshots.set(
      table,
      (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())
        .results,
    );
  await migrate("0022_webhook_capture.sql");
  await migrate("0023_webhook_subscription_grants.sql");
  for (const table of appliedTables)
    assert.deepEqual(
      (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())
        .results,
      appliedSnapshots.get(table),
    );
  for (const table of [
    "webhook_capture_windows",
    "webhook_receipts",
    "webhook_subscription_grants",
    "webhook_recovery_scopes",
    "webhook_pending_hints",
  ])
    assert.equal(
      (await db.prepare(`SELECT count(*) n FROM "${table}"`).first()).n,
      0,
    );
  // The new scope table must preserve the already applied capture history.
  const legacyWindow = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO webhook_capture_windows VALUES(?,?,?,?,?,?,?,?,?,'closed')",
    )
    .bind(
      legacyWindow,
      manifest.sourceRevision,
      config.account_id,
      "synthetic-developer",
      "developer",
      origin,
      1,
      2,
      16,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO webhook_subscription_grants(window_id,create_hash,cleanup_hash,starting_used,maximum_used,state) VALUES(?,?,?,0,80,'delete_unknown')",
    )
    .bind(legacyWindow, "a".repeat(64), "b".repeat(64))
    .run();
  const captureHistory = (
    await db.prepare("SELECT * FROM webhook_capture_windows").all()
  ).results;
  const subscriptionHistory = (
    await db.prepare("SELECT * FROM webhook_subscription_grants").all()
  ).results;
  await migrate("0024_webhook_event_scopes.sql");
  assert.deepEqual(
    (await db.prepare("SELECT * FROM webhook_capture_windows").all()).results,
    captureHistory,
  );
  assert.deepEqual(
    (await db.prepare("SELECT * FROM webhook_subscription_grants").all())
      .results,
    subscriptionHistory,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM webhook_event_scopes").first()).n,
    0,
  );
  // Raising the native schema ceiling must preserve every historical row,
  // including unknown webhook effects, and leave the recovery reserve excluded.
  const beforeCeiling = new Map();
  const ceilingTables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_METADATA' ORDER BY name",
      )
      .all()
  ).results.map((row) => row.name);
  for (const table of ceilingTables)
    beforeCeiling.set(
      table,
      (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())
        .results,
    );
  await migrate("0025_native_grant_ceiling_704.sql");
  for (const table of ceilingTables)
    assert.deepEqual(
      (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())
        .results,
      beforeCeiling.get(table),
    );
  await db.prepare("UPDATE native_checkout_grants SET maximum_used=688").run();
  await assert.rejects(
    db.prepare("UPDATE native_checkout_grants SET maximum_used=689").run(),
  );
  await db
    .prepare("UPDATE native_checkout_grants SET maximum_used=?")
    .bind(retainedNative[0].maximum_used)
    .run();
  const beforeOngoing = new Map();
  for (const table of ceilingTables)
    beforeOngoing.set(
      table,
      (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())
        .results,
    );
  await migrate("0026_ongoing_customer_checkout.sql");
  for (const table of ceilingTables) {
    const rows = (
      await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()
    ).results;
    assert.deepEqual(
      rows,
      table === "native_checkout_grants"
        ? beforeOngoing.get(table).map((row) => ({ ...row, ongoing: 0 }))
        : beforeOngoing.get(table),
    );
  }
  const beforeDeliveryUpgrade = (
    await db
      .prepare("SELECT * FROM identity_delivery_dispatches ORDER BY id")
      .all()
  ).results;
  await migrate("0027_ongoing_identity_delivery.sql");
  await migrate("0028_ongoing_native_readback.sql");
  await migrate("0029_direct_hitpay.sql");
  assert.deepEqual(
    (
      await db
        .prepare("SELECT * FROM identity_delivery_dispatches ORDER BY id")
        .all()
    ).results,
    beforeDeliveryUpgrade.map((row) => ({ ...row, ongoing: 0 })),
  );
  assert.equal(
    (
      await mf.dispatchFetch(`${origin}/api/provider/webhook`, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      })
    ).status,
    503,
  );
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    [],
  );
  for (const table of priorTables)
    assert.deepEqual(
      (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())
        .results,
      snapshots.get(table),
    );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM native_checkout_grants")
        .first()
    ).n,
    1,
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
          "applied0001–0017 preserve all existing fields, identities, unknown effects and closed grants",
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
