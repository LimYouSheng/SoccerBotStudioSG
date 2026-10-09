import { seedFoundation } from "./foundation-fixture.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import ts from "typescript";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const config = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync("wrangler.jsonc", "utf8"),
).config;
const persistence = mkdtempSync(path.join(tmpdir(), "soccerbot-worker-"));
let mf,
  db,
  outbound = 0,
  script;
const origin = "https://soccerbot.test";
async function start() {
  mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "soccerbot-test",
      modules: true,
      script,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      cf: false,
      bindings: {
        ...config.vars,
        APP_ORIGIN: origin,
        CAMPAIGN_END_MS: String(Date.now() + 3600000),
      },
      d1Databases: { STATE: "synthetic-state" },
      d1Persist: path.join(persistence, "d1"),
      durableObjects: {
        COORDINATOR: {
          className: "SoccerBotAccountCoordinator",
          useSQLite: true,
        },
      },
      durableObjectsPersist: path.join(persistence, "do"),
      outboundService: () => {
        outbound++;
        return new Response(null, { status: 599 });
      },
      serviceBindings: { ASSETS: () => new Response("synthetic-static-asset") },
    }),
    unsafeInspectDurableObjects: true,
    resourcePersistencePath: persistence,
    isolatedResourcePersistencePath: persistence,
  });
  await mf.ready;
  db = await mf.getD1Database("STATE");
}
async function call(p, body) {
  return mf.dispatchFetch(origin + p, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
async function result(p, body) {
  const r = await call(p, body);
  assert.equal(r.status, 200);
  return (await r.json()).result;
}
async function guest() {
  const r = await mf.dispatchFetch(origin + "/api/access", {
    method: "POST",
    headers: { origin },
  });
  assert.equal(r.status, 201);
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/);
  const token = cookie.split(";")[0].split("=")[1];
  const hash = createHash("sha256").update(token).digest("hex");
  const row = await db
    .prepare("SELECT * FROM guest_access WHERE capability_hash=?")
    .bind(hash)
    .first();
  return { cookie: cookie.split(";")[0], owner: row.owner_id, hash };
}
function intent() {
  return {
    accountId: "synthetic-account",
    environmentId: "developer",
    customerId: "synthetic-customer",
    currency: "SGD",
    totalMinor: 8800,
    taxMinor: 0,
    sessions: [
      {
        serviceId: "service-2",
        instructorId: "instructor-2",
        startMs: Date.now() + 86400000,
        players: 2,
        totalMinor: 8800,
        taxMinor: 0,
      },
    ],
  };
}
async function prepared(g = undefined, age = 0) {
  g ||= await guest();
  const approved = intent();
  const a = await result("/test/prepare", {
    owner: g.owner,
    key: crypto.randomUUID(),
    intent: approved,
    now: Date.now() - age,
  });
  return { ...g, id: a.id, intent: approved };
}
async function read(a, suffix = "") {
  return mf.dispatchFetch(
    origin + `/api/attempts/${a.id}/confirmation` + suffix,
    { headers: { cookie: a.cookie } },
  );
}
async function observation(a) {
  const now = Date.now(),
    s = a.intent.sessions[0],
    money = { currency: "SGD", totalMinor: 8800, taxMinor: 0 };
  const scope = {
    accountId: "synthetic-account",
    environmentId: "developer",
    attemptId: a.id,
    customerId: "synthetic-customer",
    observedAtMs: now,
  };
  return {
    bookings: [
      {
        ...scope,
        invoiceId: "invoice-1",
        status: "confirmed",
        session: {
          bookingId: "booking-1",
          serviceId: s.serviceId,
          instructorId: s.instructorId,
          startMs: s.startMs,
          playEndMs: s.startMs + 2400000,
          occupiedStartMs: s.startMs,
          occupiedEndMs: s.startMs + 3000000,
        },
      },
    ],
    invoice: {
      ...scope,
      invoiceId: "invoice-1",
      money,
      lines: [{ bookingId: "booking-1", money }],
      status: "paid",
      paymentReceived: true,
    },
  };
}
async function associated(age = 0) {
  const a = await prepared(undefined, age);
  await result("/test/claim", { id: a.id, fence: 0, now: Date.now() });
  await result("/test/associate", {
    id: a.id,
    fence: 1,
    references: { invoiceId: "invoice-1", bookingIds: ["booking-1"] },
  });
  return a;
}
before(async () => {
  script = (
    await build({
      entryPoints: ["worker/tests/harness.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["cloudflare:workers", "node:async_hooks"],
    })
  ).outputFiles[0].text;
  await start();
  const sql = readFileSync(
    "migrations/0001_developer_journal.sql",
    "utf8",
  ).replace(/^--.*$/gm, "");
  await seedFoundation(mf, db);
  // D1 exec accepts newline-separated statements, including complete triggers.
  await db.exec(sql.replace(/\n/g, " "));
  await db.exec(
    readFileSync("migrations/0003_session_effects.sql", "utf8")
      .replace(/^--.*$/gm, "")
      .replace(/\n/g, " "),
  );
  await db.exec(
    readFileSync("migrations/0006_recovery_work.sql", "utf8")
      .replace(/^--.*$/gm, "")
      .replace(/\n/g, " "),
  );
  await db.exec(
    readFileSync("migrations/0007_confirmation_checking.sql", "utf8")
      .replace(/^--.*$/gm, "")
      .replace(/\n/g, " "),
  );
});
after(async () => {
  if (mf) await mf.dispose();
  rmSync(persistence, { recursive: true, force: true });
  assert.equal(
    outbound,
    0,
    "synthetic suite must never dispatch provider traffic",
  );
});
test("health identifies disabled development mode", async () => {
  const r = await mf.dispatchFetch(origin + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).providerAccess, "disabled");
  assert.equal(r.headers.get("cache-control"), "no-store");
});
test("guest ownership is generated and only capability digests are stored", async () => {
  const a = await guest(),
    b = await guest();
  assert.notEqual(a.owner, b.owner);
  assert.notEqual(a.hash, a.cookie);
});
test("missing capability denies before protected storage reads", async () => {
  const r = await mf.dispatchFetch(
    origin + "/api/attempts/00000000-0000-0000-0000-000000000000/confirmation",
  );
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "access_denied" });
});
test("expired future-issued and revoked capabilities deny", async () => {
  for (const patch of [
    "expires_ms=issued_ms+1",
    "issued_ms=expires_ms-1",
    "revoked_ms=1",
  ]) {
    const a = await guest();
    await db
      .prepare(`UPDATE guest_access SET ${patch} WHERE capability_hash=?`)
      .bind(a.hash)
      .run();
    const r = await read({ ...a, id: crypto.randomUUID() });
    assert.equal(r.status, 401);
  }
});
test("foreign attempts and missing attempts are indistinguishable", async () => {
  const a = await prepared(),
    b = await guest();
  const r = await read({ ...a, cookie: b.cookie }),
    m = await read({ ...b, id: crypto.randomUUID() });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), await m.json());
});
test("revocation persists across worker restart", async () => {
  const a = await prepared();
  assert.equal(
    (
      await mf.dispatchFetch(origin + "/api/access", {
        method: "DELETE",
        headers: { origin, cookie: a.cookie },
      })
    ).status,
    200,
  );
  await mf.dispose();
  await start();
  assert.equal((await read(a)).status, 401);
});
test("cross-origin mutation insecure transport and payloads are rejected", async () => {
  assert.equal(
    (await mf.dispatchFetch(origin + "/api/access", { method: "POST" })).status,
    403,
  );
  assert.equal(
    (await mf.dispatchFetch("http://soccerbot.test/api/health")).status,
    400,
  );
  assert.equal(
    (
      await mf.dispatchFetch(origin + "/api/access", {
        method: "POST",
        headers: { origin },
        body: '{"role":"admin"}',
      })
    ).status,
    413,
  );
});
test("browser payment hints and arbitrary provider methods confer no authority", async () => {
  const a = await prepared();
  assert.equal((await read(a, "?paid=true")).status, 400);
  assert.equal(
    (await mf.dispatchFetch(origin + "/api/provider/book")).status,
    404,
  );
  assert.equal(
    (
      await mf.dispatchFetch(origin + "/api/attempts", {
        method: "POST",
        headers: { origin, cookie: a.cookie },
      })
    ).status,
    503,
  );
});
test("duplicate idempotency keys return one attempt under interleaving", async () => {
  const g = await guest(),
    body = {
      owner: g.owner,
      key: crypto.randomUUID(),
      intent: intent(),
      now: Date.now(),
    };
  const rows = await Promise.all(
    Array.from({ length: 5 }, () => result("/test/prepare", body)),
  );
  assert.equal(new Set(rows.map((r) => r.id)).size, 1);
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) n FROM attempts WHERE owner_id=?")
        .bind(g.owner)
        .first()
    ).n,
    1,
  );
});
test("changed intent conflicts and immutable intent rejects SQL changes", async () => {
  const g = await guest(),
    body = {
      owner: g.owner,
      key: crypto.randomUUID(),
      intent: intent(),
      now: Date.now(),
    };
  const a = await result("/test/prepare", body);
  body.intent.sessions[0].players = 3;
  assert.equal((await call("/test/prepare", body)).status, 409);
  await assert.rejects(
    db
      .prepare("UPDATE attempts SET intent_json='{}' WHERE id=?")
      .bind(a.id)
      .run(),
  );
});
test("overlapping and elapsed multi-session intents are refused", async () => {
  const a = intent();
  a.sessions.push({ ...a.sessions[0] });
  a.totalMinor *= 2;
  assert.equal(
    (
      await call("/test/prepare", {
        owner: "owner",
        key: crypto.randomUUID(),
        intent: a,
        now: Date.now(),
      })
    ).status,
    409,
  );
  a.sessions.pop();
  a.totalMinor /= 2;
  a.sessions[0].startMs = 1;
  assert.equal(
    (
      await call("/test/prepare", {
        owner: "owner",
        key: crypto.randomUUID(),
        intent: a,
        now: Date.now(),
      })
    ).status,
    409,
  );
});
test("dispatch is durable before effects and cannot be blindly replayed after restart", async () => {
  const a = await prepared();
  await result("/test/claim", { id: a.id, fence: 0, now: Date.now() });
  assert.equal(
    (
      await db
        .prepare("SELECT outcome FROM dispatches WHERE attempt_id=?")
        .bind(a.id)
        .first()
    ).outcome,
    "unknown",
  );
  await mf.dispose();
  await start();
  assert.equal(
    (await call("/test/claim", { id: a.id, fence: 0, now: Date.now() })).status,
    409,
  );
  assert.equal(await result("/test/recovery", { id: a.id, fence: 1 }), true);
  assert.equal(
    (await call("/test/claim", { id: a.id, fence: 2, now: Date.now() })).status,
    409,
  );
});
test("fenced stale completions cannot overwrite newer observations", async () => {
  const a = await associated(),
    o = await observation(a);
  await result("/test/observe", {
    id: a.id,
    fence: 2,
    observation: o,
    now: Date.now(),
  });
  assert.equal(
    (
      await call("/test/observe", {
        id: a.id,
        fence: 2,
        observation: {},
        now: Date.now() + 1,
      })
    ).status,
    409,
  );
});
test("only a complete exact paid and valid booking association confirms", async () => {
  const a = await associated();
  await result("/test/observe", {
    id: a.id,
    fence: 2,
    observation: await observation(a),
    now: Date.now(),
  });
  const r = await read(a);
  assert.deepEqual(await r.json(), { status: "confirmed", reason: "verified" });
});
test("paid but cancelled booking requires recovery and never confirms", async () => {
  const a = await associated(),
    o = await observation(a);
  o.bookings[0].status = "cancelled";
  await result("/test/observe", {
    id: a.id,
    fence: 2,
    observation: o,
    now: Date.now(),
  });
  assert.deepEqual(await (await read(a)).json(), {
    status: "unresolved",
    reason: "paid_booking_invalid",
  });
});
test("tampered observations cannot replace the immutable approved price", async () => {
  const a = await associated(),
    o = await observation(a);
  o.invoice.money.totalMinor = 1;
  await result("/test/observe", {
    id: a.id,
    fence: 2,
    observation: o,
    now: Date.now(),
  });
  assert.notEqual((await (await read(a)).json()).status, "confirmed");
});
test("stale observations and absent invoice stay unresolved or pending", async () => {
  const a = await associated(120000),
    o = await observation(a);
  o.bookings[0].observedAtMs -= 60000;
  o.invoice.observedAtMs -= 60000;
  await result("/test/observe", {
    id: a.id,
    fence: 2,
    observation: o,
    now: Date.now(),
  });
  assert.equal((await (await read(a)).json()).reason, "stale_observation");
  const b = await prepared();
  assert.equal((await (await read(b)).json()).status, "pending");
});
test("observation storage failure cannot produce success", async () => {
  const a = await associated();
  await db.exec(
    "CREATE TRIGGER fail_observation BEFORE UPDATE OF observation_json ON attempts BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
  );
  try {
    assert.equal(
      (
        await call("/test/observe", {
          id: a.id,
          fence: 2,
          observation: await observation(a),
          now: Date.now(),
        })
      ).status,
      409,
    );
    assert.equal((await (await read(a)).json()).status, "pending");
  } finally {
    await db.exec("DROP TRIGGER fail_observation;");
  }
});
test("coordinator persists in-flight concurrency reservations across restart", async () => {
  const coordinator = "restart";
  assert.equal((await result("/test/admit", { coordinator })).allowed, true);
  assert.equal((await result("/test/admit", { coordinator })).allowed, true);
  await mf.dispose();
  await start();
  assert.equal(
    (await result("/test/admit", { coordinator })).reason,
    "concurrency",
  );
});
test("coordinator enforces four starts per rolling second and cooldown", async () => {
  const coordinator = "rate";
  for (let i = 0; i < 4; i++) {
    const a = await result("/test/admit", { coordinator });
    assert.equal(a.allowed, true);
    await result("/test/finish", { coordinator, id: a.id, cooldown: 0 });
  }
  assert.equal((await result("/test/admit", { coordinator })).reason, "rate");
  const b = await result("/test/admit", { coordinator: "cooldown" });
  await result("/test/finish", {
    coordinator: "cooldown",
    id: b.id,
    cooldown: 60000,
  });
  assert.equal(
    (await result("/test/admit", { coordinator: "cooldown" })).reason,
    "cooldown",
  );
});
test("migration constraints and existing journal survive additive migration", async () => {
  const a = await prepared();
  await db.exec("CREATE TABLE additive_fixture (id TEXT PRIMARY KEY);");
  assert.equal(
    (await db.prepare("SELECT id FROM attempts WHERE id=?").bind(a.id).first())
      .id,
    a.id,
  );
  await assert.rejects(
    db.exec("INSERT INTO guest_access VALUES ('bad','bad',2,1,NULL);"),
  );
});

test("checking deadline never invents cancellation", async () => {
  const a = await prepared(undefined, 700000);
  assert.deepEqual(await (await read(a)).json(), {
    status: "unresolved",
    reason: "verification_window_elapsed",
    pollAfterMs: 5000,
  });
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM attempts WHERE id=?")
        .bind(a.id)
        .first()
    ).state,
    "prepared",
  );
});
test("revoked access denies even if protected attempt storage is unavailable", async () => {
  const a = await prepared();
  await db
    .prepare("UPDATE guest_access SET revoked_ms=1 WHERE capability_hash=?")
    .bind(a.hash)
    .run();
  await db.exec(
    "ALTER TABLE attempts RENAME TO temporarily_unavailable_attempts;",
  );
  try {
    assert.equal((await read(a)).status, 401);
  } finally {
    await db.exec(
      "ALTER TABLE temporarily_unavailable_attempts RENAME TO attempts;",
    );
  }
});

test("persistent budget reserves sixteen calls for recovery and caps at eighty", async () => {
  const coordinator = "budget";
  const storage = await mf.unsafeGetDurableObjectStorage(
    "soccerbot-test",
    "SoccerBotAccountCoordinator",
    { name: coordinator },
  );
  await storage.exec(
    "INSERT INTO budget(campaign,used) VALUES(?,63)",
    config.vars.CAMPAIGN_ID,
  );
  const a = await result("/test/admit", { coordinator });
  assert.equal(a.used, 64);
  await result("/test/finish", { coordinator, id: a.id, cooldown: 0 });
  assert.equal(
    (await result("/test/admit", { coordinator })).reason,
    "budget_exhausted",
  );
  assert.equal(
    (await result("/test/admit", { coordinator, recovery: true })).used,
    65,
  );
  await storage.exec(
    "UPDATE budget SET used=80 WHERE campaign=?",
    config.vars.CAMPAIGN_ID,
  );
  await mf.dispose();
  await start();
  assert.equal(
    (await result("/test/admit", { coordinator, recovery: true })).reason,
    "budget_exhausted",
  );
});
test("shared refresh and token generation claims reject stale completion", async () => {
  const body = { key: "token:public", generation: 1, coordinator: "refresh" };
  const a = await result("/test/refresh", body);
  assert.equal(a.granted, true);
  assert.equal((await result("/test/refresh", body)).reason, "shared_refresh");
  await mf.dispose();
  await start();
  assert.equal((await result("/test/refresh", body)).reason, "shared_refresh");
  const b = await result("/test/refresh", { ...body, generation: 2 });
  assert.equal(b.granted, true);
  assert.equal(
    await result("/test/complete-refresh", { ...body, claim: a.claim }),
    false,
  );
  assert.equal(
    await result("/test/complete-refresh", {
      ...body,
      generation: 2,
      claim: b.claim,
    }),
    true,
  );
  assert.equal(
    (await result("/test/refresh", body)).reason,
    "stale_generation",
  );
});

async function multiAttempt() {
  const g = await guest(),
    approved = intent();
  approved.sessions.push({
    ...approved.sessions[0],
    startMs: approved.sessions[0].startMs + 50 * 60000,
    players: 4,
  });
  approved.totalMinor *= 2;
  const a = await result("/test/prepare", {
    owner: g.owner,
    key: crypto.randomUUID(),
    intent: approved,
    now: Date.now(),
  });
  return { ...g, id: a.id };
}
async function orchestrate(a, scenario) {
  const r = await mf.dispatchFetch(origin + "/test/orchestrate", {
    method: "POST",
    headers: { cookie: a.cookie },
    body: JSON.stringify({ id: a.id, owner: a.owner, scenario }),
  });
  assert.equal(r.status, 200);
  return (await r.json()).result;
}
async function effects(a) {
  return (
    await db
      .prepare(
        "SELECT step,outcome,reference_id FROM session_effects WHERE attempt_id=? ORDER BY step",
      )
      .bind(a.id)
      .all()
  ).results;
}
test("orchestration withholds all writes when native contracts or recovery capacity are unavailable", async () => {
  for (const scenario of ["unsupported", "budget"]) {
    const a = await multiAttempt(),
      r = await orchestrate(a, scenario);
    assert.equal(r.result.paymentAvailable, false);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(await effects(a), []);
  }
});
test("orchestration associates every session and invoice once without enabling payment", async () => {
  const a = await multiAttempt(),
    r = await orchestrate(a, "complete");
  assert.deepEqual(r.result, { state: "associated", paymentAvailable: false });
  assert.deepEqual(r.calls, [
    "validate:0",
    "create:0",
    "validate:1",
    "create:1",
    "finalize",
  ]);
  const rows = await effects(a);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((x) => x.outcome === "observed"));
  assert.equal(
    (
      await db
        .prepare("SELECT outcome FROM dispatches WHERE attempt_id=?")
        .bind(a.id)
        .first()
    ).outcome,
    "observed",
  );
  const repeated = await orchestrate(a, "complete");
  assert.deepEqual(repeated.result, r.result);
  assert.deepEqual(repeated.calls, []);
});
test("orchestration retains partial accepted and unknown sessions without replacement or finalization", async () => {
  const a = await multiAttempt(),
    r = await orchestrate(a, "partial");
  assert.deepEqual(r.result, {
    state: "recovery_required",
    paymentAvailable: false,
  });
  assert.ok(!r.calls.includes("finalize"));
  assert.deepEqual(await effects(a), [
    {
      step: "session:0",
      outcome: "observed",
      reference_id: "synthetic-booking-0",
    },
    { step: "session:1", outcome: "unknown", reference_id: null },
  ]);
  assert.deepEqual((await orchestrate(a, "complete")).calls, []);
});
test("orchestration rechecks exact price and revoked access before each session write", async () => {
  for (const scenario of ["price", "revoke"]) {
    const a = await multiAttempt(),
      r = await orchestrate(a, scenario);
    assert.equal(r.result.state, "recovery_required");
    assert.deepEqual(r.calls, ["validate:0", "create:0", "validate:1"]);
    assert.equal((await effects(a)).length, 1);
  }
});
test("orchestration stale generation cannot dispatch a subsequent session", async () => {
  const a = await multiAttempt(),
    r = await orchestrate(a, "fence");
  assert.equal(r.result.state, "recovery_required");
  assert.deepEqual(r.calls, ["validate:0", "create:0", "validate:1"]);
  assert.equal((await effects(a)).length, 1);
});
test("orchestration rejects duplicate booking references and incomplete invoice associations", async () => {
  for (const scenario of ["duplicate", "incomplete"]) {
    const a = await multiAttempt(),
      r = await orchestrate(a, scenario);
    assert.equal(r.result.state, "recovery_required");
    assert.equal(r.result.paymentAvailable, false);
    const row = await db
      .prepare("SELECT association_json FROM attempts WHERE id=?")
      .bind(a.id)
      .first();
    assert.equal(row.association_json, null);
  }
});
test("orchestration unknown finalization survives restart and is never replayed", async () => {
  const a = await multiAttempt(),
    r = await orchestrate(a, "finalize-unknown");
  assert.equal(r.result.state, "recovery_required");
  assert.equal(
    (await effects(a)).find((x) => x.step === "finalize").outcome,
    "unknown",
  );
  await mf.dispose();
  await start();
  assert.deepEqual((await orchestrate(a, "complete")).calls, []);
  assert.equal((await effects(a)).length, 3);
});
test("concurrent orchestration requests have one durable winner and no duplicate effects", async () => {
  const a = await multiAttempt();
  const results = await Promise.all([
    orchestrate(a, "complete"),
    orchestrate(a, "complete"),
  ]);
  // A follower may observe the completed result. Count effects, not responses.
  assert.ok(results.some((x) => x.result.state === "associated"));
  assert.equal(results.filter((x) => x.calls.includes("finalize")).length, 1);
  assert.equal(
    results.flatMap((x) => x.calls).filter((x) => x.startsWith("create:"))
      .length,
    2,
  );
  assert.equal((await effects(a)).length, 3);
});

test("confirmation checking is atomically bounded across concurrent tabs and retains its deadline", async () => {
  const a = await prepared();
  const before = await db
    .prepare("SELECT deadline_ms FROM attempts WHERE id=?")
    .bind(a.id)
    .first();
  const replies = await Promise.all([read(a), read(a), read(a)]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 429, 429]);
  for (const reply of replies) {
    assert.equal(reply.headers.get("cache-control"), "no-store");
    assert.equal(
      Number(reply.headers.get("x-checking-deadline")),
      before.deadline_ms,
    );
    assert.equal(reply.headers.get("x-checks-remaining"), "119");
  }
  const row = await db
    .prepare("SELECT confirmation_checks,deadline_ms FROM attempts WHERE id=?")
    .bind(a.id)
    .first();
  assert.equal(row.confirmation_checks, 1);
  assert.equal(row.deadline_ms, before.deadline_ms);
});
test("checkout context requires ownership and exposes no unproved live checkout link", async () => {
  const a = await prepared(),
    other = await guest();
  const route = origin + `/api/attempts/${a.id}/checkout`;
  assert.equal((await mf.dispatchFetch(route)).status, 401);
  assert.equal(
    (await mf.dispatchFetch(route, { headers: { cookie: other.cookie } }))
      .status,
    404,
  );
  const response = await mf.dispatchFetch(route, {
    headers: { cookie: a.cookie },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.attemptId, a.id);
  assert.equal(body.mode, "live");
  assert.deepEqual(body.checkout, { state: "unavailable" });
  assert.equal(body.summary.totalMinor, 8800);
  assert.equal(JSON.stringify(body).includes("customerId"), false);
});
test("expired or foreign access cannot consume another attempt checking allowance", async () => {
  const a = await prepared(),
    other = await guest();
  assert.equal((await read({ ...a, cookie: other.cookie })).status, 404);
  await db
    .prepare("UPDATE guest_access SET expires_ms=? WHERE owner_id=?")
    .bind(Date.now() - 1, a.owner)
    .run();
  assert.equal((await read(a)).status, 401);
  assert.equal(
    (
      await db
        .prepare("SELECT confirmation_checks FROM attempts WHERE id=?")
        .bind(a.id)
        .first()
    ).confirmation_checks,
    0,
  );
});
test("checking exhaustion survives runtime restart and cannot extend the immutable attempt deadline", async () => {
  const a = await prepared();
  await db
    .prepare("UPDATE attempts SET confirmation_checks=120 WHERE id=?")
    .bind(a.id)
    .run();
  await mf.dispose();
  await start();
  const r = await read(a);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("x-checks-remaining"), "0");
  assert.deepEqual(await r.json(), { error: "checking_limit_reached" });
});
test("elapsed checking deadline returns unresolved without modifying recovery or dispatch state", async () => {
  const a = await prepared(undefined, 700000);
  const before = await db
    .prepare("SELECT * FROM attempts WHERE id=?")
    .bind(a.id)
    .first();
  const r = await read(a);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "unresolved");
  const after = await db
    .prepare("SELECT * FROM attempts WHERE id=?")
    .bind(a.id)
    .first();
  assert.deepEqual(after, before);
});
