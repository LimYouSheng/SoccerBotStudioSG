import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import ts from "typescript";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { seedFoundation } from "./foundation-fixture.mjs";
const config = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync("wrangler.jsonc", "utf8"),
).config;
const origin = "https://soccerbot.test",
  claimant = "synthetic-recovery-owner";
let mf, db, script, persistence, now, outbound;
const migrations = readdirSync("migrations").sort();
async function migrate(name) {
  await db.exec(
    readFileSync(`migrations/${name}`, "utf8")
      .replace(/^--.*$/gm, "")
      .replace(/\n/g, " "),
  );
}
async function start() {
  mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "soccerbot-recovery-test",
      modules: true,
      script,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      cf: false,
      bindings: { ...config.vars, APP_ORIGIN: origin },
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
      serviceBindings: { ASSETS: () => new Response("synthetic-static-asset") },
    }),
    unsafeInspectDurableObjects: true,
    resourcePersistencePath: persistence,
    isolatedResourcePersistencePath: persistence,
  });
  await mf.ready;
  db = await mf.getD1Database("STATE");
}
async function call(route, input = {}, cookie) {
  return mf.dispatchFetch(origin + "/test/" + route, {
    method: "POST",
    body: JSON.stringify(input),
    headers: cookie ? { cookie } : {},
  });
}
async function result(route, input = {}, cookie) {
  const response = await call(route, input, cookie);
  assert.equal(response.status, 200, route);
  return (await response.json()).result;
}
async function prepared() {
  const response = await mf.dispatchFetch(origin + "/api/access", {
    method: "POST",
    headers: { origin },
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const hash = createHash("sha256").update(cookie.split("=")[1]).digest("hex");
  const access = await db
    .prepare("SELECT * FROM guest_access WHERE capability_hash=?")
    .bind(hash)
    .first();
  const intent = {
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
        startMs: now + 86400000,
        players: 2,
        totalMinor: 8800,
        taxMinor: 0,
      },
    ],
  };
  const key = crypto.randomUUID();
  const a = await result("prepare", {
    owner: access.owner_id,
    key,
    intent,
    now,
  });
  return { ...a, owner: access.owner_id, cookie, hash, intent, key };
}
async function dispatched() {
  const a = await prepared();
  await result("claim", { id: a.id, fence: 0, now });
  return a;
}
async function claim(a, at = now + 60000, who = claimant) {
  return result("recovery-claim", { id: a.id, owner: who, now: at });
}
async function complete(c, completion, at = now + 60001) {
  return result("recovery-complete", { recoveryClaim: c, completion, now: at });
}
async function row(a) {
  return db
    .prepare("SELECT * FROM recovery_work WHERE attempt_id=?")
    .bind(a.id)
    .first();
}
async function run(
  at = now + 60000,
  completion = { kind: "retry" },
  scenario = "synthetic",
  limit = 10,
  attemptId,
) {
  return result("recovery-run", {
    now: at,
    owner: claimant,
    limit,
    completion,
    scenario,
    attemptId,
  });
}
function observation(a, at, status = "paid") {
  const s = a.intent.sessions[0],
    money = { currency: "SGD", totalMinor: 8800, taxMinor: 0 };
  const scope = {
    accountId: "synthetic-account",
    environmentId: "developer",
    attemptId: a.id,
    customerId: "synthetic-customer",
    observedAtMs: at,
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
      status,
      paymentReceived: status === "paid",
    },
  };
}
async function associate(a) {
  await result("associate", {
    id: a.id,
    fence: 1,
    references: { invoiceId: "invoice-1", bookingIds: ["booking-1"] },
  });
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
});
beforeEach(async () => {
  persistence = mkdtempSync(path.join(tmpdir(), "soccerbot-recovery-"));
  now = Date.now();
  outbound = 0;
  await start();
  for (const name of migrations.filter(
    (n) => !n.startsWith("0005") && !n.startsWith("0006"),
  ))
    await migrate(name);
  await seedFoundation(mf, db);
  await migrate("0006_recovery_work.sql");
});
afterEach(async () => {
  await mf?.dispose();
  rmSync(persistence, { recursive: true, force: true });
  assert.equal(
    outbound,
    0,
    "no recovery fixture may dispatch provider traffic",
  );
});
test("recovery scheduling is atomic with dispatch and duplicate logical intent stays unique", async () => {
  const a = await prepared();
  const duplicate = await result("prepare", {
    owner: a.owner,
    key: a.key,
    intent: a.intent,
    now,
  });
  assert.equal(duplicate.id, a.id);
  assert.equal(await row(a), null);
  await result("claim", { id: a.id, fence: 0, now });
  assert.equal((await row(a)).ready_ms, now + 60000);
  assert.equal((await call("claim", { id: a.id, fence: 0, now })).status, 409);
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM recovery_work").first()).n,
    1,
  );
});
test("concurrent recovery workers acquire one claim and advance the original attempt fence", async () => {
  const a = await dispatched();
  const claims = await Promise.all([
    claim(a),
    claim(a, now + 60000, "other-recovery-owner"),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const current = claims.find(Boolean);
  assert.equal(current.generation, 1);
  assert.equal(current.attempt_version, 2);
  assert.equal(
    (
      await call("associate", {
        id: a.id,
        fence: 1,
        references: { invoiceId: "i", bookingIds: ["b"] },
      })
    ).status,
    409,
  );
});
test("expired recovery claims reject late completion before and after fenced reclaim", async () => {
  const a = await dispatched(),
    old = await claim(a);
  assert.equal(await claim(a, old.ready_ms - 1), null);
  assert.equal(
    (
      await call("recovery-complete", {
        recoveryClaim: old,
        completion: { kind: "retry" },
        now: old.ready_ms,
      })
    ).status,
    409,
  );
  const fresh = await claim(a, old.ready_ms, "other-recovery-owner");
  assert.equal(fresh.generation, 2);
  assert.equal(
    (
      await call("recovery-complete", {
        recoveryClaim: old,
        completion: { kind: "unsupported" },
        now: old.ready_ms,
      })
    ).status,
    409,
  );
  await complete(fresh, { kind: "unsupported" }, old.ready_ms + 1);
  assert.equal((await row(a)).state, "manual_review");
});
test("restart preserves unknown effects and recovery identity without replaying dispatch", async () => {
  const a = await dispatched();
  await db
    .prepare("INSERT INTO session_effects VALUES(?,'session:0','unknown',NULL)")
    .bind(a.id)
    .run();
  const old = await claim(a);
  await mf.dispose();
  await start();
  const fresh = await claim(a, old.ready_ms);
  assert.equal(fresh.generation, old.generation + 1);
  assert.equal(
    (
      await call("claim", {
        id: a.id,
        fence: fresh.attempt_version,
        now: old.ready_ms,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT outcome FROM session_effects WHERE attempt_id=?")
        .bind(a.id)
        .first()
    ).outcome,
    "unknown",
  );
});
test("bounded recovery selection excludes future work and terminal classifications", async () => {
  const a = await dispatched(),
    b = await dispatched(),
    c = await dispatched();
  assert.equal((await run(now + 59999)).outcomes.length, 0);
  assert.equal(
    (await run(now + 60000, { kind: "unsupported" }, "unsupported", 2)).outcomes
      .length,
    2,
  );
  assert.equal(
    (await run(now + 60000, { kind: "unsupported" }, "unsupported", 2)).outcomes
      .length,
    1,
  );
  assert.equal((await run()).outcomes.length, 0);
  for (const x of [a, b, c])
    assert.equal((await row(x)).state, "manual_review");
  assert.equal(
    (await call("recovery-run", { now, owner: claimant, limit: 11 })).status,
    409,
  );
});
test("read deferral is bounded across restart and cannot be reset by a forged claim counter", async () => {
  const a = await dispatched();
  let at = now + 60000;
  for (let n = 1; n <= 5; n++) {
    const c = await claim(a, at);
    assert.equal(c.tries, n);
    const answer = await complete(
      { ...c, tries: 0 },
      { kind: "retry" },
      at + 1,
    );
    assert.equal(answer.state, n < 5 ? "due" : "manual_review");
    const saved = await row(a);
    if (n < 5) {
      assert.equal(saved.ready_ms, at + 1 + 5000 * 2 ** (n - 1));
      at = saved.ready_ms;
    }
  }
  assert.equal((await row(a)).reason, "read_budget_exhausted");
  assert.equal((await run(at + 3600000)).reads, 0);
});
test("repeated process loss reaches manual review without a sixth reconciliation read", async () => {
  const a = await dispatched();
  let at = now + 60000;
  for (let n = 0; n < 5; n++) {
    const c = await claim(a, at);
    at = c.ready_ms;
  }
  const r = await run(at);
  assert.equal(r.reads, 0);
  assert.equal(r.outcomes[0].state, "manual_review");
});
test("expired and revoked customer access denies reads but preserves separately claimed recovery", async () => {
  for (const kind of ["expired", "revoked"]) {
    const a = await dispatched();
    if (kind === "revoked")
      await db
        .prepare("UPDATE guest_access SET revoked_ms=? WHERE capability_hash=?")
        .bind(now, a.hash)
        .run();
    else
      await db
        .prepare(
          "UPDATE guest_access SET issued_ms=?,expires_ms=? WHERE capability_hash=?",
        )
        .bind(now - 10000, now - 1, a.hash)
        .run();
    const response = await mf.dispatchFetch(
      origin + `/api/attempts/${a.id}/confirmation`,
      { headers: { cookie: a.cookie } },
    );
    assert.equal(response.status, 401);
    const c = await claim(a);
    await complete(c, { kind: "unsupported" });
    assert.equal((await row(a)).state, "manual_review");
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) n FROM dispatches WHERE attempt_id=?")
          .bind(a.id)
          .first()
      ).n,
      1,
    );
  }
});
test("original association and canonical confirmation verify recovered evidence before terminal completion", async () => {
  const a = await dispatched();
  await associate(a);
  const c = await claim(a),
    at = now + 60001;
  const done = await complete(
    c,
    { kind: "observation", observation: observation(a, at) },
    at,
  );
  assert.equal(done.state, "complete");
  assert.equal((await run(at + 100000)).outcomes.length, 0);
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM attempts WHERE id=?")
        .bind(a.id)
        .first()
    ).state,
    "observed",
  );
});
test("malformed foreign or unassociated recovery evidence stays unresolved without persisting raw results", async () => {
  for (const kind of ["malformed", "foreign", "unassociated"]) {
    const a = await dispatched();
    if (kind !== "unassociated") await associate(a);
    const c = await claim(a),
      at = now + 60001;
    const obs =
      kind === "malformed"
        ? { secretMarker: "must-not-persist" }
        : observation(a, at);
    if (kind === "foreign") obs.invoice.attemptId = "foreign-attempt";
    assert.equal(
      (await complete(c, { kind: "observation", observation: obs }, at)).state,
      "manual_review",
    );
    assert.equal(
      (
        await db
          .prepare("SELECT observation_json FROM attempts WHERE id=?")
          .bind(a.id)
          .first()
      ).observation_json,
      null,
    );
  }
});
test("checking deadline never converts unknown or unpaid recovery into provider cancellation", async () => {
  const a = await dispatched();
  await associate(a);
  const at = now + 600001,
    c = await claim(a, at);
  assert.equal(
    (
      await complete(
        c,
        { kind: "observation", observation: observation(a, at, "pending") },
        at,
      )
    ).state,
    "manual_review",
  );
  const dispatch = await db
    .prepare("SELECT * FROM dispatches WHERE attempt_id=?")
    .bind(a.id)
    .first();
  assert.equal(dispatch.operation, "booking.create");
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) n FROM session_effects WHERE attempt_id=?")
        .bind(a.id)
        .first()
    ).n,
    0,
  );
});
test("closed live admission never invokes the reader and unsupported reconciliation is explicit", async () => {
  const a = await dispatched();
  const r = await run(now + 60000, { kind: "retry" }, "live");
  assert.equal(r.reads, 0);
  assert.equal((await row(a)).reason, "reconciliation_unsupported");
  const noRoute = await mf.dispatchFetch(origin + "/api/recovery", {
    method: "POST",
    headers: { origin },
  });
  assert.equal(noRoute.status, 404);
});
test("supervised recovery targets only the original attempt and never substitutes other due work", async () => {
  const other = await dispatched();
  const target = await dispatched();
  await associate(target);
  const otherBefore = await row(other);
  const at = now + 60000;
  const completed = await run(
    at,
    { kind: "observation", observation: observation(target, at) },
    "synthetic",
    1,
    target.id,
  );
  assert.equal(completed.reads, 1);
  assert.deepEqual(
    completed.outcomes.map((o) => [o.attemptId, o.state]),
    [[target.id, "complete"]],
  );
  assert.deepEqual(await row(other), otherBefore);
  for (const id of [target.id, crypto.randomUUID()]) {
    const empty = await run(at, undefined, "synthetic", 1, id);
    assert.deepEqual(empty, { outcomes: [], reads: 0 });
  }
  assert.deepEqual(await row(other), otherBefore);
  assert.equal(outbound, 0);
});
test("supervised recovery preserves due time scope validation and closed live admission", async () => {
  const a = await dispatched();
  const original = await row(a);
  assert.deepEqual(await run(now, undefined, "synthetic", 1, a.id), {
    outcomes: [],
    reads: 0,
  });
  for (const [id, limit] of [
    ["", 1],
    ["not-an-attempt", 1],
    [a.id, 2],
  ]) {
    assert.notEqual(
      (
        await call("recovery-run", {
          now: now + 60000,
          owner: claimant,
          limit,
          attemptId: id,
        })
      ).status,
      200,
    );
    assert.deepEqual(await row(a), original);
  }
  const closed = await run(now + 60000, undefined, "live", 1, a.id);
  assert.equal(closed.reads, 0);
  assert.equal(closed.outcomes[0].state, "manual_review");
  assert.equal((await row(a)).reason, "reconciliation_unsupported");
  assert.equal(outbound, 0);
});
test("synthetic transport failure defers only a read while malformed replies become manual review", async () => {
  const a = await dispatched();
  assert.equal((await run(now + 60000, undefined, "throw")).reads, 1);
  assert.equal((await row(a)).state, "due");
  const due = (await row(a)).ready_ms;
  await run(due, { kind: "invented", details: "private" });
  assert.equal((await row(a)).state, "manual_review");
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM dispatches").first()).n,
    1,
  );
});
test("storage failure rolls back claim and completion without losing eligible recovery", async () => {
  const a = await dispatched();
  await db.exec(
    "CREATE TRIGGER fail_attempt BEFORE UPDATE ON attempts BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END;",
  );
  assert.equal(
    (
      await call("recovery-claim", {
        id: a.id,
        owner: claimant,
        now: now + 60000,
      })
    ).status,
    409,
  );
  assert.equal((await row(a)).generation, 0);
  await db.exec("DROP TRIGGER fail_attempt;");
  const c = await claim(a);
  await db.exec(
    "CREATE TRIGGER fail_attempt BEFORE UPDATE ON attempts BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END;",
  );
  assert.equal(
    (
      await call("recovery-complete", {
        recoveryClaim: c,
        completion: { kind: "unsupported" },
        now: now + 60001,
      })
    ).status,
    409,
  );
  assert.equal((await row(a)).state, "claimed");
  await db.exec("DROP TRIGGER fail_attempt;");
  await complete(c, { kind: "unsupported" });
});
test("late effect completion after recovery ownership cannot bind references or create another effect", async () => {
  const a = await prepared();
  const r = await result(
    "orchestrate",
    { id: a.id, owner: a.owner, scenario: "late-effect" },
    a.cookie,
  );
  assert.equal(r.result.state, "recovery_required");
  assert.deepEqual(r.calls, ["validate:0", "create:0"]);
  const effects = await db
    .prepare("SELECT * FROM session_effects WHERE attempt_id=?")
    .bind(a.id)
    .all();
  assert.equal(effects.results.length, 1);
  assert.equal(effects.results[0].outcome, "unknown");
  assert.equal(effects.results[0].reference_id, null);
});
test("retention dry run is bounded and preserves access linked to unresolved or completed attempts", async () => {
  const a = await dispatched(),
    orphan = await prepared();
  // Orphan access fixture has never owned an attempt; no existing evidence is deleted.
  await db
    .prepare(
      "INSERT INTO guest_access VALUES('synthetic-orphan','orphan-owner',?,?,NULL)",
    )
    .bind(now - 10000, now - 1)
    .run();
  await db
    .prepare(
      "UPDATE guest_access SET issued_ms=?,expires_ms=? WHERE capability_hash IN (?,?)",
    )
    .bind(now - 10000, now - 1, a.hash, orphan.hash)
    .run();
  const preview = await result("retention", { now, beforeMs: now, limit: 1 });
  assert.equal(preview.cleanupEnabled, false);
  assert.deepEqual(
    preview.expiredOrphanAccess.map((x) => x.owner_id),
    ["orphan-owner"],
  );
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM attempts").first()).n,
    2,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM guest_access").first()).n,
    3,
  );
});
test("populated migration preserves immutable intent unknown effects completed proofs and coordinator accounting", async () => {
  // Isolated fixture reconstructs the real pre-0006 schema, never a remote downgrade.
  await mf.dispose();
  rmSync(persistence, { recursive: true, force: true });
  await start();
  for (const name of migrations.filter((n) => Number(n.slice(0, 4)) < 5))
    await migrate(name);
  await seedFoundation(mf, db);
  const a = await dispatched();
  await db
    .prepare("INSERT INTO session_effects VALUES(?,'session:0','unknown',NULL)")
    .bind(a.id)
    .run();
  await db
    .prepare(
      "INSERT INTO developer_operations VALUES('proof','provider_identity',?,'complete','{\"accepted\":true}')",
    )
    .bind(now)
    .run();
  const storage = await mf.unsafeGetDurableObjectStorage(
    "soccerbot-recovery-test",
    "SoccerBotAccountCoordinator",
    { name: "synthetic-account" },
  );
  await storage.exec(
    "INSERT INTO budget(campaign,used) VALUES(?,8)",
    config.vars.CAMPAIGN_ID,
  );
  const completed = await dispatched();
  await associate(completed);
  await result("observe", {
    id: completed.id,
    fence: 2,
    now: now + 60000,
    observation: observation(completed, now + 60000),
  });
  await db
    .prepare(
      "INSERT INTO session_effects VALUES(?,'session:0','observed','booking-1')",
    )
    .bind(completed.id)
    .run();
  await db
    .prepare("UPDATE guest_access SET revoked_ms=? WHERE capability_hash=?")
    .bind(now, completed.hash)
    .run();
  await storage.exec(
    "INSERT INTO admissions VALUES('unknown-reservation',?,?,0)",
    config.vars.CAMPAIGN_ID,
    now,
  );
  const tables = [
    "guest_access",
    "attempts",
    "dispatches",
    "session_effects",
    "developer_operations",
    "foundation_identity",
  ];
  const snapshot = await Promise.all(
    tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all()),
  );
  await migrate("0006_recovery_work.sql");
  assert.deepEqual(
    await Promise.all(
      tables.map((t) =>
        db
          .prepare(`SELECT * FROM ${t}`)
          .all()
          .then((r) => r.results),
      ),
    ),
    snapshot.map((r) => r.results),
  );
  const recoveryBefore = (await db.prepare("SELECT * FROM recovery_work").all())
    .results;
  await migrate("0007_confirmation_checking.sql");
  const afterChecking = await Promise.all(
    tables.map((t) =>
      db
        .prepare(`SELECT * FROM ${t}`)
        .all()
        .then((r) => r.results),
    ),
  );
  for (const record of afterChecking[tables.indexOf("attempts")]) {
    assert.equal(record.confirmation_next_ms, 0);
    assert.equal(record.confirmation_checks, 0);
    delete record.confirmation_next_ms;
    delete record.confirmation_checks;
  }
  assert.deepEqual(
    afterChecking,
    snapshot.map((r) => r.results),
  );
  assert.deepEqual(
    (await db.prepare("SELECT * FROM recovery_work").all()).results,
    recoveryBefore,
  );
  assert.equal((await row(a)).state, "due");
  assert.equal(
    (
      await storage.exec(
        "SELECT used FROM budget WHERE campaign=?",
        config.vars.CAMPAIGN_ID,
      )
    )[0].used,
    8,
  );
  await mf.dispose();
  await start();
  assert.equal((await row(a)).attempt_id, a.id);
  const restarted = await mf.unsafeGetDurableObjectStorage(
    "soccerbot-recovery-test",
    "SoccerBotAccountCoordinator",
    { name: "synthetic-account" },
  );
  assert.equal(
    (
      await restarted.exec(
        "SELECT used FROM budget WHERE campaign=?",
        config.vars.CAMPAIGN_ID,
      )
    )[0].used,
    8,
  );
  assert.equal(
    (
      await restarted.exec(
        "SELECT finished FROM admissions WHERE id='unknown-reservation'",
      )
    )[0].finished,
    0,
  );
  assert.equal((await row(completed)).state, "due");
  assert.equal((await call("claim", { id: a.id, fence: 0, now })).status, 409);
});

test("recovery uses the ordered partial index without scanning or sorting terminal work", async () => {
  const plan = await db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT attempt_id FROM recovery_work INDEXED BY recovery_due WHERE state IN ('due','claimed') AND ready_ms<=? ORDER BY ready_ms,attempt_id LIMIT ?",
    )
    .bind(now, 10)
    .all();
  const detail = plan.results.map((r) => r.detail).join("\n");
  assert.match(detail, /SEARCH recovery_work USING INDEX recovery_due/);
  assert.doesNotMatch(detail, /SCAN|TEMP B-TREE/);
});
test("retained terminal observations complete locally and known rejection uses the existing verifier", async () => {
  for (const status of ["paid", "failed"]) {
    const a = await dispatched();
    await associate(a);
    const at = now + 60000;
    await result("observe", {
      id: a.id,
      fence: 2,
      now: at,
      observation: observation(a, at, status),
    });
    const done = await run(at, undefined, "live");
    assert.equal(done.reads, 0);
    assert.equal(done.outcomes[0].state, "complete");
    assert.equal((await row(a)).reason, "verified_terminal");
  }
});
test("recovery cannot replace a newer retained observation with an older provider snapshot", async () => {
  const a = await dispatched();
  await associate(a);
  const at = now + 60000;
  await result("observe", {
    id: a.id,
    fence: 2,
    now: at,
    observation: observation(a, at, "pending"),
  });
  const c = await claim(a, at + 1);
  const answer = await complete(
    c,
    { kind: "observation", observation: observation(a, at - 1) },
    at + 2,
  );
  assert.equal(answer.state, "manual_review");
  assert.equal(
    JSON.parse(
      (
        await db
          .prepare("SELECT observation_json FROM attempts WHERE id=?")
          .bind(a.id)
          .first()
      ).observation_json,
    ).invoice.status,
    "pending",
  );
});

test("invalid retained evidence cannot trap due work in perpetual failed claims", async () => {
  const a = await dispatched();
  await associate(a);
  await result("observe", {
    id: a.id,
    fence: 2,
    now: now + 60000,
    observation: { invoice: "invalid", bookings: [] },
  });
  await db
    .prepare("UPDATE attempts SET observation_json='not-json' WHERE id=?")
    .bind(a.id)
    .run();
  const done = await run(now + 60001, undefined, "live");
  assert.equal(done.reads, 0);
  assert.equal(done.outcomes[0].state, "manual_review");
  assert.equal((await run(now + 120000)).outcomes.length, 0);
});

test("completion resamples trusted time after storage validation and refuses an expired lease", async () => {
  const a = await dispatched(),
    c = await claim(a);
  const response = await call("recovery-complete", {
    recoveryClaim: c,
    completion: { kind: "unsupported" },
    now: now + 60001,
    scenario: "lease-expiry",
  });
  assert.equal(response.status, 409);
  assert.equal((await row(a)).state, "claimed");
  assert.equal((await claim(a, c.ready_ms)).generation, 2);
});
