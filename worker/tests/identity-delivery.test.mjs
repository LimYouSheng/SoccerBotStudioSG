import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import ts from "typescript";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { seedFoundation } from "./foundation-fixture.mjs";

const config = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync("wrangler.jsonc", "utf8"),
).config;
const origin = "https://soccerbot.test",
  revision = "a".repeat(40),
  email = "sheng@app404.ai";
let script, mf, db, root, calls, botResult, mailResult, bindings;
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
async function start() {
  mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "identity-delivery-test",
      modules: true,
      script,
      cf: false,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      bindings,
      d1Databases: { STATE: "synthetic-delivery" },
      d1Persist: path.join(root, "d1"),
      durableObjects: {
        COORDINATOR: {
          className: "SoccerBotAccountCoordinator",
          useSQLite: true,
        },
      },
      serviceBindings: { ASSETS: () => new Response("synthetic") },
      outboundService: async (request) => {
        assert.equal(request.method, "POST");
        const body = await request.json();
        calls.push({ url: request.url, body, headers: request.headers });
        if (
          request.url ===
          "https://challenges.cloudflare.com/turnstile/v0/siteverify"
        )
          return botResult
            ? botResult()
            : Response.json({
                success: true,
                hostname: "soccerbot.test",
                action: "verify-email",
                challenge_ts: new Date().toISOString(),
              });
        assert.equal(request.url, "https://api.resend.com/emails");
        return mailResult
          ? mailResult()
          : Response.json({ id: crypto.randomUUID() });
      },
    }),
    resourcePersistencePath: root,
    isolatedResourcePersistencePath: root,
  });
  await mf.ready;
  db = await mf.getD1Database("STATE");
}
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "soccerbot-delivery-"));
  calls = [];
  botResult = null;
  mailResult = null;
  bindings = {
    ...config.vars,
    APP_ORIGIN: origin,
    SOURCE_REVISION: revision,
    IDENTITY_DELIVERY: "finite-test",
    IDENTITY_PEPPER: "SYNTHETIC_PEPPER_".repeat(3),
    RESEND_API_KEY: "SYNTHETIC_RESEND_".repeat(3),
    TURNSTILE_SECRET: "SYNTHETIC_BOT_".repeat(3),
  };
  await start();
  for (const name of [
    "0001_developer_journal.sql",
    "0009_identity_challenges.sql",
    "0013_remembered_identity.sql",
    "0011_identity_delivery.sql",
  ])
    await db.exec(
      readFileSync(`migrations/${name}`, "utf8")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  await seedFoundation(mf, db);
});
afterEach(async () => {
  await mf?.dispose();
  rmSync(root, { recursive: true, force: true });
});
async function open(overrides = {}) {
  const w = {
    singleton: 1,
    revision,
    origin,
    sender: "SoccerBotStudioSG Dev <noreply@auth.app404.ai>",
    email,
    start: Date.now() - 1000,
    end: Date.now() + 1190000,
    ...overrides,
  };
  await db
    .prepare(
      "INSERT INTO identity_delivery_window VALUES(?,?,?,?,?,?,?,'open')",
    )
    .bind(w.singleton, w.revision, w.origin, w.sender, w.email, w.start, w.end)
    .run();
}
async function guest() {
  const r = await mf.dispatchFetch(origin + "/api/access", {
    method: "POST",
    headers: { origin },
  });
  assert.equal(r.status, 201);
  return r.headers.get("set-cookie").split(";")[0];
}
async function request(cookie, body = {}, path = "challenges", headers = {}) {
  return mf.dispatchFetch(origin + "/api/identity/" + path, {
    method: "POST",
    headers: {
      origin,
      cookie,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.1",
      ...headers,
    },
    body: JSON.stringify({ email, ...body }),
  });
}
const challenge = (cookie, extra = {}) =>
  request(cookie, { botToken: crypto.randomUUID(), ...extra });
async function count(kind) {
  return (
    await db
      .prepare(
        "SELECT COUNT(*) AS n FROM identity_delivery_dispatches WHERE kind=?",
      )
      .bind(kind)
      .first()
  ).n;
}
test("delivery default empty window and disabled mode reject before external dispatch", async () => {
  const cookie = await guest();
  assert.equal((await challenge(cookie)).status, 503);
  await open();
  bindings.IDENTITY_DELIVERY = "disabled";
  await mf.dispose();
  await start();
  assert.equal((await challenge(cookie)).status, 503);
  assert.equal(calls.length, 0);
});
test("delivery validates exact revision origin recipient and authenticated bounded JSON before dispatch", async () => {
  await open({ revision: "b".repeat(40) });
  const cookie = await guest();
  assert.equal((await challenge(cookie)).status, 503);
  assert.equal((await challenge("")).status, 401);
  assert.equal(calls.length, 0);
});
test("delivery public routes use fixed sender recipient idempotency and single-use verified identity", async () => {
  await open();
  const cookie = await guest();
  const response = await challenge(cookie);
  assert.equal(response.status, 200);
  const c = await response.json();
  assert.equal(calls.length, 2);
  const sent = calls[1];
  assert.deepEqual(sent.body.to, [email]);
  assert.equal(
    sent.body.from,
    "SoccerBotStudioSG Dev <noreply@auth.app404.ai>",
  );
  assert.equal(
    sent.headers.get("idempotency-key"),
    `verification/${c.challengeId}`,
  );
  const code = sent.body.text.match(/code is (\d{6})/)[1];
  assert.equal(JSON.stringify(c).includes(code), false);
  const verify = () =>
    request(cookie, { challengeId: c.challengeId, code }, "verify");
  const results = await Promise.all([verify(), verify()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal(await count("email"), 1);
});
test("delivery rejects foreign recipient malformed oversized and cross-origin inputs without quota consumption", async () => {
  await open();
  const cookie = await guest();
  for (const body of [
    { email: "other@example.invalid" },
    { botToken: "x".repeat(5000) },
    { botToken: "x", from: "forged" },
  ])
    assert.ok([400, 413].includes((await challenge(cookie, body)).status));
  assert.equal(
    (
      await request(cookie, { botToken: "x" }, "challenges", {
        origin: "https://foreign.test",
      })
    ).status,
    403,
  );
  assert.equal(calls.length, 0);
  assert.equal(await count("bot"), 0);
});
test("delivery bot hostname action timestamp denial and malformed proof never send mail", async () => {
  await open();
  const cookie = await guest();
  for (const proof of [
    { success: false },
    {
      success: true,
      hostname: "foreign.test",
      action: "verify-email",
      challenge_ts: new Date().toISOString(),
    },
    {
      success: true,
      hostname: "soccerbot.test",
      action: "other",
      challenge_ts: new Date().toISOString(),
    },
  ]) {
    botResult = () => Response.json(proof);
    assert.equal((await challenge(cookie)).status, 400);
  }
  assert.equal(await count("email"), 0);
  assert.equal(calls.length, 3);
});
test("delivery durable bot replay and source quota precede outbound validation across guest sessions", async () => {
  await open();
  const token = crypto.randomUUID();
  botResult = () => Response.json({ success: false });
  assert.equal(
    (await challenge(await guest(), { botToken: token })).status,
    400,
  );
  assert.equal(
    (await challenge(await guest(), { botToken: token })).status,
    429,
  );
  await challenge(await guest());
  await challenge(await guest());
  assert.equal((await challenge(await guest())).status, 429);
  assert.equal(calls.length, 3);
  assert.equal(await count("bot"), 3);
});
test("delivery global five bot reservations survive concurrency restart and new sources", async () => {
  await open();
  botResult = () => Response.json({ success: false });
  const cookie = await guest();
  const responses = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      request(cookie, { botToken: crypto.randomUUID() }, "challenges", {
        "CF-Connecting-IP": `192.0.2.${i + 1}`,
      }),
    ),
  );
  assert.equal(responses.filter((r) => r.status === 400).length, 5);
  assert.equal(calls.length, 5);
  assert.equal(await count("bot"), 5);
  await mf.dispose();
  await start();
  assert.equal((await challenge(await guest())).status, 429);
  assert.equal(calls.length, 5);
});
test("delivery mail uncertainty retains original challenge and charged reservation with no retry", async () => {
  await open();
  mailResult = () => new Response("unavailable", { status: 503 });
  const cookie = await guest(),
    response = await challenge(cookie);
  assert.equal(response.status, 200);
  const c = await response.json();
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM identity_challenges WHERE id=?")
        .bind(c.challengeId)
        .first()
    ).state,
    "unknown",
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT state FROM identity_delivery_dispatches WHERE kind='email'",
        )
        .first()
    ).state,
    "unknown",
  );
  assert.equal(calls.length, 2);
  await mf.dispose();
  await start();
  assert.equal(await count("email"), 1);
  assert.equal(calls.length, 2);
});
test("delivery rejects redirect oversized malformed and denied upstream responses without following or retry", async () => {
  await open();
  const cookie = await guest();
  for (const result of [
    () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://foreign.test" },
      }),
    () => Response.json({ padding: "x".repeat(5000) }),
    () =>
      new Response("broken", {
        headers: { "Content-Type": "application/json" },
      }),
  ]) {
    botResult = result;
    assert.equal((await challenge(cookie)).status, 503);
  }
  assert.equal(calls.length, 3);
  assert.equal(await count("email"), 0);
});
test("delivery three global send reservations and immutable closure cannot reset across restart", async () => {
  await open();
  const now = Date.now();
  // Durable past reservations model earlier requests within the same finite window.
  for (let i = 0; i < 3; i++)
    await db
      .prepare(
        "INSERT INTO identity_delivery_dispatches VALUES(?,'email','synthetic','synthetic',?,'unknown')",
      )
      .bind(`prior-${i}`, now)
      .run();
  const r = await challenge(await guest());
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(await count("email"), 3);
  await assert.rejects(
    db.exec("DELETE FROM identity_delivery_dispatches"),
    /identity_dispatch_preserve/,
  );
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=1",
  );
  await assert.rejects(
    db.exec(
      "UPDATE identity_delivery_window SET state='open' WHERE singleton=1",
    ),
    /identity_window_immutable/,
  );
  await assert.rejects(
    db.exec("DELETE FROM identity_delivery_window"),
    /identity_window_preserve/,
  );
  await mf.dispose();
  await start();
  assert.equal((await challenge(await guest())).status, 503);
  assert.equal(calls.length, 1);
});
test("delivery expired and near-expiry windows stop before dispatch without extending the grant", async () => {
  await open({ start: Date.now() - 10000, end: Date.now() + 1000 });
  assert.equal((await challenge(await guest())).status, 503);
  assert.equal(calls.length, 0);
});
test("delivery rechecks closure after bot response and retains uncertain challenge without email", async () => {
  await open();
  botResult = async () => {
    await db.exec(
      "UPDATE identity_delivery_window SET state='closed' WHERE singleton=1",
    );
    return Response.json({
      success: true,
      hostname: "soccerbot.test",
      action: "verify-email",
      challenge_ts: new Date().toISOString(),
    });
  };
  const r = await challenge(await guest());
  assert.equal(r.status, 200);
  const c = await r.json();
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM identity_challenges WHERE id=?")
        .bind(c.challengeId)
        .first()
    ).state,
    "unknown",
  );
  assert.equal(calls.length, 1);
  assert.equal(await count("email"), 0);
});
test("delivery rejects expired future and unparseable bot timestamps", async () => {
  await open();
  const cookie = await guest();
  for (const timestamp of [
    new Date(Date.now() - 301000).toISOString(),
    new Date(Date.now() + 60000).toISOString(),
    "invalid",
  ]) {
    botResult = () =>
      Response.json({
        success: true,
        hostname: "soccerbot.test",
        action: "verify-email",
        challenge_ts: timestamp,
      });
    assert.equal((await challenge(cookie)).status, 400);
  }
  assert.equal(await count("email"), 0);
  assert.equal(calls.length, 3);
});

async function replacementMigration() {
  await db.exec(
    readFileSync("migrations/0012_identity_replacement_window.sql", "utf8")
      .replace(/^--.*$/gm, "")
      .replace(/\n/g, " "),
  );
}
test("delivery replacement preserves closed history and permits one unused replacement across restart", async () => {
  await open();
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=1",
  );
  const original = await db
    .prepare("SELECT * FROM identity_delivery_window")
    .first();
  await replacementMigration();
  assert.deepEqual(
    await db.prepare("SELECT * FROM identity_delivery_window").first(),
    original,
  );
  await open({ singleton: 2, start: Date.now(), end: Date.now() + 1190000 });
  await mf.dispose();
  await start();
  assert.equal((await challenge(await guest())).status, 200);
  assert.equal(await count("bot"), 1);
  assert.equal(await count("email"), 1);
  assert.deepEqual(
    await db
      .prepare("SELECT * FROM identity_delivery_window WHERE singleton=1")
      .first(),
    original,
  );
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=2",
  );
  assert.equal((await challenge(await guest())).status, 503);
  await assert.rejects(open({ singleton: 3 }));
  await assert.rejects(
    db.exec(
      "UPDATE identity_delivery_window SET state='open' WHERE singleton=2",
    ),
    /identity_window_immutable/,
  );
  await assert.rejects(
    db.exec("DELETE FROM identity_delivery_window"),
    /identity_window_preserve/,
  );
});
test("delivery replacement rejects overlap missing predecessor and changed expiry", async () => {
  await replacementMigration();
  await assert.rejects(
    open({ singleton: 2 }),
    /identity_window_replacement_denied/,
  );
  await open();
  await assert.rejects(
    open({ singleton: 2 }),
    /identity_window_replacement_denied/,
  );
  await assert.rejects(
    db.exec(
      "UPDATE identity_delivery_window SET expires_ms=expires_ms+1 WHERE singleton=1",
    ),
    /identity_window_immutable/,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM identity_delivery_window")
        .first()
    ).n,
    1,
  );
  assert.equal(calls.length, 0);
});
test("delivery replacement preserves charged unknown dispatch and refuses a budget reset", async () => {
  await open();
  await db
    .prepare(
      "INSERT INTO identity_delivery_dispatches VALUES('retained','bot','synthetic','synthetic',?,'unknown')",
    )
    .bind(Date.now())
    .run();
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=1",
  );
  const before = (
    await db.prepare("SELECT * FROM identity_delivery_dispatches").all()
  ).results;
  await replacementMigration();
  await assert.rejects(
    open({ singleton: 2 }),
    /identity_window_replacement_denied/,
  );
  assert.deepEqual(
    (await db.prepare("SELECT * FROM identity_delivery_dispatches").all())
      .results,
    before,
  );
  assert.equal((await challenge(await guest())).status, 503);
  assert.equal(calls.length, 0);
});
test("delivery replacement keeps global dispatch limits and denies a foreign release", async () => {
  await open();
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=1",
  );
  await replacementMigration();
  await open({
    singleton: 2,
    start: Date.now(),
    end: Date.now() + 1190000,
    revision: "b".repeat(40),
  });
  assert.equal((await challenge(await guest())).status, 503);
  assert.equal(calls.length, 0);
  for (let i = 0; i < 3; i++)
    await db
      .prepare(
        "INSERT INTO identity_delivery_dispatches VALUES(?,'email','synthetic','synthetic',?,'unknown')",
      )
      .bind("limit-" + i, Date.now())
      .run();
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO identity_delivery_dispatches VALUES('excess','email','synthetic','synthetic',?,'unknown')",
      )
      .bind(Date.now())
      .run(),
    /identity_delivery_limited/,
  );
  assert.equal(await count("email"), 3);
});

async function proofMigration() {
  await db.exec(
    readFileSync("migrations/0014_identity_proof_window.sql", "utf8")
      .replace(/^--.*$/gm, "")
      .replace(/\n/g, " "),
  );
}
async function proofHistory() {
  const now = Date.now();
  await open({ start: now - 10000000, end: now - 9000000 });
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=1",
  );
  await replacementMigration();
  await open({ singleton: 2, start: now - 8000000, end: now - 7000000 });
  await db
    .prepare(
      "INSERT INTO identity_delivery_dispatches VALUES('historical-email','email','historical','historical',?,'unknown')",
    )
    .bind(now - 7500000)
    .run();
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=2",
  );
  const history = {
    windows: (
      await db
        .prepare("SELECT * FROM identity_delivery_window ORDER BY singleton")
        .all()
    ).results,
    dispatches: (
      await db.prepare("SELECT * FROM identity_delivery_dispatches").all()
    ).results,
  };
  await proofMigration();
  return history;
}
async function openProof(overrides = {}) {
  await open({
    singleton: 3,
    start: Date.now() - 1000,
    end: Date.now() + 3590000,
    ...overrides,
  });
}
async function rememberedProof() {
  const cookie = await guest();
  const c = await (await challenge(cookie)).json();
  const code = calls
    .findLast((c) => c.url === "https://api.resend.com/emails")
    .body.text.match(/code is (\d{6})/)[1];
  const r = await request(
    cookie,
    { challengeId: c.challengeId, code, remember: true },
    "verify",
  );
  assert.equal(r.status, 200);
  return {
    cookie,
    remember: r.headers.get("set-cookie").split(";")[0],
    id: c.challengeId,
    code,
  };
}
async function restore(cookie) {
  return mf.dispatchFetch(origin + "/api/identity/restore", {
    method: "POST",
    headers: { origin, cookie },
  });
}
test("identity proof migration preserves both closed windows and charged history without provisioning authority", async () => {
  const history = await proofHistory();
  assert.deepEqual(
    (
      await db
        .prepare("SELECT * FROM identity_delivery_window ORDER BY singleton")
        .all()
    ).results,
    history.windows,
  );
  assert.deepEqual(
    (await db.prepare("SELECT * FROM identity_delivery_dispatches").all())
      .results,
    history.dispatches,
  );
  assert.equal((await challenge(await guest())).status, 503);
  assert.equal(calls.length, 0);
});
test("identity proof admits only one finite successor with exact recipient and immutable expiry", async () => {
  await replacementMigration();
  await proofMigration();
  await assert.rejects(openProof(), /identity_window_proof_denied/);
  await open({ start: Date.now() - 5000000, end: Date.now() - 4000000 });
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=1",
  );
  await open({
    singleton: 2,
    start: Date.now() - 3000000,
    end: Date.now() - 2000000,
  });
  await assert.rejects(openProof(), /identity_window_proof_denied/);
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=2",
  );
  await assert.rejects(
    openProof({ email: "foreign@example.invalid" }),
    /identity_window_proof_denied/,
  );
  await assert.rejects(openProof({ end: Date.now() + 3600001 }));
  await openProof();
  await assert.rejects(open({ singleton: 4 }));
  await assert.rejects(
    db.exec(
      "UPDATE identity_delivery_window SET expires_ms=expires_ms+1 WHERE singleton=3",
    ),
    /identity_window_immutable/,
  );
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=3",
  );
  await assert.rejects(openProof());
  await assert.rejects(
    db.exec(
      "UPDATE identity_delivery_window SET state='open' WHERE singleton=3",
    ),
    /identity_window_immutable/,
  );
  assert.equal(calls.length, 0);
});
test("identity proof counts six emails and eight bot reservations separately from preserved historical charges", async () => {
  await proofHistory();
  await openProof();
  const now = Date.now();
  for (const [kind, limit] of [
    ["email", 6],
    ["bot", 8],
  ]) {
    const reserve = (i) =>
      db
        .prepare(
          "INSERT INTO identity_delivery_dispatches VALUES(?,?,?,?,?,'unknown')",
        )
        .bind(`${kind}-${i}`, kind, "synthetic", `source-${i}`, now)
        .run();
    await Promise.all(Array.from({ length: limit }, (_, i) => reserve(i)));
    await assert.rejects(reserve(limit), /identity_delivery_limited/);
    assert.equal(await count(kind), limit + (kind === "email" ? 1 : 0));
  }
  await mf.dispose();
  await start();
  assert.equal(await count("email"), 7);
  assert.equal(await count("bot"), 8);
  await assert.rejects(
    db.exec("DELETE FROM identity_delivery_dispatches"),
    /identity_dispatch_preserve/,
  );
  assert.equal(calls.length, 0);
});
test("identity proof close revokes issued and restored authority while preserving guest history", async () => {
  await proofHistory();
  await openProof();
  const p = await rememberedProof();
  const fresh = await guest();
  assert.equal((await restore(fresh + "; " + p.remember)).status, 200);
  const before = (
    await db
      .prepare("SELECT * FROM guest_access ORDER BY capability_hash")
      .all()
  ).results;
  await db.exec(
    "UPDATE identity_delivery_window SET state='closed' WHERE singleton=3",
  );
  const family = await db
    .prepare("SELECT * FROM remembered_identity WHERE id=?")
    .bind(p.id)
    .first();
  assert.equal(typeof family.revoked_ms, "number");
  assert.equal(family.expires_ms - family.verified_ms, 7776000000);
  const after = (
    await db
      .prepare("SELECT * FROM guest_access ORDER BY capability_hash")
      .all()
  ).results;
  assert.deepEqual(
    after.map((row) => ({ ...row, revoked_ms: null })),
    before.map((row) => ({ ...row, revoked_ms: null })),
  );
  assert.ok(after.every((r) => r.revoked_ms !== null));
  assert.equal(
    (await restore((await guest()) + "; " + p.remember)).status,
    503,
  );
  assert.equal(
    (
      await request(
        p.cookie,
        { challengeId: p.id, code: p.code, remember: true },
        "verify",
      )
    ).status,
    401,
  );
  assert.equal(calls.length, 2);
});
test("identity proof expiry blocks identity reads and restoration independently of ninety-day cookies", async () => {
  await proofHistory();
  await openProof({ start: Date.now() - 3600000, end: Date.now() - 1 });
  const cookie = await guest();
  assert.equal((await restore(cookie)).status, 503);
  assert.equal(
    (
      await mf.dispatchFetch(origin + "/api/identity", {
        headers: { origin, cookie },
      })
    ).status,
    503,
  );
  assert.equal((await challenge(cookie)).status, 503);
  assert.equal(calls.length, 0);
});
test("identity proof closure during bot completion forbids mail and keeps the charged dispatch", async () => {
  await proofHistory();
  await openProof();
  botResult = async () => {
    await db.exec(
      "UPDATE identity_delivery_window SET state='closed' WHERE singleton=3",
    );
    return Response.json({
      success: true,
      hostname: "soccerbot.test",
      action: "verify-email",
      challenge_ts: new Date().toISOString(),
    });
  };
  await challenge(await guest());
  assert.equal(calls.length, 1);
  assert.equal(await count("email"), 1);
  assert.equal(await count("bot"), 1);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT state FROM identity_delivery_dispatches WHERE kind='bot'",
        )
        .first()
    ).state,
    "responded",
  );
});
test("identity proof wrong revision and disabled delivery block restoration as well as challenges", async () => {
  await proofHistory();
  await openProof({ revision: "b".repeat(40) });
  const cookie = await guest();
  assert.equal((await restore(cookie)).status, 503);
  assert.equal((await challenge(cookie)).status, 503);
  bindings.IDENTITY_DELIVERY = "disabled";
  bindings.SOURCE_REVISION = "b".repeat(40);
  await mf.dispose();
  await start();
  assert.equal((await restore(cookie)).status, 503);
  assert.equal(calls.length, 0);
});
test("identity proof closure storage failure rolls back the close and all revocation writes", async () => {
  await proofHistory();
  await openProof();
  const p = await rememberedProof();
  await db.exec(
    "CREATE TRIGGER synthetic_close_failure BEFORE UPDATE OF revoked_ms ON remembered_identity BEGIN SELECT RAISE(ABORT,'synthetic_close_failure'); END;",
  );
  await assert.rejects(
    db.exec(
      "UPDATE identity_delivery_window SET state='closed' WHERE singleton=3",
    ),
    /synthetic_close_failure/,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM identity_delivery_window WHERE singleton=3")
        .first()
    ).state,
    "open",
  );
  assert.equal(
    (
      await db
        .prepare("SELECT revoked_ms FROM remembered_identity WHERE id=?")
        .bind(p.id)
        .first()
    ).revoked_ms,
    null,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM guest_access WHERE revoked_ms IS NOT NULL",
        )
        .first()
    ).n,
    0,
  );
  assert.equal(calls.length, 2);
});
