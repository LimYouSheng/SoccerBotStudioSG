import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import { build } from "esbuild";
import ts from "typescript";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { seedFoundation } from "./foundation-fixture.mjs";
const config = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync("wrangler.jsonc", "utf8"),
).config;
const origin = "https://soccerbot.test",
  source = "a".repeat(40),
  secret = "synthetic-webhook-secret-never-live";
let script, mf, db, windowId, outbound;
before(async () => {
  script = (
    await build({
      entryPoints: ["worker/index.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["cloudflare:workers", "node:async_hooks"],
    })
  ).outputFiles[0].text;
});
beforeEach(async () => {
  outbound = 0;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "soccerbot-webhook-test",
      modules: true,
      script,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      cf: false,
      bindings: {
        ...config.vars,
        APP_ORIGIN: origin,
        SOURCE_REVISION: source,
        SIMPLYBOOK_DEV_SIGNING_SECRET: secret,
        SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-developer",
      },
      d1Databases: { STATE: "synthetic-state" },
      durableObjects: {
        COORDINATOR: {
          className: "SoccerBotAccountCoordinator",
          useSQLite: true,
        },
      },
      outboundService: () => {
        outbound++;
        return new Response(null, { status: 599 });
      },
      serviceBindings: { ASSETS: () => new Response("static") },
    }),
  );
  await mf.ready;
  db = await mf.getD1Database("STATE");
  for (const name of readdirSync("migrations")
    .sort()
    .filter((n) => !n.startsWith("0005")))
    await db.exec(
      readFileSync(`migrations/${name}`, "utf8")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  await seedFoundation(mf, db);
  windowId = crypto.randomUUID();
});
afterEach(async () => {
  await mf?.dispose();
  assert.equal(outbound, 0, "callbacks never dispatch provider traffic");
});
async function open(maximum = 16) {
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO webhook_capture_windows VALUES(?,?,?,?,?,?,?,?,?, 'open')",
    )
    .bind(
      windowId,
      source,
      config.vars.DEPLOYMENT_ACCOUNT_ID,
      "synthetic-developer",
      "developer",
      origin,
      now - 1000,
      now + 60000,
      maximum,
    )
    .run();
}
function body(extra = {}) {
  return JSON.stringify({
    signature_algo: "sha256",
    webhook_timestamp: Math.floor(Date.now() / 1000),
    ...extra,
  });
}
function send(raw = body(), options = {}) {
  return mf.dispatchFetch(
    origin + "/api/provider/webhook" + (options.query || ""),
    {
      method: options.method || "POST",
      body: raw,
      headers: {
        "content-type": "application/json",
        "x-signature": createHmac("sha256", secret).update(raw).digest("hex"),
        ...options.headers,
      },
    },
  );
}
async function receipts() {
  return (await db.prepare("SELECT * FROM webhook_receipts").all()).results;
}
test("webhook capture defaults closed and requires exact source account environment and origin", async () => {
  assert.equal((await send()).status, 503);
  await open();
  for (const [column, value, original] of [
    ["source_revision", "b".repeat(40), source],
    ["account_id", "foreign", config.vars.DEPLOYMENT_ACCOUNT_ID],
    ["origin", "https://foreign.test", origin],
    ["company_login", "foreign-company", "synthetic-developer"],
  ]) {
    await db
      .prepare(`UPDATE webhook_capture_windows SET ${column}=?`)
      .bind(value)
      .run();
    assert.equal((await send()).status, 503);
    await db
      .prepare(`UPDATE webhook_capture_windows SET ${column}=?`)
      .bind(original)
      .run();
  }
  await assert.rejects(
    db
      .prepare("UPDATE webhook_capture_windows SET environment='foreign'")
      .run(),
    /CHECK constraint failed/,
  );
  assert.deepEqual(await receipts(), []);
});
test("webhook HMAC verifies exact raw bytes before retaining only bounded structure", async () => {
  await open();
  const raw = body({
    booking_id: 987,
    booking_hash: "synthetic-secret-hash",
    customer: { email: "private@example.test", name: "Private Name" },
  });
  const response = await send(raw);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { received: true });
  const rows = await receipts();
  assert.equal(rows.length, 1);
  const stored = JSON.stringify(rows);
  for (const marker of [
    "private@example.test",
    "Private Name",
    "synthetic-secret-hash",
    secret,
  ])
    assert.equal(stored.includes(marker), false);
  assert.equal(rows[0].state, "captured");
  assert.match(rows[0].shape_json, /booking_id/);
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM recovery_work").first()).n,
    0,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM attempts").first()).n,
    0,
  );
  assert.equal(
    (
      await send(raw + " ", {
        headers: {
          "x-signature": createHmac("sha256", secret).update(raw).digest("hex"),
        },
      })
    ).status,
    401,
  );
});
test("webhook missing forged signatures malformed envelopes and stale timestamps leave no receipts", async () => {
  await open();
  for (const signature of [
    "",
    "0".repeat(64),
    "not-hex",
    createHmac("sha256", "foreign-account-secret").update(body()).digest("hex"),
  ])
    assert.equal(
      (await send(body(), { headers: { "x-signature": signature } })).status,
      401,
    );
  for (const raw of [
    "{",
    "[]",
    "{}",
    body({ signature_algo: "sha1" }),
    body({ webhook_timestamp: "123" }),
  ])
    assert.equal((await send(raw)).status, 400);
  for (const timestamp of [
    Math.floor(Date.now() / 1000) - 301,
    Math.floor(Date.now() / 1000) + 60,
  ])
    assert.equal(
      (await send(body({ webhook_timestamp: timestamp }))).status,
      401,
    );
  assert.deepEqual(await receipts(), []);
});
test("webhook concurrent duplicates are durable and later distinct hints remain separate within the cap", async () => {
  await open(2);
  const raw = body({ arbitrary_event: "first" });
  const replies = await Promise.all(Array.from({ length: 5 }, () => send(raw)));
  assert.deepEqual(
    replies.map((r) => r.status),
    [202, 202, 202, 202, 202],
  );
  assert.equal((await receipts()).length, 1);
  assert.equal((await send(body({ arbitrary_event: "second" }))).status, 202);
  assert.equal((await send(raw)).status, 202);
  assert.equal((await send(body({ arbitrary_event: "third" }))).status, 503);
  assert.equal((await receipts()).length, 2);
});
test("webhook finite closure rejects replay and database failure is never acknowledged", async () => {
  await open();
  const raw = body();
  assert.equal((await send(raw)).status, 202);
  await db.prepare("UPDATE webhook_capture_windows SET state='closed'").run();
  assert.equal((await send(raw)).status, 503);
  await db.prepare("UPDATE webhook_capture_windows SET state='open'").run();
  await db.exec("DROP TABLE webhook_receipts");
  assert.equal((await send(raw)).status, 503);
});
test("webhook body limits and HTTP boundaries reject before capture", async () => {
  await open();
  assert.equal((await send(body({ padding: "x".repeat(16384) }))).status, 413);
  assert.equal(
    (await send(body(), { headers: { "content-type": "text/plain" } })).status,
    400,
  );
  assert.equal(
    (await send(body(), { headers: { origin: "https://foreign.test" } }))
      .status,
    403,
  );
  assert.equal((await send(body(), { query: "?paid=true" })).status, 400);
  assert.equal(
    (await mf.dispatchFetch(origin + "/api/provider/webhook")).status,
    405,
  );
  assert.deepEqual(await receipts(), []);
});

test("webhook slow streamed bodies time out and never acknowledge a receipt", async () => {
  await open();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
    },
  });
  const response = await mf.dispatchFetch(origin + "/api/provider/webhook", {
    method: "POST",
    body: stream,
    headers: {
      "content-type": "application/json",
      "x-signature": "0".repeat(64),
    },
    duplex: "half",
  });
  assert.equal(response.status, 408);
  assert.deepEqual(await receipts(), []);
});
