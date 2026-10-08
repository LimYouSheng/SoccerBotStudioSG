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
const origin = "https://soccerbot.test";
let script;
const roots = [];
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
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
async function fixture({
  mode = "trusted-reads",
  respond,
  end = Date.now() + 3600000,
  persistence,
  legacy = false,
  secrets = {},
} = {}) {
  const root =
    persistence || mkdtempSync(path.join(tmpdir(), "soccerbot-provider-"));
  if (!persistence) roots.push(root);
  const calls = [];
  const logs = [];
  const mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "provider-test",
      modules: true,
      script,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      cf: false,
      handleStructuredLogs: (entry) => logs.push(entry.message),
      bindings: {
        ...config.vars,
        APP_ORIGIN: origin,
        PROVIDER_ACCESS: mode,
        CAMPAIGN_END_MS: String(end),
        SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-developer",
        SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-operator",
        SIMPLYBOOK_DEV_API_KEY: "synthetic-public-secret",
        SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "synthetic-admin-secret",
        ...secrets,
      },
      d1Databases: { STATE: "synthetic-state" },
      durableObjects: {
        COORDINATOR: {
          className: "SoccerBotAccountCoordinator",
          useSQLite: true,
        },
      },
      serviceBindings: { ASSETS: () => new Response("synthetic") },
      outboundService: async (request) => {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : null;
        calls.push({ url: request.url, method: request.method });
        assert.ok(
          ["user-api.simplybook.me", "user-api-v2.simplybook.me"].includes(
            url.hostname,
          ),
        );
        if (respond) {
          const custom = await respond(request, body, calls);
          if (custom) return custom;
        }
        if (url.pathname === "/login")
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: "synthetic-public-token",
          });
        if (url.pathname === "/admin/auth")
          return Response.json({ token: "synthetic-admin-token" });
        assert.equal(request.headers.get("X-Token"), "synthetic-admin-token");
        assert.equal(
          request.headers.get("X-Company-Login"),
          "synthetic-developer",
        );
        if (url.pathname === "/admin/company/info")
          return Response.json({
            login: "synthetic-developer",
            privateContact: "must-not-escape",
          });
        if (url.pathname === "/admin/tariff/current")
          return Response.json({
            limits: [{ key: "sheduler_limit", total: 50, rest: 26 }],
          });
        if (url.pathname === "/admin/bookings/23")
          return Response.json({
            id: 23,
            code: "synthetic-code",
            is_confirmed: "1",
            is_cancelled: "0",
            invoice_id: 23,
            invoice_status: "paid",
            start_date_time: "2026-10-09 09:00:00",
            end_date_time: "2026-10-09 09:50:00",
            hash: "must-not-escape",
          });
        if (url.pathname === "/admin/invoices/23")
          return Response.json({
            id: 23,
            number: "SI-synthetic",
            status: "paid",
            payment_received: "1",
            currency: "SGD",
            amount: "88.00",
            tax_amount: "0.00",
            lines: [
              {
                booking: { id: 23, code: "synthetic-code" },
                amount: "88",
                tax_amount: 0,
              },
            ],
            client: { email: "must-not-escape" },
          });
        throw new Error("Unapproved provider path");
      },
    }),
    unsafeInspectDurableObjects: true,
    resourcePersistencePath: root,
    isolatedResourcePersistencePath: root,
  });
  await mf.ready;
  const db = await mf.getD1Database("STATE");
  if (!persistence)
    for (const name of [
      "0001_developer_journal.sql",
      "0002_developer_operations.sql",
      ...(!legacy ? ["0004_operator_read_scopes.sql"] : []),
    ])
      await db.exec(
        readFileSync("migrations/" + name, "utf8")
          .replace(/^--.*$/gm, "")
          .replace(/\n/g, " "),
      );
  if (!persistence) await seedFoundation(mf, db);
  const storage = await mf.unsafeGetDurableObjectStorage(
    "provider-test",
    "SoccerBotAccountCoordinator",
    { name: "simplybook-developer-account" },
  );
  const sql = async (query, ...args) => storage.exec(query, ...args);
  const grant = async (
    expires = Date.now() + 60000,
    operation = "provider_identity",
  ) => {
    const token = "a".repeat(32) + crypto.randomUUID().replaceAll("-", "");
    const hash = createHash("sha256").update(token).digest("hex");
    await db
      .prepare("INSERT INTO developer_operations VALUES(?,?,?,'granted',NULL)")
      .bind(hash, operation, expires)
      .run();
    return token;
  };
  const call = async (
    token,
    method = "POST",
    operation = "provider_identity",
  ) => {
    const r = await mf.dispatchFetch(
      origin +
        (operation === "provider_identity"
          ? "/api/developer/provider-identity"
          : "/api/developer/historical-comparison"),
      { method, headers: { origin, authorization: "Bearer " + token } },
    );
    return {
      status: r.status,
      body: await r.json(),
      correlationId: r.headers.get("x-request-id"),
    };
  };
  return { mf, db, calls, grant, call, sql, root, logs };
}
test("provider operation rejects absent expired and disabled grants before dispatch", async () => {
  const f = await fixture({ mode: "disabled" });
  try {
    assert.equal((await f.call("bad")).status, 401);
    assert.equal((await f.call("f".repeat(64))).status, 401);
    assert.equal((await f.call(await f.grant(Date.now() - 1))).status, 401);
    assert.equal(
      (await f.call(await f.grant())).body.error,
      "provider_access_disabled",
    );
    assert.equal(f.calls.length, 0);
  } finally {
    await f.mf.dispose();
  }
});
test("provider identity counts every physical request and returns only sanitized evidence", async () => {
  const f = await fixture();
  try {
    const token = await f.grant();
    const r = await f.call(token);
    assert.equal(r.body.state, "complete");
    assert.deepEqual(r.body.result.bookingAllowance, {
      total: 50,
      remaining: 26,
    });
    assert.equal(r.body.result.apiQuota, "unverified");
    assert.equal(f.calls.length, 4);
    assert.deepEqual((await f.sql("SELECT used FROM budget"))[0], { used: 4 });
    assert.equal(
      (await f.sql("SELECT count(*) n FROM admissions WHERE finished=0"))[0].n,
      0,
    );
    assert.doesNotMatch(
      JSON.stringify(r.body),
      /synthetic-(public|admin|developer)|must-not-escape/,
    );
    assert.deepEqual((await f.call(token)).body, r.body);
    assert.deepEqual((await f.call(token, "GET")).body, r.body);
    assert.equal(f.calls.length, 4);
  } finally {
    await f.mf.dispose();
  }
});
test("concurrent provider proof grants share authentication and upstream reads", async () => {
  const f = await fixture();
  try {
    const grants = await Promise.all([f.grant(), f.grant(), f.grant()]);
    const results = await Promise.all(grants.map((g) => f.call(g)));
    for (const r of results) assert.equal(r.body.state, "complete");
    assert.equal(f.calls.length, 4);
  } finally {
    await f.mf.dispose();
  }
});
test("provider redirect is refused without forwarding credentials or following Location", async () => {
  const f = await fixture({
    respond: () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://unapproved.invalid/" },
      }),
  });
  try {
    const r = await f.call(await f.grant());
    assert.equal(r.body.result.reason, "provider_redirect_denied");
    assert.equal(f.calls.length, 1);
  } finally {
    await f.mf.dispose();
  }
});
test("provider RPC correlation mismatch blocks dependent authentication and reads", async () => {
  const f = await fixture({
    respond: () =>
      Response.json({ id: "foreign", result: "synthetic-public-token" }),
  });
  try {
    assert.equal(
      (await f.call(await f.grant())).body.result.reason,
      "provider_rpc_failed",
    );
    assert.equal(f.calls.length, 1);
  } finally {
    await f.mf.dispose();
  }
});
test("provider auth challenge is unavailable and never triggers notification or retry", async () => {
  const f = await fixture({
    respond: (r) =>
      r.url.endsWith("/admin/auth")
        ? Response.json({
            require2fa: true,
            auth_session_id: "private",
            token: "synthetic-admin-token",
          })
        : null,
  });
  try {
    assert.equal(
      (await f.call(await f.grant())).body.result.reason,
      "provider_auth_representation_unknown",
    );
    assert.equal(f.calls.length, 2);
    assert.equal((await f.call(await f.grant())).body.state, "blocked");
    assert.equal(f.calls.length, 2);
  } finally {
    await f.mf.dispose();
  }
});
test("provider identity mismatch prevents tariff read and never exposes account fields", async () => {
  const f = await fixture({
    respond: (r) =>
      r.url.endsWith("/company/info")
        ? Response.json({ login: "foreign", email: "private" })
        : null,
  });
  try {
    const r = await f.call(await f.grant());
    assert.equal(r.body.result.reason, "provider_identity_unverified");
    assert.equal(f.calls.length, 3);
    assert.doesNotMatch(JSON.stringify(r.body), /foreign|private/);
  } finally {
    await f.mf.dispose();
  }
});
test("provider rate failures consume budget enforce cooldown and never retry", async () => {
  const f = await fixture({
    respond: () => new Response(null, { status: 429 }),
  });
  try {
    assert.equal(
      (await f.call(await f.grant())).body.result.reason,
      "provider_http_failed",
    );
    await f.call(await f.grant());
    assert.equal(f.calls.length, 1);
    assert.equal((await f.sql("SELECT used FROM budget"))[0].used, 1);
  } finally {
    await f.mf.dispose();
  }
});
test("provider oversized response is bounded and never accepted as authentication", async () => {
  const f = await fixture({
    respond: () => Response.json({ data: "x".repeat(131073) }),
  });
  try {
    assert.equal(
      (await f.call(await f.grant())).body.result.reason,
      "provider_response_too_large",
    );
    assert.equal(f.calls.length, 1);
  } finally {
    await f.mf.dispose();
  }
});
test("closed provider campaign refuses physical dispatch", async () => {
  const f = await fixture({ end: 0 });
  try {
    assert.equal(
      (await f.call(await f.grant())).body.result.reason,
      "campaign_closed",
    );
    assert.equal(f.calls.length, 0);
  } finally {
    await f.mf.dispose();
  }
});
test("provider ordinary requests preserve recovery reserve at durable budget boundary", async () => {
  const f = await fixture();
  try {
    await f.sql(
      "INSERT INTO budget(campaign,used) VALUES('developer-20261008',64)",
    );
    assert.equal(
      (await f.call(await f.grant())).body.result.reason,
      "budget_exhausted",
    );
    assert.equal(f.calls.length, 0);
  } finally {
    await f.mf.dispose();
  }
});
test("provider interrupted operation survives restart without replay", async () => {
  const f = await fixture();
  const token = await f.grant();
  await f.db.prepare("UPDATE developer_operations SET state='running'").run();
  await f.sql(
    "INSERT INTO admissions(id,campaign,started_ms) VALUES('unknown','developer-20261008',?)",
    Date.now(),
  );
  await f.mf.dispose();
  const resumed = await fixture({ persistence: f.root });
  try {
    assert.equal((await resumed.call(token)).body.state, "running");
    assert.equal(resumed.calls.length, 0);
    assert.equal(
      (
        await resumed.sql("SELECT count(*) n FROM admissions WHERE finished=0")
      )[0].n,
      1,
    );
  } finally {
    await resumed.mf.dispose();
  }
});
test("stale token completion is fenced before any dependent provider read", async () => {
  let f;
  f = await fixture({
    respond: async () => {
      await f.sql(
        "UPDATE refreshes SET generation=generation+1 WHERE key='token:public'",
      );
      return null;
    },
  });
  try {
    assert.equal(
      (await f.call(await f.grant())).body.result.reason,
      "provider_auth_stale",
    );
    assert.equal(f.calls.length, 1);
  } finally {
    await f.mf.dispose();
  }
});
test("provider dispatch reservation exists before transport and caps active requests", async () => {
  let f;
  f = await fixture({
    respond: async () => {
      const rows = await f.sql(
        "SELECT count(*) n FROM admissions WHERE finished=0",
      );
      assert.equal(rows[0].n, 1);
      return null;
    },
  });
  try {
    assert.equal((await f.call(await f.grant())).body.state, "complete");
    assert.equal(f.calls.length, 4);
    await f.sql(
      "INSERT INTO admissions(id,campaign,started_ms) VALUES('held-a','developer-20261008',0),('held-b','developer-20261008',0)",
    );
    // Eviction removes the memory cache while preserving unknown admissions.
    await f.mf.unsafeEvictDurableObject(
      "provider-test",
      "SoccerBotAccountCoordinator",
      { name: "simplybook-developer-account" },
    );
    assert.equal(
      (await f.call(await f.grant())).body.result.reason,
      "concurrency",
    );
    assert.equal(f.calls.length, 4);
  } finally {
    await f.mf.dispose();
  }
});
test("provider read burst after eviction cannot exceed four rolling starts", async () => {
  const f = await fixture();
  try {
    await f.sql(
      "INSERT INTO admissions(id,campaign,started_ms,finished) VALUES('one','developer-20261008',?,1),('two','developer-20261008',?,1),('three','developer-20261008',?,1),('four','developer-20261008',?,1)",
      ...Array(4).fill(Date.now()),
    );
    assert.equal((await f.call(await f.grant())).body.result.reason, "rate");
    assert.equal(f.calls.length, 0);
  } finally {
    await f.mf.dispose();
  }
});
test("uncertain provider transport retains its durable reservation without replay", async () => {
  const f = await fixture({
    // Miniflare converts thrown service errors into HTTP 500. A response that
    // never arrives exercises the actual transport AbortController deadline.
    respond: () => new Promise(() => {}),
  });
  try {
    const token = await f.grant();
    const r = await f.call(token);
    assert.equal(r.body.result.reason, "provider_transport_uncertain");
    assert.equal(r.body.result.accounting.used, 1);
    assert.equal(r.body.result.accounting.active, 1);
    assert.equal((await f.call(token)).body.state, "blocked");
    assert.equal(f.calls.length, 1);
    await f.mf.unsafeEvictDurableObject(
      "provider-test",
      "SoccerBotAccountCoordinator",
      { name: "simplybook-developer-account" },
    );
    assert.equal(
      (await f.sql("SELECT count(*) n FROM admissions WHERE finished=0"))[0].n,
      1,
    );
  } finally {
    await f.mf.dispose();
  }
});
async function comparison(f) {
  return f.call(
    await f.grant(Date.now() + 60000, "historical_comparison"),
    "POST",
    "historical_comparison",
  );
}
test("historical read normalization preserves string flags exact money and occupied end without manufacturing intent", async () => {
  const f = await fixture();
  try {
    const r = await comparison(f),
      v = r.body.result;
    assert.equal(r.body.state, "complete");
    assert.equal(v.newWritePathVerified, false);
    assert.equal(v.evidenceKind, "historical_read_only");
    assert.equal(v.booking.confirmed, true);
    assert.equal(v.booking.cancelled, false);
    assert.equal(v.invoice.paymentReceived, true);
    assert.equal(v.invoice.totalMinor, 8800);
    assert.equal(v.invoice.taxMinor, 0);
    assert.equal(v.knownInvoiceJoin, true);
    assert.equal(v.booking.end, "2026-10-09 09:50:00");
    assert.equal(f.calls.length, 4);
    assert.doesNotMatch(JSON.stringify(v), /must-not-escape/);
  } finally {
    await f.mf.dispose();
  }
});
test("historical normalization leaves unknown flags states and imprecise amounts unresolved", async () => {
  const f = await fixture({
    respond: (r) =>
      r.url.endsWith("/invoices/23")
        ? Response.json({
            id: 23,
            status: "future_state",
            payment_received: "false",
            amount: "88.001",
            tax_amount: null,
          })
        : null,
  });
  try {
    const v = (await comparison(f)).body.result;
    assert.equal(v.invoice.status, "unknown");
    assert.equal(v.invoice.paymentReceived, null);
    assert.equal(v.invoice.totalMinor, null);
    assert.equal(v.invoice.taxMinor, null);
    assert.equal(v.knownInvoiceJoin, false);
  } finally {
    await f.mf.dispose();
  }
});
test("historical paid invoice retains cancelled booking independently and invoice renumbering is not identity", async () => {
  const f = await fixture({
    respond: (r) =>
      r.url.endsWith("/bookings/23")
        ? Response.json({
            id: 23,
            is_confirmed: "0",
            is_cancelled: "1",
            invoice_id: 23,
            invoice_status: "paid",
          })
        : r.url.endsWith("/invoices/23")
          ? Response.json({
              id: 23,
              number: "RENAMED",
              status: "paid",
              payment_received: true,
              currency: "SGD",
              amount: 88,
              tax_amount: 0,
              lines: [{ booking: { id: 23 } }],
            })
          : null,
  });
  try {
    const v = (await comparison(f)).body.result;
    assert.equal(v.booking.confirmed, false);
    assert.equal(v.booking.cancelled, true);
    assert.equal(v.invoice.paymentReceived, true);
    assert.equal(v.invoice.number, "RENAMED");
    assert.equal(v.knownInvoiceJoin, true);
    assert.equal(v.newWritePathVerified, false);
  } finally {
    await f.mf.dispose();
  }
});
test("historical invoice new pending and timeout states remain distinct", async () => {
  for (const status of ["new", "pending", "cancelled_by_timeout"]) {
    const f = await fixture({
      respond: (r) =>
        r.url.endsWith("/invoices/23")
          ? Response.json({ id: 23, status, payment_received: "0" })
          : null,
    });
    try {
      const v = (await comparison(f)).body.result;
      assert.equal(v.invoice.status, status);
      assert.equal(v.invoice.paymentReceived, false);
      assert.equal(v.newWritePathVerified, false);
    } finally {
      await f.mf.dispose();
    }
  }
});
test("operator grants are bound to the exact historical read operation", async () => {
  const f = await fixture();
  try {
    const identity = await f.grant();
    assert.equal(
      (await f.call(identity, "POST", "historical_comparison")).status,
      401,
    );
    const history = await f.grant(Date.now() + 60000, "historical_comparison");
    assert.equal((await f.call(history)).status, 401);
    assert.equal(f.calls.length, 0);
  } finally {
    await f.mf.dispose();
  }
});
test("operator scope migration preserves existing completed grants and results", async () => {
  const f = await fixture({ legacy: true });
  try {
    const grant = await f.grant();
    await f.db
      .prepare("UPDATE developer_operations SET state='complete',result_json=?")
      .bind('{"preserved":true}')
      .run();
    await f.db.exec(
      readFileSync("migrations/0004_operator_read_scopes.sql", "utf8")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
    assert.deepEqual((await f.call(grant, "GET")).body, {
      state: "complete",
      result: { preserved: true },
    });
    assert.equal(f.calls.length, 0);
  } finally {
    await f.mf.dispose();
  }
});

test("correlated provider spans separate admission storage transport and shared caller work", async () => {
  const f = await fixture();
  try {
    const grants = await Promise.all([f.grant(), f.grant()]);
    const results = await Promise.all(grants.map((g) => f.call(g)));
    assert.equal(f.calls.length, 4);
    assert.equal(new Set(results.map((r) => r.correlationId)).size, 2);
    const traces = f.logs
      .filter((s) => s.includes('"foundation_trace"'))
      .map(JSON.parse);
    const providers = traces.filter((t) => t.boundary === "coordinator");
    assert.equal(providers.length, 2);
    assert.ok(
      providers.reduce((n, t) => n + t.spans.coordinator_wait.count, 0) >= 1,
    );
    assert.equal(
      providers.reduce((n, t) => n + t.spans.provider.count, 0),
      4,
    );
    assert.equal(
      providers.reduce((n, t) => n + t.spans.coordinator.count, 0),
      4,
    );
    for (const r of results) {
      assert.equal(r.body.state, "complete");
      const http = traces.find(
        (t) => t.boundary === "http" && t.correlationId === r.correlationId,
      );
      assert.ok(http.spans.storage.count >= 4);
      assert.equal(http.spans.coordinator_rpc.count, 1);
      assert.ok(providers.some((t) => t.correlationId === r.correlationId));
    }
    for (const t of traces)
      for (const m of Object.values(t.spans)) {
        assert.ok(Number.isFinite(m.durationMs) && m.durationMs >= 0);
        assert.equal(m.errors, 0);
      }
    const serialized = JSON.stringify({ results, traces });
    for (const secret of [
      ...grants,
      "synthetic-public-secret",
      "synthetic-admin-secret",
      "synthetic-public-token",
      "synthetic-admin-token",
      "must-not-escape",
    ])
      assert.ok(!serialized.includes(secret));
  } finally {
    await f.mf.dispose();
  }
});

test("provider failure spans are redacted and preserve consumed reservations", async () => {
  const f = await fixture({
    respond: async () =>
      new Response("SYNTHETIC_PRIVATE_FAILURE", { status: 401 }),
  });
  try {
    const r = await f.call(await f.grant());
    assert.equal(r.body.state, "blocked");
    const traces = f.logs
      .filter((s) => s.includes('"foundation_trace"'))
      .map(JSON.parse);
    const provider = traces.find((t) => t.boundary === "coordinator");
    assert.equal(provider.spans.provider.count, 1);
    assert.equal(provider.spans.provider.errors, 1);
    assert.equal((await f.sql("SELECT used FROM budget"))[0].used, 1);
    assert.ok(
      !JSON.stringify({ r, logs: f.logs }).includes(
        "SYNTHETIC_PRIVATE_FAILURE",
      ),
    );
  } finally {
    await f.mf.dispose();
  }
});

test("provider cooldown and consumption persist across runtime restart", async () => {
  const f = await fixture({
    respond: async (request) =>
      new URL(request.url).pathname === "/admin/company/info"
        ? new Response("synthetic refusal", { status: 429 })
        : undefined,
  });
  const first = await f.call(await f.grant());
  assert.equal(first.body.state, "blocked");
  assert.equal(f.calls.length, 3);
  const root = f.root;
  await f.mf.dispose();
  const resumed = await fixture({ persistence: root });
  try {
    const r = await resumed.call(await resumed.grant());
    assert.equal(r.body.result.reason, "cooldown");
    assert.equal(resumed.calls.length, 0);
    assert.equal((await resumed.sql("SELECT used FROM budget"))[0].used, 3);
  } finally {
    await resumed.mf.dispose();
  }
});

test("provider missing credentials and client mapping refuse before authentication", async () => {
  for (const secrets of [
    { SIMPLYBOOK_DEV_COMPANY_LOGIN: "" },
    { SIMPLYBOOK_DEV_ADMIN_LOGIN: "" },
    { SIMPLYBOOK_DEV_API_KEY: "" },
    { SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "" },
    { SIMPLYBOOK_DEV_COMPANY_LOGIN: "soccerbotstudio" },
  ]) {
    const f = await fixture({ secrets });
    try {
      const r = await f.call(await f.grant());
      assert.equal(r.body.state, "blocked");
      assert.equal(f.calls.length, 0);
      assert.ok(
        ["provider_credentials_missing", "client_account_forbidden"].includes(
          r.body.result.reason,
        ),
      );
    } finally {
      await f.mf.dispose();
    }
  }
});
