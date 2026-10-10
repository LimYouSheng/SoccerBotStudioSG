import { test, before, after } from "node:test";
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
const root = mkdtempSync(path.join(tmpdir(), "soccerbot-identity-"));
const origin = "https://soccerbot.test";
let mf,
  db,
  script,
  outbound = 0;
async function start() {
  mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "identity-test",
      modules: true,
      script,
      cf: false,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      bindings: { ...config.vars, APP_ORIGIN: origin },
      d1Databases: { STATE: "synthetic-identity" },
      d1Persist: path.join(root, "d1"),
      durableObjects: {
        COORDINATOR: {
          className: "SoccerBotAccountCoordinator",
          useSQLite: true,
        },
      },
      serviceBindings: { ASSETS: () => new Response("synthetic") },
      outboundService: () => {
        outbound++;
        throw new Error("No external identity requests");
      },
    }),
    resourcePersistencePath: root,
    isolatedResourcePersistencePath: root,
  });
  await mf.ready;
  db = await mf.getD1Database("STATE");
}
before(async () => {
  script = (
    await build({
      entryPoints: ["worker/tests/identity-harness.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["cloudflare:workers", "node:async_hooks"],
    })
  ).outputFiles[0].text;
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
after(async () => {
  await mf?.dispose();
  rmSync(root, { recursive: true, force: true });
  assert.equal(outbound, 0);
});
async function guest() {
  const response = await mf.dispatchFetch(origin + "/api/access", {
    method: "POST",
    headers: { origin },
  });
  assert.equal(response.status, 201);
  return response.headers.get("set-cookie").split(";")[0];
}
async function call(cookie, body) {
  return (
    await mf.dispatchFetch(origin + "/synthetic-identity/test", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify(body),
    })
  ).json();
}
let sequence = 0;
async function challenge(cookie, overrides = {}) {
  sequence++;
  return call(cookie, {
    action: "challenge",
    now: Date.now(),
    email: `synthetic${sequence}@example.invalid`,
    botToken: `synthetic-bot-${sequence}`,
    ...overrides,
  });
}
function verification(response, now = Date.now()) {
  return {
    action: "verify",
    now,
    email: response.sent[0].email,
    code: response.sent[0].code,
    challengeId: response.result.challengeId,
  };
}
test("identity stores no plaintext code and consumes one concurrent redemption without renewing guest expiry", async () => {
  const cookie = await guest(),
    response = await challenge(cookie);
  assert.match(response.sent[0].code, /^\d{6}$/);
  const stored = await db
    .prepare("SELECT * FROM identity_challenges WHERE id=?")
    .bind(response.result.challengeId)
    .first();
  assert.notEqual(stored.code_hash, response.sent[0].code);
  assert.equal(JSON.stringify(stored).includes('"code":'), false);
  const results = await Promise.all([
    call(cookie, verification(response)),
    call(cookie, verification(response)),
  ]);
  assert.equal(
    results.filter((r) => r.result?.email === response.sent[0].email).length,
    1,
  );
  assert.equal(results.filter((r) => r.error).length, 1);
  assert.equal(
    (await call(cookie, verification(response))).error,
    "verification_unavailable",
  );
  const identity = await call(cookie, { action: "read", now: Date.now() });
  assert.equal(identity.result.email, response.sent[0].email);
  assert(identity.result.expiresAt <= stored.expires_ms + 1200000);
});
test("identity rejects wrong expired reused and foreign email or guest codes", async () => {
  const cookie = await guest(),
    other = await guest(),
    response = await challenge(cookie);
  for (const input of [
    { ...verification(response), email: "foreign@example.invalid" },
    { ...verification(response), code: "0000000" },
  ])
    assert.equal((await call(cookie, input)).error, "verification_unavailable");
  assert.equal(
    (await call(other, verification(response))).error,
    "verification_unavailable",
  );
  const wrong = response.sent[0].code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await call(cookie, { ...verification(response), code: wrong })).error,
      "verification_unavailable",
    );
  assert.equal(
    (await call(cookie, verification(response))).error,
    "verification_unavailable",
  );
  const fresh = await guest(),
    expired = await challenge(fresh);
  assert.equal(
    (await call(fresh, verification(expired, expired.result.expiresAt))).error,
    "verification_unavailable",
  );
});
test("identity rejects bot denial expiry purpose mismatch and durable token replay before email", async () => {
  for (const bot of ["denied", "expired", "wrong-action"]) {
    const r = await challenge(await guest(), { bot });
    assert.equal(r.sent.length, 0);
    assert.equal(r.error, "verification_unavailable");
  }
  const cookie = await guest(),
    token = "synthetic-unique-replayed-bot";
  const first = await challenge(cookie, { botToken: token });
  assert.equal(first.sent.length, 1);
  const replay = await challenge(await guest(), { botToken: token });
  assert.equal(replay.sent.length, 0);
  assert.equal(replay.error, "verification_request_limited");
});
test("identity resend supersedes previous challenge and preserves unknown delivery without retry across restart", async () => {
  const cookie = await guest(),
    now = Date.now(),
    first = await challenge(cookie, { now });
  const second = await challenge(cookie, {
    now: now + 61000,
    email: first.sent[0].email,
    delivery: "lost",
  });
  assert.equal(second.sent.length, 1);
  assert.equal(
    (await call(cookie, verification(first, now + 62000))).error,
    "verification_unavailable",
  );
  assert.equal(
    (await call(cookie, verification(second, now + 62000))).error,
    "verification_unavailable",
  );
  await mf.dispose();
  await start();
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM identity_challenges WHERE id=?")
        .bind(second.result.challengeId)
        .first()
    ).state,
    "unknown",
  );
  assert.equal(
    (await call(cookie, verification(second, now + 62000))).error,
    "verification_unavailable",
  );
});
test("identity concurrent sends and subject limits cannot be bypassed by a new guest", async () => {
  const cookie = await guest(),
    email = "rate-limited@example.invalid",
    now = Date.now();
  const concurrent = await Promise.all([
    challenge(cookie, { email, now, source: "rate-source" }),
    challenge(cookie, { email, now, source: "rate-source" }),
  ]);
  assert.equal(
    concurrent.reduce((n, r) => n + r.sent.length, 0),
    1,
  );
  for (const offset of [61000, 122000])
    assert.equal(
      (
        await challenge(await guest(), {
          email,
          now: now + offset,
          source: "rate-source",
        })
      ).sent.length,
      1,
    );
  assert.equal(
    (
      await challenge(await guest(), {
        email,
        now: now + 183000,
        source: "rate-source",
      })
    ).sent.length,
    0,
  );
});
test("identity guest revocation denies verified session and ambiguous contacts never prefill", async () => {
  const cookie = await guest(),
    response = await challenge(cookie, { source: "prefill-source" });
  await call(cookie, verification(response));
  const revoke = await mf.dispatchFetch(origin + "/api/access", {
    method: "DELETE",
    headers: { origin, cookie },
  });
  assert.equal(revoke.status, 200);
  assert.equal(
    (await call(cookie, { action: "read", now: Date.now() })).error,
    "access_denied",
  );
  const candidate = {
    email: "verified@example.invalid",
    name: "Synthetic Guest",
    phone: "00000000",
  };
  for (const matches of [
    [],
    [candidate, candidate],
    [{ ...candidate, email: "foreign@example.invalid" }],
  ])
    assert.equal(
      (
        await call("", {
          action: "profile",
          now: 0,
          email: candidate.email,
          matches,
        })
      ).result,
      null,
    );
  assert.deepEqual(
    (
      await call("", {
        action: "profile",
        now: 0,
        email: candidate.email,
        matches: [candidate],
      })
    ).result,
    { name: candidate.name, phone: candidate.phone },
  );
});

async function guestAt(now) {
  const r = await call("", { action: "guest", now });
  assert.equal(r.error, undefined);
  return r.cookies[0].split(";")[0];
}
async function remembered(now = Date.now(), email) {
  const cookie = await guestAt(now);
  const c = await challenge(cookie, {
    now,
    source: `remember-source-${sequence}`,
    ...(email ? { email } : {}),
  });
  assert.equal(c.error, undefined);
  const v = await call(cookie, { ...verification(c, now), remember: true });
  assert.equal(v.error, undefined);
  return {
    guest: cookie,
    cookie: v.cookies[0].split(";")[0],
    header: v.cookies[0],
    email: v.result.email,
    id: c.result.challengeId,
    now,
  };
}
test("remembered identity requires opt in and persists only digests with fixed cookie expiry", async () => {
  const now = Date.now(),
    cookie = await guestAt(now);
  const c = await challenge(cookie, { now, source: "opt-out" });
  const v = await call(cookie, verification(c, now));
  assert.equal(v.cookies.length, 1);
  assert.match(v.cookies[0], /Max-Age=0/);
  assert.equal(
    await db
      .prepare("SELECT id FROM remembered_identity WHERE id=?")
      .bind(c.result.challengeId)
      .first(),
    null,
  );
  const r = await remembered();
  assert.match(
    r.header,
    /Path=\/; Secure; HttpOnly; SameSite=Strict; Expires=/,
  );
  const stored = await db
    .prepare("SELECT * FROM remembered_identity WHERE id=?")
    .bind(r.id)
    .first();
  assert.equal(stored.expires_ms, r.now + 90 * 86400000);
  assert.equal(JSON.stringify(stored).includes(r.cookie.split("=")[1]), false);
  await assert.rejects(
    db
      .prepare(
        "UPDATE remembered_identity SET expires_ms=expires_ms+1 WHERE id=?",
      )
      .bind(r.id)
      .run(),
    /remembered_expiry_immutable/,
  );
});
test("remembered identity survives restart and restores into a fresh guest without old attempt authority", async () => {
  const r = await remembered();
  const original = await db
    .prepare(
      "SELECT * FROM guest_access WHERE capability_hash=(SELECT origin_access_hash FROM remembered_identity WHERE id=?)",
    )
    .bind(r.id)
    .first();
  await mf.dispose();
  await start();
  const now = r.now + 86400000,
    next = await guestAt(now);
  const restored = await call(`${next}; ${r.cookie}`, {
    action: "restore",
    now,
  });
  assert.equal(restored.result.email, r.email);
  assert.equal(restored.result.expiresAt, now + 1800000);
  const owner = await db
    .prepare(
      "SELECT owner_id FROM verified_identity WHERE email=? ORDER BY expires_ms DESC LIMIT 1",
    )
    .bind(r.email)
    .first();
  assert.notEqual(owner.owner_id, original.owner_id);
  assert.deepEqual(
    await db
      .prepare("SELECT * FROM guest_access WHERE capability_hash=?")
      .bind(original.capability_hash)
      .first(),
    original,
  );
});
test("remembered identity denies at and after absolute day ninety and rotation cannot extend expiry", async () => {
  const r = await remembered(),
    end = r.now + 90 * 86400000;
  const fresh = await guestAt(end - 1);
  const before = await call(`${fresh}; ${r.cookie}`, {
    action: "restore",
    now: end - 1,
  });
  assert.equal(before.result.email, r.email);
  assert.equal(before.result.expiresAt, end);
  const rotated = before.cookies[0].split(";")[0];
  for (const now of [end, end + 1]) {
    const result = await call(`${await guestAt(now)}; ${rotated}`, {
      action: "restore",
      now,
    });
    assert.equal(result.error, "identity_unavailable");
  }
  assert.equal(
    (
      await db
        .prepare("SELECT expires_ms FROM remembered_identity WHERE id=?")
        .bind(r.id)
        .first()
    ).expires_ms,
    end,
  );
});
test("remembered concurrent rotation returns one successor and old-token replay revokes every linked session", async () => {
  const r = await remembered(),
    now = r.now + 60000;
  const a = await guestAt(now),
    b = await guestAt(now);
  const pair = await Promise.all(
    [a, b].map((g) => call(`${g}; ${r.cookie}`, { action: "restore", now })),
  );
  for (const result of pair) assert.equal(result.result.email, r.email);
  assert.equal(pair[0].cookies[0], pair[1].cookies[0]);
  assert.notEqual(pair[0].cookies[0].split(";")[0], r.cookie);
  const recovered = await call(`${await guestAt(now + 29999)}; ${r.cookie}`, {
    action: "restore",
    now: now + 29999,
  });
  assert.equal(recovered.cookies[0], pair[0].cookies[0]);
  const replay = await call(`${await guestAt(now + 30000)}; ${r.cookie}`, {
    action: "restore",
    now: now + 30000,
  });
  assert.equal(replay.error, "identity_unavailable");
  for (const cookie of [r.guest, a, b])
    assert.equal(
      (await call(cookie, { action: "read", now: now + 30000 })).error,
      "access_denied",
    );
});
test("remembered logout fences concurrent restore and a delayed issued cookie cannot revive authority", async () => {
  const r = await remembered(),
    now = r.now + 60000,
    fresh = await guestAt(now);
  const [restored, logout] = await Promise.all([
    call(`${fresh}; ${r.cookie}`, { action: "restore", now }),
    mf.dispatchFetch(origin + "/api/access", {
      method: "DELETE",
      headers: { origin, cookie: r.guest },
    }),
  ]);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /__Host-soccerbot-remember=;/);
  const delayed = restored.cookies?.[0]?.split(";")[0] ?? r.cookie;
  assert.equal(
    (
      await call(`${await guestAt(now)}; ${delayed}`, {
        action: "restore",
        now,
      })
    ).error,
    "identity_unavailable",
  );
  assert.equal(
    (await call(r.guest, { action: "read", now })).error,
    "access_denied",
  );
});
test("remembered all-device signout requires fresh non-restored verification and invalidates older challenges", async () => {
  const r = await remembered(),
    later = r.now + 61000;
  const pendingGuest = await guestAt(later);
  const pending = await challenge(pendingGuest, {
    now: later,
    email: r.email,
    source: "pending-all-devices",
  });
  const other = await guestAt(later);
  assert.equal(
    (await call(`${other}; ${r.cookie}`, { action: "restore", now: later }))
      .result.email,
    r.email,
  );
  assert.equal(
    (await call(other, { action: "all-signout", now: later })).error,
    "fresh_verification_required",
  );
  assert.equal(
    (await call(r.guest, { action: "all-signout", now: later + 1 })).error,
    undefined,
  );
  assert.equal(
    (
      await call(pendingGuest, {
        ...verification(pending, later + 2),
        remember: true,
      })
    ).error,
    "verification_unavailable",
  );
  assert.equal(
    (await call(other, { action: "read", now: later + 2 })).error,
    "access_denied",
  );
  const old = await remembered();
  assert.equal(
    (await call(old.guest, { action: "all-signout", now: old.now + 300000 }))
      .error,
    "fresh_verification_required",
  );
  assert.equal(
    (
      await db
        .prepare("SELECT revoked_ms FROM remembered_identity WHERE id=?")
        .bind(old.id)
        .first()
    ).revoked_ms,
    null,
  );
});
test("remembered malformed duplicate foreign and missing credentials cannot disclose identity", async () => {
  const r = await remembered(),
    now = r.now + 60000;
  assert.equal(
    (await call(await guestAt(now), { action: "restore", now })).result,
    null,
  );
  for (const suffix of [
    "__Host-soccerbot-remember=forged",
    `${r.cookie}; ${r.cookie}`,
    "__Host-soccerbot-remember=" + "a".repeat(64),
  ])
    assert.equal(
      (
        await call(`${await guestAt(now)}; ${suffix}`, {
          action: "restore",
          now,
        })
      ).error,
      "identity_unavailable",
    );
  await db
    .prepare("UPDATE remembered_identity SET account_id='foreign' WHERE id=?")
    .bind(r.id)
    .run();
  assert.equal(
    (
      await call(`${await guestAt(now)}; ${r.cookie}`, {
        action: "restore",
        now,
      })
    ).error,
    "identity_unavailable",
  );
  const response = await mf.dispatchFetch(origin + "/api/identity/restore", {
    method: "POST",
    headers: { origin: "https://foreign.test", cookie: r.guest },
  });
  assert.equal(response.status, 403);
});
test("remembered storage failure rolls back consumption and emits no credential", async () => {
  const now = Date.now(),
    cookie = await guestAt(now),
    c = await challenge(cookie, { now, source: "storage-failure" });
  await db.exec(
    "CREATE TRIGGER synthetic_remember_failure BEFORE INSERT ON remembered_identity BEGIN SELECT RAISE(ABORT,'synthetic_storage_failure'); END;",
  );
  const failed = await call(cookie, {
    ...verification(c, now),
    remember: true,
  });
  assert.equal(failed.result, undefined);
  assert.equal(failed.cookies, undefined);
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM identity_challenges WHERE id=?")
        .bind(c.result.challengeId)
        .first()
    ).state,
    "sent",
  );
  await db.exec("DROP TRIGGER synthetic_remember_failure;");
});

test("remembered opt-out verification clears and revokes an earlier browser family without changing guest ownership", async () => {
  const old = await remembered(),
    now = old.now + 86400000;
  const next = await guestAt(now),
    combined = `${next}; ${old.cookie}`;
  const c = await challenge(combined, { now, source: "switch-account" });
  const v = await call(combined, { ...verification(c, now), remember: false });
  assert.equal(v.result.email, c.sent[0].email);
  assert.match(v.cookies[0], /Max-Age=0/);
  assert.equal(
    (
      await db
        .prepare("SELECT revoked_ms FROM remembered_identity WHERE id=?")
        .bind(old.id)
        .first()
    ).revoked_ms,
    now,
  );
  assert.equal(
    (await call(next, { action: "read", now })).result.email,
    c.sent[0].email,
  );
  assert.equal(
    (
      await call(`${await guestAt(now)}; ${old.cookie}`, {
        action: "restore",
        now,
      })
    ).error,
    "identity_unavailable",
  );
});
test("remembered verification racing signout never establishes reusable authority", async () => {
  const now = Date.now(),
    g = await guestAt(now),
    c = await challenge(g, { now, source: "verify-logout-race" });
  const [v, logout] = await Promise.all([
    call(g, { ...verification(c, now), remember: true }),
    mf.dispatchFetch(origin + "/api/access", {
      method: "DELETE",
      headers: { origin, cookie: g },
    }),
  ]);
  assert.equal(logout.status, 200);
  assert.equal((await call(g, { action: "read", now })).error, "access_denied");
  if (v.cookies?.length)
    assert.equal(
      (
        await call(`${await guestAt(now)}; ${v.cookies[0].split(";")[0]}`, {
          action: "restore",
          now,
        })
      ).error,
      "identity_unavailable",
    );
});
test("remembered signout after the guest expires revokes the persistent credential", async () => {
  const r = await remembered();
  await db
    .prepare(
      "UPDATE guest_access SET expires_ms=issued_ms+1 WHERE capability_hash=(SELECT origin_access_hash FROM remembered_identity WHERE id=?)",
    )
    .bind(r.id)
    .run();
  const response = await mf.dispatchFetch(origin + "/api/access", {
    method: "DELETE",
    headers: { origin, cookie: `${r.guest}; ${r.cookie}` },
  });
  assert.equal(response.status, 200);
  assert.notEqual(
    (
      await db
        .prepare("SELECT revoked_ms FROM remembered_identity WHERE id=?")
        .bind(r.id)
        .first()
    ).revoked_ms,
    null,
  );
});
