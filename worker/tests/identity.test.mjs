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
