import { seedFoundation } from "./foundation-fixture.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
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
  full = false,
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
    for (const name of full
      ? readdirSync("migrations")
          .sort()
          .filter((name) => !name.startsWith("0005"))
      : [
          "0001_developer_journal.sql",
          "0002_developer_operations.sql",
          ...(!legacy
            ? [
                "0004_operator_read_scopes.sql",
                "0008_native_field_discovery.sql",
              ]
            : []),
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
          : operation === "native_field_discovery"
            ? "/api/developer/native-field-discovery"
            : operation === "native_recovery_window"
              ? "/api/developer/native-readback"
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
      const remote = providers.find((t) => t.correlationId === r.correlationId);
      assert.ok(
        http.spans.coordinator_rpc.durationMs >= remote.durationMs,
        "RPC span must include awaited remote execution",
      );
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
    { SIMPLYBOOK_DEV_COMPANY_LOGIN: " soccerbotstudio " },
    { SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-operator\n" },
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

// Synthetic metadata only. No retained account response or field identifier.
const discoveryOperation = "native_field_discovery";
test("operator readiness reports coordinator bindings with carried accounting and no provider dispatch", async () => {
  for (const mode of ["disabled", "trusted-reads", "expired"]) {
    const end = mode === "expired" ? Date.now() - 1000 : Date.now() + 600000;
    const f = await fixture({
      mode: mode === "disabled" ? "disabled" : "trusted-reads",
      end,
      secrets: {
        PROVIDER_CALL_CEILING: "128",
        SOURCE_REVISION: "c".repeat(40),
      },
    });
    try {
      await f.sql(
        "INSERT OR REPLACE INTO budget(campaign,used,cooldown_ms) VALUES('developer-20261008',33,0)",
      );
      const token = await f.grant(Date.now() + 180000, discoveryOperation);
      const result = await f.call(token, "GET", discoveryOperation);
      assert.equal(result.status, 200);
      assert.equal(result.body.state, "granted");
      assert.deepEqual(result.body.accounting, {
        used: 33,
        active: 0,
        ceiling: 128,
        recoveryReserve: 16,
      });
      assert.deepEqual(result.body.coordinator, {
        revision: "c".repeat(40),
        versionId: null,
        providerAccess: mode === "disabled" ? "disabled" : "trusted-reads",
        campaignEndMs: end,
        effectiveProviderAccess:
          mode === "trusted-reads" ? "trusted-reads" : "disabled",
      });
      for (const invalid of [
        "f".repeat(64),
        await f.grant(Date.now() - 1, discoveryOperation),
      ]) {
        const denied = await f.call(invalid, "GET", discoveryOperation);
        assert.equal(denied.status, 401);
        assert.equal(Object.hasOwn(denied.body, "coordinator"), false);
      }
      assert.equal(f.calls.length, 0);
      assert.doesNotMatch(
        JSON.stringify(result),
        /synthetic-public-secret|synthetic-admin-secret/,
      );
    } finally {
      await f.mf.dispose();
    }
  }
});
const syntheticField = {
  name: "synthetic_players",
  title: "Number of players",
  type: "select",
  values: "1,2,3,4",
  is_null: "0",
  default: "must-not-escape",
  value: "must-not-escape",
  privateContact: "must-not-escape",
};
async function discoveryFixture(options = {}) {
  const f = await fixture({
    ...options,
    respond: async (request, body, calls) => {
      const custom = await options.respond?.(request, body, calls);
      if (custom) return custom;
      if (new URL(request.url).pathname === "/") {
        assert.equal(request.headers.get("X-Token"), "synthetic-public-token");
        assert.equal(body.method, "getAdditionalFields");
        assert.deepEqual(body.params, [2]);
        return Response.json({
          id: body.id,
          result: [syntheticField],
          error: null,
        });
      }
    },
  });
  await f.sql(
    "INSERT OR REPLACE INTO budget(campaign,used,cooldown_ms) VALUES('developer-20261008',8,0)",
  );
  return f;
}
test("discovery uses exactly five fixed requests and projects metadata without answers or secrets", async () => {
  const f = await discoveryFixture();
  try {
    const token = await f.grant(Date.now() + 180000, discoveryOperation);
    const before = await f.call(token, "GET", discoveryOperation);
    assert.equal(before.body.accounting.used, 8);
    assert.equal(f.calls.length, 0);
    const result = await f.call(token, "POST", discoveryOperation);
    assert.equal(result.body.state, "complete");
    assert.equal(result.body.result.accounting.used, 13);
    assert.equal(result.body.result.persistenceVerified, false);
    assert.deepEqual(result.body.result.fields, [
      {
        identifier: "synthetic_players",
        playerTitleMatches: true,
        type: "select",
        required: true,
        playerOptions: ["1", "2", "3", "4"],
        optionCount: 4,
        playerCandidate: true,
      },
    ]);
    assert.deepEqual(
      f.calls.map((v) => [new URL(v.url).pathname, v.method]),
      [
        ["/login", "POST"],
        ["/admin/auth", "POST"],
        ["/admin/company/info", "GET"],
        ["/admin/tariff/current", "GET"],
        ["/", "POST"],
      ],
    );
    assert.doesNotMatch(
      JSON.stringify(result) + JSON.stringify(f.logs),
      /must-not-escape|synthetic-public-token|synthetic-admin-secret/,
    );
    await f.call(token, "POST", discoveryOperation);
    assert.equal(f.calls.length, 5);
    const after = await f.call(token, "GET", discoveryOperation);
    assert.equal(after.body.accounting.used, 13);
  } finally {
    await f.mf.dispose();
  }
});
test("discovery denies closed expired foreign and wrong-scope grants with zero dispatch", async () => {
  for (const mode of ["disabled", "trusted-reads"]) {
    const f = await discoveryFixture({
      mode,
      end: mode === "disabled" ? Date.now() + 180000 : 0,
    });
    try {
      assert.equal(
        (await f.call("f".repeat(64), "POST", discoveryOperation)).status,
        401,
      );
      assert.equal(
        (await f.call(await f.grant(), "POST", discoveryOperation)).status,
        401,
      );
      assert.equal(
        (
          await f.call(
            await f.grant(Date.now() - 1, discoveryOperation),
            "POST",
            discoveryOperation,
          )
        ).status,
        401,
      );
      const token = await f.grant(Date.now() + 60000, discoveryOperation);
      const result = await f.call(token, "POST", discoveryOperation);
      assert.ok(result.status === 503 || result.body.state === "blocked");
      assert.equal(f.calls.length, 0);
    } finally {
      await f.mf.dispose();
    }
  }
});
test("discovery stops before dispatch on changed durable usage unknown reservations or oversized window", async () => {
  for (const cause of ["usage", "unknown", "window", "short"]) {
    const f = await discoveryFixture();
    try {
      if (cause === "usage") await f.sql("UPDATE budget SET used=9");
      if (cause === "unknown")
        await f.sql(
          "INSERT INTO admissions VALUES('unknown','developer-20261008',1,0)",
        );
      const token = await f.grant(
        Date.now() +
          (cause === "window" ? 240000 : cause === "short" ? 10000 : 60000),
        discoveryOperation,
      );
      assert.equal(
        (await f.call(token, "POST", discoveryOperation)).body.state,
        "blocked",
      );
      assert.equal(f.calls.length, 0);
    } finally {
      await f.mf.dispose();
    }
  }
});
test("discovery counts failed authentication and never retries or resumes a consumed grant", async () => {
  const f = await discoveryFixture({
    respond: () => new Response(null, { status: 403 }),
  });
  try {
    const token = await f.grant(Date.now() + 180000, discoveryOperation);
    const result = await f.call(token, "POST", discoveryOperation);
    assert.equal(result.body.state, "blocked");
    assert.equal(result.body.result.accounting.used, 9);
    assert.equal(result.body.result.accounting.active, 0);
    assert.equal(f.calls.length, 1);
    await f.call(token, "POST", discoveryOperation);
    assert.equal(f.calls.length, 1);
    const persisted = await f.db
      .prepare("SELECT state,result_json FROM developer_operations")
      .first();
    assert.equal(persisted.state, "blocked");
    assert.doesNotMatch(persisted.result_json, /token|secret|password/);
  } finally {
    await f.mf.dispose();
  }
});
test("discovery rejects malformed duplicate paginated and oversized metadata without retaining raw values", async () => {
  const bundled = (
    await build({
      entryPoints: ["worker/field-discovery.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
    })
  ).outputFiles[0].text;
  const { discoveryFields } = await import(
    "data:text/javascript;base64," + Buffer.from(bundled).toString("base64")
  );
  for (const body of [
    { data: [] },
    [syntheticField, syntheticField],
    Array(65).fill(syntheticField),
    [{ ...syntheticField, is_null: "false" }],
    [{ ...syntheticField, values: [1, 2, 3, 4] }],
  ]) {
    assert.throws(() => discoveryFields(body), /discovery_fields_unrecognized/);
  }
  assert.deepEqual(discoveryFields([]), []);
  const result = discoveryFields([
    {
      ...syntheticField,
      title: "private@example.invalid",
      values: "private@example.invalid",
      is_null: null,
      type: "unknown-secret",
    },
  ]);
  assert.equal(result[0].required, null);
  assert.equal(result[0].playerCandidate, false);
  assert.equal(result[0].type, "unsupported");
  assert.equal(result[0].playerOptions, null);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private@|unknown-secret|must-not-escape/,
  );
});
test("discovery unknown dispatch remains counted across eviction and cannot replay", async () => {
  const f = await discoveryFixture({ respond: () => new Promise(() => {}) });
  try {
    const token = await f.grant(Date.now() + 180000, discoveryOperation);
    const result = await f.call(token, "POST", discoveryOperation);
    assert.equal(result.body.state, "blocked");
    assert.equal(result.body.result.reason, "provider_transport_uncertain");
    assert.equal(result.body.result.accounting.used, 9);
    assert.equal(result.body.result.accounting.active, 1);
    await f.mf.unsafeEvictDurableObject(
      "provider-test",
      "SoccerBotAccountCoordinator",
      { name: "simplybook-developer-account" },
    );
    const retained = await f.call(token, "GET", discoveryOperation);
    assert.equal(retained.body.accounting.used, 9);
    assert.equal(retained.body.accounting.active, 1);
    await f.call(token, "POST", discoveryOperation);
    const other = await f.grant(Date.now() + 60000, discoveryOperation);
    assert.equal(
      (await f.call(other, "POST", discoveryOperation)).body.result.reason,
      "discovery_accounting_changed",
    );
    assert.equal(f.calls.length, 1);
  } finally {
    await f.mf.dispose();
  }
});

async function catalogueGuest(
  f,
  state = "granted",
  scope = { startingUsed: 0, maxCalls: 6 },
) {
  await f.db.exec(
    readFileSync("migrations/0010_customer_read_scopes.sql", "utf8")
      .replace(/^--.*$/gm, "")
      .replace(/\n/g, " "),
  );
  const response = await f.mf.dispatchFetch(origin + "/api/access", {
    method: "POST",
    headers: { origin },
  });
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const hash = createHash("sha256").update(cookie.split("=")[1]).digest("hex");
  await f.db
    .prepare(
      "INSERT INTO developer_operations VALUES(?,'customer_catalogue',?,?,?)",
    )
    .bind(hash, Date.now() + 180000, state, JSON.stringify(scope))
    .run();
  return { cookie, hash };
}
test("customer catalogue joins authenticated guest to one finite six-call read without exposing company binding", async () => {
  const f = await fixture({
    respond: async (_request, body) => {
      if (body?.method === "getEventList")
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            12: {
              id: 12,
              name: "Current session",
              duration: "40",
              is_active: "1",
              is_public: "1",
              is_recurring: "0",
              price: "91.0000",
              currency: "SGD",
              unit_map: [14],
            },
          },
        });
      if (body?.method === "getUnitList")
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            14: { id: 14, name: "Current instructor", is_active: "1" },
          },
        });
    },
  });
  try {
    const { cookie, hash } = await catalogueGuest(f);
    const requests = await Promise.all([
      f.mf.dispatchFetch(origin + "/api/catalogue", { headers: { cookie } }),
      f.mf.dispatchFetch(origin + "/api/catalogue", { headers: { cookie } }),
    ]);
    assert.equal(requests.filter((r) => r.status === 200).length, 1);
    const value = await requests.find((r) => r.status === 200).json();
    assert.equal(value.services[0].id, "12");
    assert.equal(value.services[0].priceMinor, 9100);
    assert.equal(value.instructors[0].name, "Current instructor");
    assert.equal(value.environment, "developer");
    assert.equal("binding" in value, false);
    assert.equal(JSON.stringify(value).includes("synthetic-developer"), false);
    assert.equal(f.calls.length, 6);
    assert.equal(
      (
        await f.mf.dispatchFetch(origin + "/api/catalogue", {
          headers: { cookie },
        })
      ).status,
      200,
    );
    assert.equal(f.calls.length, 6);
    await f.db
      .prepare(
        "UPDATE developer_operations SET expires_ms=0 WHERE capability_hash=?",
      )
      .bind(hash)
      .run();
    assert.equal(
      (
        await f.mf.dispatchFetch(origin + "/api/catalogue", {
          headers: { cookie },
        })
      ).status,
      503,
    );
    assert.equal(f.calls.length, 6);
  } finally {
    await f.mf.dispose();
  }
});
test("customer catalogue denies closed wrong-accounting unowned and unknown scopes without replay", async () => {
  for (const mode of ["disabled", "trusted-reads"]) {
    const f = await fixture({ mode });
    try {
      const { cookie } = await catalogueGuest(f, "granted", {
        startingUsed: 1,
        maxCalls: 6,
      });
      assert.equal(
        (await f.mf.dispatchFetch(origin + "/api/catalogue")).status,
        401,
      );
      assert.equal(
        (
          await f.mf.dispatchFetch(origin + "/api/catalogue", {
            headers: { cookie },
          })
        ).status,
        503,
      );
      assert.equal(
        (
          await f.mf.dispatchFetch(origin + "/api/catalogue", {
            headers: { cookie },
          })
        ).status,
        503,
      );
      assert.equal(f.calls.length, 0);
    } finally {
      await f.mf.dispose();
    }
  }
});

const nativeResponses = JSON.parse(
  readFileSync("worker/tests/native-fixtures.json", "utf8"),
).responses;
async function scheduledAttempt(f, options = {}) {
  const now = Date.now(),
    id = crypto.randomUUID(),
    owner = crypto.randomUUID();
  const intent = {
    accountId: config.vars.DEPLOYMENT_ACCOUNT_ID,
    environmentId: "developer",
    customerId: "51",
    currency: "SGD",
    totalMinor: 8800,
    taxMinor: 0,
    sessions: [
      {
        serviceId: "12",
        instructorId: "14",
        startMs: Date.parse("2026-10-10T01:00:00Z"),
        players: 1,
        totalMinor: 8800,
        taxMinor: 0,
      },
    ],
  };
  const json = JSON.stringify(intent);
  await f.db
    .prepare(
      "INSERT INTO attempts(id,owner_id,idempotency_key,intent_json,intent_hash,created_ms,deadline_ms,version,state,association_json) VALUES(?,?,?,?,?,?,?,1,'dispatching',?)",
    )
    .bind(
      id,
      owner,
      crypto.randomUUID(),
      json,
      createHash("sha256").update(json).digest("hex"),
      now,
      options.deadline ?? now + 600000,
      JSON.stringify({ bookingIds: ["701"], invoiceId: "901" }),
    )
    .run();
  await f.db
    .prepare(
      "INSERT INTO dispatches VALUES(?,?,'booking.create',1,?,'unknown')",
    )
    .bind(crypto.randomUUID(), id, now - 60001)
    .run();
  await f.db
    .prepare(
      "INSERT INTO session_effects VALUES(?,'native-booking-key','observed',?)",
    )
    .bind(
      id,
      JSON.stringify({ bookingId: "701", hash: "synthetic-booking-hash" }),
    )
    .run();
  const token = createHash("sha256").update(crypto.randomUUID()).digest("hex");
  const key = createHash("sha256").update(token).digest("hex");
  const scope = {
    attemptId: id,
    notBeforeMs: now,
    startingUsed: 0,
    maximumUsed: 6,
    ...options.scope,
  };
  await f.db
    .prepare(
      "INSERT INTO developer_operations VALUES(?,'native_recovery_window',?,?,?)",
    )
    .bind(
      key,
      options.expires ?? now + 180000,
      options.state ?? "granted",
      JSON.stringify(scope),
    )
    .run();
  return { id, key, token };
}
function nativeReadResponse(_request, body) {
  if (body?.method === "getBookingDetails")
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: nativeResponses.bookingAfter,
    });
  if (new URL(_request.url).pathname === "/admin/invoices/901")
    return Response.json(nativeResponses.invoiceAfter);
}
async function tick(f) {
  return (await f.mf.getWorker()).scheduled({ cron: "* * * * *" });
}

test("scheduled native recovery confirms from authoritative reads without browser and consumes one window", async () => {
  const f = await fixture({
    full: true,
    respond: nativeReadResponse,
    secrets: { SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret" },
  });
  try {
    const a = await scheduledAttempt(f);
    await Promise.all([tick(f), tick(f)]);
    const grant = await f.db
      .prepare("SELECT * FROM developer_operations WHERE capability_hash=?")
      .bind(a.key)
      .first();
    assert.equal(grant.state, "complete", JSON.stringify(grant));
    assert.equal(f.calls.length, 6, JSON.stringify(grant));
    const recovery = await f.db
      .prepare("SELECT state,tries FROM recovery_work WHERE attempt_id=?")
      .bind(a.id)
      .first();
    assert.equal(recovery.state, "complete");
    assert.equal(recovery.tries, 1);
    const observation = await f.db
      .prepare("SELECT observation_json FROM attempts WHERE id=?")
      .bind(a.id)
      .first();
    assert.equal(
      JSON.parse(observation.observation_json).invoice.status,
      "paid",
    );
    assert.equal(
      (
        await f.mf.dispatchFetch(
          origin + "/api/attempts/" + a.id + "/confirmation",
        )
      ).status,
      401,
    );
    await tick(f);
    assert.equal(f.calls.length, 6);
    const root = f.root;
    await f.mf.dispose();
    const restarted = await fixture({
      persistence: root,
      respond: nativeReadResponse,
      secrets: { SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret" },
    });
    try {
      await tick(restarted);
      assert.equal(restarted.calls.length, 0);
    } finally {
      await restarted.mf.dispose();
    }
  } finally {
    await f.mf.dispose();
  }
});
test("scheduled native readback uses the recovery reserve only under explicit finite authority", async () => {
  for (const allowed of [false, true]) {
    const f = await fixture({
      full: true,
      respond: nativeReadResponse,
      secrets: { SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret" },
    });
    try {
      await f.sql(
        "INSERT INTO budget(campaign,used) VALUES('developer-20261008',64)",
      );
      const a = await scheduledAttempt(f, {
        scope: {
          startingUsed: 64,
          maximumUsed: 70,
          ...(allowed ? { useRecoveryReserve: true } : {}),
        },
      });
      await tick(f);
      assert.equal(f.calls.length, allowed ? 6 : 0);
      assert.equal(
        (await f.sql("SELECT used FROM budget"))[0].used,
        allowed ? 70 : 64,
      );
      const grant = await f.db
        .prepare(
          "SELECT state FROM developer_operations WHERE capability_hash=?",
        )
        .bind(a.key)
        .first();
      assert.equal(grant.state, allowed ? "complete" : "blocked");
      await tick(f);
      assert.equal(f.calls.length, allowed ? 6 : 0);
    } finally {
      await f.mf.dispose();
    }
  }
});

test("operator native readback consumes only its named window and cannot be invoked by guest access", async () => {
  const f = await fixture({
    full: true,
    respond: nativeReadResponse,
    secrets: { SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret" },
  });
  try {
    const untouched = await scheduledAttempt(f);
    const target = await scheduledAttempt(f);
    const guest = await f.mf.dispatchFetch(origin + "/api/access", {
      method: "POST",
      headers: { origin },
    });
    assert.equal(guest.status, 201);
    const cookie = guest.headers.get("set-cookie").split(";")[0];
    const denied = await f.mf.dispatchFetch(
      origin + "/api/developer/native-readback",
      { method: "POST", headers: { origin, cookie } },
    );
    assert.equal(denied.status, 401);
    assert.equal(
      (await f.call("f".repeat(64), "POST", "native_recovery_window")).status,
      401,
    );
    assert.equal(f.calls.length, 0);
    const before = await f.call(target.token, "GET", "native_recovery_window");
    assert.equal(before.body.state, "granted");
    assert.equal(f.calls.length, 0);
    const invoked = await Promise.all([
      f.call(target.token, "POST", "native_recovery_window"),
      f.call(target.token, "POST", "native_recovery_window"),
    ]);
    assert.ok(
      invoked.some((result) => result.body.state === "complete"),
      JSON.stringify(invoked),
    );
    assert.equal(f.calls.length, 6);
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT state FROM developer_operations WHERE capability_hash=?",
          )
          .bind(untouched.key)
          .first()
      ).state,
      "granted",
    );
    const readback = await f.call(
      target.token,
      "GET",
      "native_recovery_window",
    );
    assert.equal(readback.body.state, "complete");
    assert.equal(
      (await f.call(target.token, "POST", "native_recovery_window")).body.state,
      "complete",
    );
    assert.equal(f.calls.length, 6);
    assert.ok(!JSON.stringify(readback).includes("synthetic-booking-hash"));
  } finally {
    await f.mf.dispose();
  }
});

test("operator residual recovery scopes cleanup to retained bookings and preserves unsafe records", async () => {
  for (const scenario of [
    "unpaid",
    "missing-invoice",
    "paid",
    "wrong-id",
    "wrong-source",
    "revoked",
  ]) {
    const booking = structuredClone(nativeResponses.bookingBefore),
      invoice = structuredClone(nativeResponses.invoiceBefore);
    let target,
      cancellations = 0;
    const f = await fixture({
      full: true,
      secrets: {
        SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
        SOURCE_REVISION: "1".repeat(40),
      },
      respond: async (request, body) => {
        if (body?.method === "getBookingDetails") {
          if (scenario === "missing-invoice") delete booking.invoice_id;
          if (scenario === "revoked")
            await f.db
              .prepare(
                "UPDATE developer_operations SET state='blocked' WHERE capability_hash=?",
              )
              .bind(target.key)
              .run();
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: booking,
          });
        }
        if (new URL(request.url).pathname === "/admin/invoices/901")
          return Response.json(invoice);
        if (body?.method === "cancelBooking") {
          cancellations++;
          booking.status = "cancelled";
          booking.is_confirmed = "0";
          invoice.lines[0].bookings[0].is_confirmed = false;
          return Response.json({ jsonrpc: "2.0", id: body.id, result: true });
        }
      },
    });
    try {
      if (scenario === "paid")
        Object.assign(invoice, {
          status: "paid",
          payment_received: true,
          payment_processor: "hitpay",
        });
      const deadline = Date.now() - 1;
      target = await scheduledAttempt(f, {
        deadline,
        scope: {
          maximumUsed: 16,
          residual: {
            sourceRevision:
              scenario === "wrong-source" ? "f".repeat(40) : "1".repeat(40),
            expectedBookingIds: scenario === "wrong-id" ? ["702"] : ["701"],
          },
        },
      });
      await f.db
        .prepare("UPDATE attempts SET state='recovery_required' WHERE id=?")
        .bind(target.id)
        .run();
      await f.db
        .prepare(
          "INSERT INTO session_effects VALUES(?,'session:0','observed','701')",
        )
        .bind(target.id)
        .run();
      await tick(f);
      assert.equal(
        f.calls.length,
        0,
        "scheduler cannot consume cleanup authority",
      );
      const response = await f.call(
        target.token,
        "POST",
        "native_recovery_window",
      );
      assert.equal(response.status, 200, JSON.stringify(response));
      const readback = await f.call(
        target.token,
        "GET",
        "native_recovery_window",
      );
      assert.equal(
        cancellations,
        scenario === "unpaid" ? 1 : 0,
        JSON.stringify(readback),
      );
      assert.ok(!JSON.stringify(readback).includes("synthetic-booking-hash"));
      if (["wrong-source", "wrong-id"].includes(scenario))
        assert.equal(f.calls.length, 0);
      if (scenario === "missing-invoice") {
        const row = await f.db
          .prepare(
            "SELECT result_json FROM developer_operations WHERE capability_hash=?",
          )
          .bind(target.key)
          .first();
        assert.equal(
          JSON.parse(row.result_json).diagnostic.representation
            .invoiceReference,
          "missing",
        );
      }
      const calls = f.calls.length;
      await f.call(target.token, "POST", "native_recovery_window");
      assert.equal(f.calls.length, calls);
      assert.equal(
        (
          await f.db
            .prepare("SELECT deadline_ms FROM attempts WHERE id=?")
            .bind(target.id)
            .first()
        ).deadline_ms,
        deadline,
      );
    } finally {
      await f.mf.dispose();
    }
  }
});

test("scheduled recovery rejects closed expired future unknown and unsigned windows without provider calls", async () => {
  for (const variant of [
    "closed",
    "expired",
    "future",
    "unknown",
    "unsigned",
    "budget",
  ]) {
    const f = await fixture({
      full: true,
      mode: variant === "closed" ? "disabled" : "trusted-reads",
    });
    try {
      const a = await scheduledAttempt(f, {
        ...(variant === "expired" ? { expires: Date.now() - 1 } : {}),
        ...(variant === "future"
          ? { scope: { notBeforeMs: Date.now() + 60000 } }
          : {}),
        ...(variant === "unknown" ? { state: "running" } : {}),
        ...(variant === "budget"
          ? { scope: { startingUsed: 59, maximumUsed: 65 } }
          : {}),
      });
      await tick(f);
      assert.equal(f.calls.length, 0, variant);
      const grant = await f.db
        .prepare(
          "SELECT state FROM developer_operations WHERE capability_hash=?",
        )
        .bind(a.key)
        .first();
      assert.equal(
        grant.state,
        ["unsigned", "budget"].includes(variant)
          ? "blocked"
          : variant === "unknown"
            ? "running"
            : "granted",
        variant,
      );
    } finally {
      await f.mf.dispose();
    }
  }
});
test("scheduled native recovery preserves conflicting paid evidence for manual review", async () => {
  const f = await fixture({
    full: true,
    secrets: { SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret" },
    respond: (request, body) => {
      if (new URL(request.url).pathname === "/admin/invoices/901")
        return Response.json({
          ...nativeResponses.invoiceAfter,
          client_id: "foreign-customer",
        });
      return nativeReadResponse(request, body);
    },
  });
  try {
    const a = await scheduledAttempt(f);
    await tick(f);
    assert.equal(f.calls.length, 6);
    const row = await f.db
      .prepare(
        "SELECT a.observation_json,r.state FROM attempts a JOIN recovery_work r ON r.attempt_id=a.id WHERE a.id=?",
      )
      .bind(a.id)
      .first();
    assert.equal(row.state, "manual_review");
    assert.equal(row.observation_json, null);
    await tick(f);
    assert.equal(f.calls.length, 6);
  } finally {
    await f.mf.dispose();
  }
});

test("native availability and preparation cross the real HTTP coordinator boundary under a finite grant", async () => {
  const start = Date.now();
  const end = start + 1200000;
  const date = new Date(start + 3 * 86400000).toISOString().slice(0, 10);
  const revision = "c".repeat(40);
  const f = await fixture({
    full: true,
    end,
    secrets: { SOURCE_REVISION: revision },
    respond: (_request, body) => {
      const results = {
        getEventList: {
          2: {
            id: 2,
            name: "Synthetic Session",
            duration: "40",
            is_active: "1",
            is_public: "1",
            is_recurring: "0",
            price: "88",
            currency: "SGD",
            unit_map: [2],
          },
        },
        getUnitList: {
          2: { id: 2, name: "Synthetic Trainer", is_active: "1" },
        },
        getStartTimeMatrix: { [date]: ["10:00:00", "10:50:00"] },
      };
      if (body && Object.hasOwn(results, body.method))
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: results[body.method],
        });
    },
  });
  try {
    await f.sql(
      "INSERT INTO budget(campaign,used) VALUES(?,15)",
      config.vars.CAMPAIGN_ID,
    );
    const guest = await f.mf.dispatchFetch(origin + "/api/access", {
      method: "POST",
      headers: { origin },
    });
    assert.equal(guest.status, 201);
    const cookie = guest.headers.get("set-cookie").split(";")[0];
    const hash = createHash("sha256")
      .update(cookie.split("=")[1])
      .digest("hex");
    const contract = {
      accountId: config.vars.DEPLOYMENT_ACCOUNT_ID,
      environmentId: "developer",
      companyLogin: "synthetic-developer",
      serviceId: "2",
      priceMinor: 8800,
      currency: "SGD",
      taxMinor: 0,
      durationMinutes: 40,
      bufferAfterMinutes: 10,
      clientLoginRequired: false,
      providerSchedules: "non-overlapping",
      confirmedAtMs: start,
      expiresAtMs: end,
    };
    await f.db
      .prepare(
        "INSERT INTO native_checkout_grants(capability_hash,source_revision,contract_json,not_before_ms,expires_ms,starting_used,maximum_used,cleanup_allowed,state,available_dates_json) VALUES(?,?,?,?,?,15,64,1,'granted',?)",
      )
      .bind(
        hash,
        revision,
        JSON.stringify(contract),
        start,
        end,
        JSON.stringify([date]),
      )
      .run();
    await f.db
      .prepare(
        "UPDATE native_checkout_grants SET contract_json=? WHERE capability_hash=?",
      )
      .bind(
        JSON.stringify({ ...contract, companyLogin: "synthetic-foreign" }),
        hash,
      )
      .run();
    const rejected = await f.mf.dispatchFetch(
      origin + "/api/booking/availability/2/" + date,
      { headers: { origin, cookie } },
    );
    const rejectedBody = await rejected.json();
    assert.equal(rejected.status, 503);
    assert.deepEqual(rejectedBody, {
      error: "native_account_contract_unavailable",
    });
    assert.equal(f.calls.length, 0);
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT read_state FROM native_checkout_grants WHERE capability_hash=?",
          )
          .bind(hash)
          .first()
      ).read_state,
      "available",
    );
    await f.db
      .prepare(
        "UPDATE native_checkout_grants SET contract_json=? WHERE capability_hash=?",
      )
      .bind(JSON.stringify(contract), hash)
      .run();
    const response = await f.mf.dispatchFetch(
      origin + "/api/booking/availability/2/" + date,
      { headers: { origin, cookie } },
    );
    const availability = await response.json();
    assert.equal(
      response.status,
      200,
      JSON.stringify({ availability, logs: f.logs }),
    );
    assert.equal(availability.offers.length, 2);
    const before = f.calls.length;
    const selection = {
      key: crypto.randomUUID(),
      accepted: true,
      contact: {
        name: "Synthetic Guest",
        email: "guest@example.com",
        phone: "00000000",
        contactMethod: "email",
        academy: "Synthetic school",
      },
      sessions: availability.offers.map((offer, index) => ({
        serviceId: offer.serviceId,
        instructorId: offer.instructorId,
        startMs: offer.startMs,
        players: index ? 4 : 1,
        totalMinor: 8800,
      })),
    };
    const prepared = await f.mf.dispatchFetch(origin + "/api/booking/prepare", {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify(selection),
    });
    const result = await prepared.json();
    assert.equal(prepared.status, 201, JSON.stringify(result));
    assert.equal(result.state, "prepared");
    assert.equal(f.calls.length, before);
    const checkout = await f.mf.dispatchFetch(
      origin + "/api/booking/native/" + result.attemptId,
      { method: "POST", headers: { origin, cookie } },
    );
    assert.equal(checkout.status, 503);
    assert.deepEqual(await checkout.json(), {
      error: "native_signing_unavailable",
    });
    assert.equal(f.calls.length, before);
    await f.db.exec("DROP TABLE native_checkout_grants");
    const unknown = await f.mf.dispatchFetch(
      origin + "/api/booking/availability/2/" + date,
      { headers: { origin, cookie } },
    );
    assert.equal(unknown.status, 503);
    assert.deepEqual(await unknown.json(), {
      error: "temporarily_unavailable",
    });
    assert.equal(f.calls.length, before);
  } finally {
    await f.mf.dispose();
  }
});
