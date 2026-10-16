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
        calls.push({ url: request.url, method: request.method, body });
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
test("failed provider authentication releases concurrency without replay or budget refund", async () => {
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
    assert.equal(r.body.result.accounting.active, 0);
    assert.equal((await f.call(token)).body.state, "blocked");
    assert.equal(f.calls.length, 1);
    assert.deepEqual(await f.sql("SELECT reason FROM admission_releases"), [
      { reason: "read_transport_ended" },
    ]);
    await f.mf.unsafeEvictDurableObject(
      "provider-test",
      "SoccerBotAccountCoordinator",
      { name: "simplybook-developer-account" },
    );
    assert.equal(
      (await f.sql("SELECT count(*) n FROM admissions WHERE finished=0"))[0].n,
      0,
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

async function calendarFixture({
  matrix,
  scopeChanges = {},
  used = 373,
  ...options
} = {}) {
  const from = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(from) + 14 * 86400000)
    .toISOString()
    .slice(0, 10);
  const scope = {
    kind: "native-calendar",
    sourceRevision: "c".repeat(40),
    accountId: config.vars.DEPLOYMENT_ACCOUNT_ID,
    serviceId: "2",
    instructorId: "3",
    from,
    to,
    startingUsed: used,
    maxCalls: 6,
    ...scopeChanges,
  };
  const f = await fixture({
    ...options,
    secrets: { SOURCE_REVISION: "c".repeat(40), PROVIDER_CALL_CEILING: "512" },
    respond: async (request, body) => {
      if (new URL(request.url).pathname === "/") {
        assert.equal(body.method, "getStartTimeMatrix");
        assert.deepEqual(body.params, [from, to, 2, 3, 1]);
        return Response.json({
          id: body.id,
          result: matrix
            ? matrix(from, to)
            : { [from]: ["10:40:00", "09:00:00"], [to]: [] },
          error: null,
        });
      }
    },
  });
  await f.sql(
    "INSERT OR REPLACE INTO budget(campaign,used,cooldown_ms) VALUES('developer-20261008',?,0)",
    used,
  );
  const token = await f.grant(Date.now() + 120000, discoveryOperation);
  await f.db
    .prepare(
      "UPDATE developer_operations SET result_json=? WHERE capability_hash=?",
    )
    .bind(
      JSON.stringify(scope),
      createHash("sha256").update(token).digest("hex"),
    )
    .run();
  return { ...f, token, scope };
}
test("calendar probe binds source account range and carried budget and never replays", async () => {
  const f = await calendarFixture();
  try {
    const r = await f.call(f.token, "POST", discoveryOperation);
    assert.equal(r.body.state, "complete");
    assert.deepEqual(r.body.result.dates, [
      { date: f.scope.from, starts: ["09:00:00", "10:40:00"] },
    ]);
    assert.deepEqual(r.body.result.accounting, {
      used: 378,
      active: 0,
      ceiling: 512,
      recoveryReserve: 16,
    });
    assert.equal(f.calls.length, 5);
    assert.deepEqual(
      (await f.call(f.token, "POST", discoveryOperation)).body.result,
      r.body.result,
    );
    assert.equal(f.calls.length, 5);
    assert.doesNotMatch(
      JSON.stringify(r),
      /synthetic-public-secret|synthetic-admin-secret|must-not-escape/,
    );
  } finally {
    await f.mf.dispose();
  }
});
test("calendar probe rejects foreign stale overbroad and recovery-reserve scopes before dispatch", async () => {
  for (const options of [
    { scopeChanges: { sourceRevision: "d".repeat(40) } },
    { scopeChanges: { accountId: "foreign" } },
    { scopeChanges: { startingUsed: 372 } },
    { scopeChanges: { from: "2026-02-30" } },
    { scopeChanges: { from: "2020-01-01" } },
    { scopeChanges: { to: "2099-01-01" } },
    { scopeChanges: { serviceId: "3" } },
    { scopeChanges: { maxCalls: 7 } },
    { scopeChanges: { extra: true } },
    { used: 491 },
  ]) {
    const f = await calendarFixture(options);
    try {
      assert.equal(
        (await f.call(f.token, "POST", discoveryOperation)).body.state,
        "blocked",
      );
      assert.equal(f.calls.length, 0);
      await f.call(f.token, "POST", discoveryOperation);
      assert.equal(f.calls.length, 0);
    } finally {
      await f.mf.dispose();
    }
  }
});
test("calendar probe rejects malformed out-of-range duplicate and invalid times without replay", async () => {
  for (const matrix of [
    () => [],
    () => ({ "2099-01-01": ["09:00:00"] }),
    (from) => ({ [from]: { starts: ["09:00:00"] } }),
    (from) => ({ [from]: ["09:00:00", "09:00:00"] }),
    (from) => ({ [from]: ["24:00:00"] }),
    (from) => ({ [from]: ["09:00:01"] }),
  ]) {
    const f = await calendarFixture({ matrix });
    try {
      const r = await f.call(f.token, "POST", discoveryOperation);
      assert.equal(r.body.state, "blocked");
      assert.equal(r.body.result.accounting.used, 378);
      assert.equal(Object.hasOwn(r.body.result, "dates"), false);
      await f.call(f.token, "POST", discoveryOperation);
      assert.equal(f.calls.length, 5);
    } finally {
      await f.mf.dispose();
    }
  }
});

async function setupFixture({
  mutateHours,
  mutateHooks,
  scopeChanges = {},
} = {}) {
  const from = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(from) + 86400000).toISOString().slice(0, 10);
  let layer = 0;
  const f = await fixture({
    secrets: { SOURCE_REVISION: "c".repeat(40), PROVIDER_CALL_CEILING: "512" },
    respond: async (request, body) => {
      const url = new URL(request.url);
      if (url.pathname === "/") {
        assert.equal(body.method, "getWorkDaysInfo");
        assert.equal(request.headers.get("X-Token"), "synthetic-public-token");
        const [instructor, service] = [
          [null, null],
          [null, 2],
          [3, null],
          [3, 2],
        ][layer++];
        assert.deepEqual(body.params, [from, to, instructor, service, 1]);
        const hours = {
          [from]: [
            {
              from: "09:00:00",
              to: "24:00:00",
              privateValue: "must-not-escape",
            },
          ],
          [to]: [],
        };
        return Response.json({
          id: body.id,
          result: mutateHours ? mutateHours(hours) : hours,
          error: null,
        });
      }
      if (url.pathname === "/admin/webhooks") {
        assert.equal(request.method, "GET");
        assert.equal(url.search, "");
        assert.equal(request.headers.get("X-Token"), "synthetic-admin-token");
        const hooks = [
          {
            id: 5,
            event: "new_invoice",
            is_active: 1,
            url: "https://example.test/must-not-escape",
            privateValue: "must-not-escape",
          },
        ];
        return Response.json(mutateHooks ? mutateHooks(hooks) : hooks);
      }
    },
  });
  await f.sql(
    "INSERT OR REPLACE INTO budget(campaign,used,cooldown_ms) VALUES('developer-20261008',378,0)",
  );
  const token = await f.grant(Date.now() + 120000, discoveryOperation);
  const scope = {
    kind: "native-setup",
    sourceRevision: "c".repeat(40),
    accountId: config.vars.DEPLOYMENT_ACCOUNT_ID,
    serviceId: "2",
    instructorId: "3",
    from,
    to,
    startingUsed: 378,
    maxCalls: 16,
    ...scopeChanges,
  };
  await f.db
    .prepare(
      "UPDATE developer_operations SET result_json=? WHERE capability_hash=?",
    )
    .bind(
      JSON.stringify(scope),
      createHash("sha256").update(token).digest("hex"),
    )
    .run();
  return { ...f, token, scope };
}
test("native setup reads exact working-hour layers and subscription metadata once without leaking destinations", async () => {
  const f = await setupFixture();
  try {
    const r = await f.call(f.token, "POST", discoveryOperation);
    assert.equal(r.body.state, "complete", JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body.result.hours), [
      "company",
      "service",
      "instructor",
      "combined",
    ]);
    assert.equal(r.body.result.hours.combined[f.scope.from][0].to, "24:00:00");
    assert.deepEqual(r.body.result.subscriptions, [
      {
        id: "5",
        event: "new_invoice",
        active: true,
        destinationSha256: createHash("sha256")
          .update("https://example.test/must-not-escape")
          .digest("hex"),
      },
    ]);
    assert.equal(r.body.result.accounting.used, 387);
    assert.equal(f.calls.length, 9);
    assert.doesNotMatch(
      JSON.stringify(r),
      /must-not-escape|synthetic-admin-secret|synthetic-public-secret/,
    );
    await f.call(f.token, "POST", discoveryOperation);
    assert.equal(f.calls.length, 9);
  } finally {
    await f.mf.dispose();
  }
});
test("native setup rejects changed authority and ranges before any provider request", async () => {
  for (const scopeChanges of [
    { maxCalls: 6 },
    { startingUsed: 377 },
    { sourceRevision: "d".repeat(40) },
    { to: "2099-01-01" },
    { instructorId: "4" },
  ]) {
    const f = await setupFixture({ scopeChanges });
    try {
      assert.equal(
        (await f.call(f.token, "POST", discoveryOperation)).body.state,
        "blocked",
      );
      assert.equal(f.calls.length, 0);
    } finally {
      await f.mf.dispose();
    }
  }
});
function assertPrivateSetupDiagnostics(response) {
  // Check the provider fixture values, including the complete invalid date.
  // A random correlation UUID can legitimately contain the digits 2099.
  assert.doesNotMatch(
    JSON.stringify(response),
    /must-not-escape|payment_settled|2099-01-01/,
  );
}
test("native setup diagnostic privacy rejects fixture values without matching UUID digits", () => {
  const response = {
    status: 200,
    body: { state: "blocked", result: { verified: false } },
    correlationId: "15adaa49-33fa-465e-8cf7-92099fdd65e2",
  };
  assert.doesNotThrow(() => assertPrivateSetupDiagnostics(response));
  for (const value of [
    "https://example.test/must-not-escape",
    "payment_settled",
    "2099-01-01",
  ]) {
    assert.throws(
      () => assertPrivateSetupDiagnostics({ ...response, leaked: value }),
      assert.AssertionError,
    );
    assert.throws(
      () =>
        assertPrivateSetupDiagnostics({
          ...response,
          body: { [value]: [] },
        }),
      assert.AssertionError,
    );
  }
});
test("native setup rejects unknown subscription envelopes and malformed hours with bounded private diagnostics", async () => {
  for (const options of [
    { mutateHours: () => ({ "2099-01-01": [] }) },
    {
      mutateHours: (hours) => ({
        [Object.keys(hours)[0]]: [{ from: "24:00:00", to: "24:00:00" }],
      }),
    },
    { mutateHooks: (hooks) => ({ data: hooks }) },
    { mutateHooks: (hooks) => [...hooks, ...hooks] },
    { mutateHooks: (hooks) => [{ ...hooks[0], event: "payment_settled" }] },
  ]) {
    const f = await setupFixture(options);
    try {
      const r = await f.call(f.token, "POST", discoveryOperation);
      assert.equal(r.body.state, "blocked");
      assert.equal(r.body.result.verified, false);
      assert.ok(r.body.result.stage);
      assert.equal(Object.hasOwn(r.body.result, "hours"), false);
      assert.equal(Object.hasOwn(r.body.result, "subscriptions"), false);
      assertPrivateSetupDiagnostics(r);
      const calls = f.calls.length;
      await f.call(f.token, "POST", discoveryOperation);
      assert.equal(f.calls.length, calls);
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
test("discovery failed read releases concurrency but remains counted across eviction and cannot replay", async () => {
  const f = await discoveryFixture({ respond: () => new Promise(() => {}) });
  try {
    const token = await f.grant(Date.now() + 180000, discoveryOperation);
    const result = await f.call(token, "POST", discoveryOperation);
    assert.equal(result.body.state, "blocked");
    assert.equal(result.body.result.reason, "provider_transport_uncertain");
    assert.equal(result.body.result.accounting.used, 9);
    assert.equal(result.body.result.accounting.active, 0);
    await f.mf.unsafeEvictDurableObject(
      "provider-test",
      "SoccerBotAccountCoordinator",
      { name: "simplybook-developer-account" },
    );
    const retained = await f.call(token, "GET", discoveryOperation);
    assert.equal(retained.body.accounting.used, 9);
    assert.equal(retained.body.accounting.active, 0);
    await f.call(token, "POST", discoveryOperation);
    const other = await f.grant(Date.now() + 60000, discoveryOperation);
    assert.equal(
      (await f.call(other, "POST", discoveryOperation)).body.result.reason,
      "discovery_accounting_changed",
    );
    assert.equal(f.calls.length, 1);
    const releases = await f.sql("SELECT reason FROM admission_releases");
    assert.deepEqual(releases, [{ reason: "read_transport_ended" }]);
    assert.equal((await f.sql("SELECT count(*) n FROM admissions"))[0].n, 1);
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
      options.unassociated
        ? null
        : JSON.stringify({ bookingIds: ["701"], invoiceId: "901" }),
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
async function ongoingAttempt(f, options = {}) {
  const a = await scheduledAttempt(f, options);
  const row = await f.db
    .prepare("SELECT * FROM attempts WHERE id=?")
    .bind(a.id)
    .first();
  const now = Date.now();
  await f.db
    .prepare("INSERT INTO guest_access VALUES(?,?,?,?,NULL)")
    .bind(a.key, row.owner_id, now - 600000, now - 1000)
    .run();
  await f.db
    .prepare(
      "INSERT INTO native_checkout_grants(attempt_id,capability_hash,intent_hash,source_revision,contract_json,not_before_ms,expires_ms,starting_used,maximum_used,state,ongoing) VALUES(?,?,?,?,?, ?,?,0,30,'complete',?)",
    )
    .bind(
      a.id,
      a.key,
      row.intent_hash,
      "a".repeat(40),
      "{}",
      now - 600000,
      now + 600000,
      options.finite ? 0 : 1,
    )
    .run();
  return a;
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

test("ongoing readback confirms known checkout after campaign closure and deduplicates scheduled events", async () => {
  const f = await fixture({
    full: true,
    end: 0,
    respond: nativeReadResponse,
    secrets: {
      SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
      LIVE_CUSTOMER_ACCESS: "enabled",
      SOURCE_REVISION: "a".repeat(40),
      LIVE_READBACK: "enabled",
    },
  });
  try {
    const a = await ongoingAttempt(f);
    await Promise.all([tick(f), tick(f)]);
    assert.equal(f.calls.length, 6);
    const row = await f.db
      .prepare("SELECT state,tries FROM recovery_work WHERE attempt_id=?")
      .bind(a.id)
      .first();
    assert.deepEqual(row, { state: "complete", tries: 1 });
    const attempt = await f.db
      .prepare("SELECT observation_json FROM attempts WHERE id=?")
      .bind(a.id)
      .first();
    assert.equal(JSON.parse(attempt.observation_json).invoice.status, "paid");
    await tick(f);
    assert.equal(f.calls.length, 6);
    assert.equal(
      (
        await f.mf.dispatchFetch(
          origin + "/api/attempts/" + a.id + "/confirmation",
        )
      ).status,
      401,
    );
  } finally {
    await f.mf.dispose();
  }
});

test("ongoing readback excludes finite unassociated expired and exhausted attempts", async () => {
  const f = await fixture({
    full: true,
    end: 0,
    respond: nativeReadResponse,
    secrets: {
      SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
      LIVE_CUSTOMER_ACCESS: "enabled",
      SOURCE_REVISION: "a".repeat(40),
      LIVE_READBACK: "enabled",
    },
  });
  try {
    const plan = await f.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT attempt_id FROM native_checkout_grants INDEXED BY native_checkout_ongoing_expiry WHERE ongoing=1 AND expires_ms>?",
      )
      .bind(Date.now())
      .all();
    assert.ok(
      plan.results.some((row) =>
        /COVERING INDEX native_checkout_ongoing_expiry.*ongoing=.*expires_ms>/.test(
          row.detail,
        ),
      ),
    );
    await ongoingAttempt(f, { finite: true });
    await ongoingAttempt(f, { unassociated: true });
    await ongoingAttempt(f, { deadline: Date.now() - 1 });
    const exhausted = await ongoingAttempt(f);
    await f.db
      .prepare("UPDATE recovery_work SET tries=5 WHERE attempt_id=?")
      .bind(exhausted.id)
      .run();
    const recent = await ongoingAttempt(f);
    await f.db
      .prepare(
        "UPDATE recovery_work SET tries=1,updated_ms=? WHERE attempt_id=?",
      )
      .bind(Date.now(), recent.id)
      .run();
    await tick(f);
    assert.equal(f.calls.length, 0);
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT COUNT(*) n FROM attempts WHERE observation_json IS NOT NULL",
          )
          .first()
      ).n,
      0,
    );
  } finally {
    await f.mf.dispose();
  }
});

test("ongoing readback is disabled without explicit release flag", async () => {
  const f = await fixture({
    full: true,
    end: 0,
    respond: nativeReadResponse,
    secrets: {
      SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
      LIVE_CUSTOMER_ACCESS: "enabled",
      SOURCE_REVISION: "a".repeat(40),
    },
  });
  try {
    await ongoingAttempt(f);
    await tick(f);
    assert.equal(f.calls.length, 0);
  } finally {
    await f.mf.dispose();
  }
});

test("ongoing readback retains unpaid evidence and stops after five bounded tries", async () => {
  const methods = [];
  const f = await fixture({
    full: true,
    end: 0,
    secrets: {
      SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
      LIVE_CUSTOMER_ACCESS: "enabled",
      LIVE_READBACK: "enabled",
      SOURCE_REVISION: "a".repeat(40),
    },
    respond: (request, body) => {
      if (body?.method) methods.push(body.method);
      if (body?.method === "getBookingDetails")
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: nativeResponses.bookingBefore,
        });
      if (new URL(request.url).pathname === "/admin/invoices/901")
        return Response.json(nativeResponses.invoiceBefore);
    },
  });
  try {
    const a = await ongoingAttempt(f);
    for (let n = 1; n <= 5; n++) {
      await tick(f);
      const row = await f.db
        .prepare("SELECT state,tries FROM recovery_work WHERE attempt_id=?")
        .bind(a.id)
        .first();
      assert.equal(row.tries, n);
      assert.equal(row.state, n === 5 ? "manual_review" : "due");
      const count = f.calls.length;
      await tick(f);
      assert.equal(f.calls.length, count);
      if (n < 5)
        await f.db
          .prepare(
            "UPDATE recovery_work SET ready_ms=0,updated_ms=? WHERE attempt_id=?",
          )
          .bind(Date.now() - 90001, a.id)
          .run();
    }
    const row = await f.db
      .prepare("SELECT observation_json FROM attempts WHERE id=?")
      .bind(a.id)
      .first();
    assert.notEqual(JSON.parse(row.observation_json).invoice.status, "paid");
    assert.ok(f.calls.length <= 30);
    assert.ok(
      methods.every((method) => !["book", "cancelBooking"].includes(method)),
    );
  } finally {
    await f.mf.dispose();
  }
});

test("ongoing readback accounts failed provider setup without duplicate automatic dispatch", async () => {
  const f = await fixture({
    full: true,
    end: 0,
    secrets: {
      LIVE_CUSTOMER_ACCESS: "enabled",
      LIVE_READBACK: "enabled",
      SOURCE_REVISION: "a".repeat(40),
      SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
    },
    respond: () => new Response("unavailable", { status: 503 }),
  });
  try {
    const a = await ongoingAttempt(f);
    await Promise.all([tick(f), tick(f)]);
    assert.equal(f.calls.length, 1);
    const row = await f.db
      .prepare("SELECT state,tries FROM recovery_work WHERE attempt_id=?")
      .bind(a.id)
      .first();
    assert.equal(row.tries, 1);
    assert.equal(row.state, "due");
    await tick(f);
    assert.equal(f.calls.length, 1);
  } finally {
    await f.mf.dispose();
  }
});

test("ongoing readback gives cold setup a separate bounded window before evidence reads", async () => {
  const f = await fixture({
    full: true,
    end: 0,
    secrets: {
      LIVE_CUSTOMER_ACCESS: "enabled",
      LIVE_READBACK: "enabled",
      SOURCE_REVISION: "a".repeat(40),
      SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
    },
    respond: async (request, body) => {
      // Deliberately cross the evidence-only five-second window during setup.
      if (new URL(request.url).pathname === "/login")
        await new Promise((resolve) => setTimeout(resolve, 5100));
      return nativeReadResponse(request, body);
    },
  });
  try {
    const a = await ongoingAttempt(f);
    await tick(f);
    assert.deepEqual(
      await f.db
        .prepare("SELECT state,tries FROM recovery_work WHERE attempt_id=?")
        .bind(a.id)
        .first(),
      { state: "complete", tries: 1 },
    );
    assert.equal(f.calls.length, 6);
  } finally {
    await f.mf.dispose();
  }
});

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

test("scheduled recovery admits carried counters through the configured ceiling without resetting or replay", async () => {
  for (const ceiling of [224, 256, 512, 704]) {
    const used = ceiling === 704 ? 567 : ceiling === 512 ? 378 : 196;
    const f = await fixture({
      full: true,
      respond: nativeReadResponse,
      secrets: {
        SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
        PROVIDER_CALL_CEILING: String(ceiling),
      },
    });
    try {
      await f.sql(
        "INSERT INTO budget(campaign,used) VALUES('developer-20261008',?)",
        used,
      );
      const a = await scheduledAttempt(f, {
        scope: { startingUsed: used, maximumUsed: used + 6 },
      });
      await Promise.all([tick(f), tick(f)]);
      const grant = await f.db
        .prepare(
          "SELECT state FROM developer_operations WHERE capability_hash=?",
        )
        .bind(a.key)
        .first();
      assert.equal(grant.state, "complete");
      assert.equal(f.calls.length, 6);
      assert.equal((await f.sql("SELECT used FROM budget"))[0].used, used + 6);
      const observation = await f.db
        .prepare("SELECT observation_json FROM attempts WHERE id=?")
        .bind(a.id)
        .first();
      assert.equal(
        JSON.parse(observation.observation_json).invoice.status,
        "paid",
      );
      await tick(f);
      assert.equal(f.calls.length, 6);
    } finally {
      await f.mf.dispose();
    }
  }
});
test("scheduled recovery at carried512 keeps ordinary reserve scope and global ceiling fences", async () => {
  for (const entry of [
    { used: 490, max: 496, allowed: true },
    { used: 491, max: 497, allowed: false },
    { used: 506, max: 512, reserve: true, allowed: true },
    { used: 506, max: 513, reserve: true, allowed: false },
    { used: 378, max: 409, allowed: false },
    { used: 495, max: 512, reserve: true, allowed: false },
    { used: 378, start: 379, max: 385, allowed: false },
    { used: 378, max: 383, allowed: false },
  ]) {
    const f = await fixture({
      full: true,
      respond: nativeReadResponse,
      secrets: {
        SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
        PROVIDER_CALL_CEILING: "512",
      },
    });
    try {
      await f.sql(
        "INSERT INTO budget(campaign,used) VALUES('developer-20261008',?)",
        entry.used,
      );
      const a = await scheduledAttempt(f, {
        scope: {
          startingUsed: entry.start ?? entry.used,
          maximumUsed: entry.max,
          ...(entry.reserve ? { useRecoveryReserve: true } : {}),
        },
      });
      await tick(f);
      const grant = await f.db
        .prepare(
          "SELECT state FROM developer_operations WHERE capability_hash=?",
        )
        .bind(a.key)
        .first();
      assert.equal(grant.state, entry.allowed ? "complete" : "blocked");
      assert.equal(f.calls.length, entry.allowed ? 6 : 0);
      assert.equal(
        (await f.sql("SELECT used FROM budget"))[0].used,
        entry.used + (entry.allowed ? 6 : 0),
      );
      await tick(f);
      assert.equal(f.calls.length, entry.allowed ? 6 : 0);
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

test("operator inspection reads one retained booking under the carried192 ledger without invoice cleanup scheduler or replay", async () => {
  for (const scenario of [
    "inspect",
    "wrong-id",
    "wrong-source",
    "revoked",
    "stale-attempt",
  ]) {
    const booking = structuredClone(nativeResponses.bookingBefore);
    delete booking.invoice_id;
    booking.end_date_time = "2026-10-10 09:40:00";
    booking.event_price = "private-price-marker";
    let target;
    const methods = [];
    const f = await fixture({
      full: true,
      secrets: {
        SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
        SOURCE_REVISION: "1".repeat(40),
        PROVIDER_CALL_CEILING: "192",
      },
      respond: async (_request, body) => {
        if (body?.method === "getBookingDetails") {
          methods.push(body.method);
          assert.equal(String(body.params[0]), "701");
          if (scenario === "revoked")
            await f.db
              .prepare(
                "UPDATE developer_operations SET state='blocked' WHERE capability_hash=?",
              )
              .bind(target.key)
              .run();
          if (scenario === "stale-attempt")
            await f.db
              .prepare("UPDATE attempts SET version=version+1 WHERE id=?")
              .bind(target.id)
              .run();
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: booking,
          });
        }
      },
    });
    try {
      await f.sql(
        "INSERT INTO budget(campaign,used) VALUES(?,125)",
        config.vars.CAMPAIGN_ID,
      );
      target = await scheduledAttempt(f, {
        unassociated: true,
        deadline: Date.now() - 1,
        scope: {
          startingUsed: 125,
          maximumUsed: 131,
          residual: {
            mode: "inspect",
            sourceRevision: (scenario === "wrong-source" ? "f" : "1").repeat(
              40,
            ),
            expectedBookingIds: [scenario === "wrong-id" ? "702" : "701"],
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
      const before = await f.db
        .prepare("SELECT * FROM attempts WHERE id=?")
        .bind(target.id)
        .first();
      await tick(f);
      assert.equal(f.calls.length, 0, "scheduler must not claim inspection");
      await Promise.all([
        f.call(target.token, "POST", "native_recovery_window"),
        f.call(target.token, "POST", "native_recovery_window"),
      ]);
      const saved = await f.db
        .prepare(
          "SELECT state,result_json FROM developer_operations WHERE capability_hash=?",
        )
        .bind(target.key)
        .first();
      const result = JSON.parse(saved.result_json);
      if (scenario === "inspect") {
        assert.equal(result.state, "inspected", JSON.stringify(saved));
        assert.equal(result.inspection.endInterval, "play");
        assert.equal(
          result.inspection.fields["booking.end_date_time"].result,
          "mismatch",
        );
        assert.equal(
          result.inspection.fields["booking.event_price"].result,
          "malformed",
        );
        assert.equal(f.calls.length, 5);
        assert.deepEqual(
          await f.db
            .prepare("SELECT * FROM attempts WHERE id=?")
            .bind(target.id)
            .first(),
          before,
        );
      } else assert.notEqual(result.state, "inspected");
      if (["wrong-id", "wrong-source"].includes(scenario))
        assert.equal(f.calls.length, 0);
      else assert.deepEqual(methods, ["getBookingDetails"]);
      assert.ok(f.calls.every((c) => !c.url.includes("invoices")));
      assert.doesNotMatch(
        saved.result_json,
        /private-price-marker|synthetic-booking-hash|synthetic-signing-secret/,
      );
      const count = f.calls.length;
      await f.call(target.token, "POST", "native_recovery_window");
      assert.equal(f.calls.length, count);
      const budget = await f.sql(
        "SELECT used FROM budget WHERE campaign=?",
        config.vars.CAMPAIGN_ID,
      );
      assert.equal(budget[0].used, 125 + count);
    } finally {
      await f.mf.dispose();
    }
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

test("inspection window serves session catalogue and cached times without granting a booking", async () => {
  const start = Date.now(),
    end = start + 600000,
    revision = "d".repeat(40);
  const date = new Date(start + 4 * 86400000).toISOString().slice(0, 10),
    month = date.slice(0, 7);
  let starts = ["13:00:00"];
  const f = await fixture({
    full: true,
    end,
    secrets: {
      SOURCE_REVISION: revision,
      PROVIDER_CALL_CEILING: "1024",
      PUBLIC_CALENDAR_WINDOW_JSON: JSON.stringify({
        sourceRevision: revision,
        serviceId: "2",
        dates: [date],
        notBeforeMs: start,
        expiresMs: end,
        startingUsed: 655,
        maximumUsed: 675,
      }),
    },
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
        getStartTimeMatrix: { [date]: starts },
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
      "INSERT INTO budget(campaign,used) VALUES(?,655)",
      config.vars.CAMPAIGN_ID,
    );
    const publicRead = await f.mf.dispatchFetch(
      origin + "/api/calendar/" + month,
    );
    assert.equal(publicRead.status, 200);
    assert.equal(publicRead.headers.get("set-cookie"), null);
    assert.deepEqual((await publicRead.json()).dates, [
      { date, available: true },
    ]);
    const before = f.calls.length;
    for (const route of [
      "/api/catalogue",
      "/api/booking/calendar/2/" + month,
      "/api/booking/availability/2/" + date,
    ])
      assert.equal((await f.mf.dispatchFetch(origin + route)).status, 401);
    const guest = await f.mf.dispatchFetch(origin + "/api/access", {
      method: "POST",
      headers: { origin },
    });
    assert.equal(guest.status, 201);
    const cookie = guest.headers.get("set-cookie").split(";")[0];
    const read = (path) =>
      f.mf.dispatchFetch(origin + path, { headers: { cookie } });
    const catalogue = await read("/api/catalogue");
    assert.equal(catalogue.status, 200);
    assert.equal((await catalogue.json()).services[0].priceMinor, 8800);
    const calendar = await read("/api/booking/calendar/2/" + month);
    assert.equal(calendar.status, 200);
    const offers = (await calendar.json()).dates[0].offers;
    assert.equal(offers.length, 1);
    assert.equal(
      (await read("/api/booking/availability/2/" + date)).status,
      200,
    );
    assert.equal(
      f.calls.length,
      before,
      "homepage cache is reused after selecting players",
    );
    starts = [];
    const fresh = await read(
      "/api/booking/availability/2/" + date + "?refresh=1",
    );
    assert.equal(fresh.status, 200, JSON.stringify(await fresh.clone().json()));
    assert.deepEqual((await fresh.json()).offers, []);
    assert.ok(f.calls.length > before);
    const updated = await f.mf.dispatchFetch(origin + "/api/calendar/" + month);
    assert.deepEqual((await updated.json()).dates, [
      { date, available: false },
    ]);
    const counted = f.calls.length;
    assert.equal((await read("/api/booking/calendar/99/" + month)).status, 503);
    assert.equal(f.calls.length, counted);
    const prepared = await f.mf.dispatchFetch(origin + "/api/booking/prepare", {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({
        key: crypto.randomUUID(),
        accepted: true,
        contact: {
          name: "Synthetic Guest",
          email: "guest@example.com",
          phone: "00000000",
          contactMethod: "email",
          academy: "Synthetic school",
        },
        sessions: offers.map((offer) => ({
          serviceId: offer.serviceId,
          instructorId: offer.instructorId,
          startMs: offer.startMs,
          players: 1,
          totalMinor: 8800,
        })),
      }),
    });
    assert.equal(prepared.status, 503);
    assert.equal(
      (await prepared.json()).error,
      "native_customer_window_unavailable",
    );
    assert.equal(
      (
        await f.db
          .prepare("SELECT COUNT(*) n FROM native_checkout_grants")
          .first()
      ).n,
      0,
    );
    assert.equal(
      (await f.db.prepare("SELECT COUNT(*) n FROM attempts").first()).n,
      0,
    );
    assert.equal(f.calls.length, counted);
    await f.sql(
      "UPDATE budget SET used=675 WHERE campaign=?",
      config.vars.CAMPAIGN_ID,
    );
    const exhausted = await read(
      "/api/booking/availability/2/" + date + "?refresh=1",
    );
    assert.equal(exhausted.status, 503);
    assert.equal(f.calls.length, counted);
  } finally {
    await f.mf.dispose();
  }
});

test("ongoing customer access survives campaign closure and preserves fresh consent and booking replay guards", async () => {
  const date = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const startMs = Date.parse(date + "T13:00:00+08:00");
  const samples = JSON.parse(
    readFileSync("worker/tests/native-fixtures.json", "utf8"),
  ).responses;
  const creation = samples.creation,
    booking = samples.bookingBefore,
    invoice = samples.invoiceBefore;
  for (const row of [booking, creation.bookings[0]]) {
    row.event_id = "2";
    row.unit_id = "2";
    row.start_date_time = date + " 13:00:00";
    row.end_date_time = date + " 13:50:00";
  }
  creation.bookings[0].client_hash = "synthetic-client-hash";
  for (const value of [invoice, creation.invoice]) {
    const row = value.lines[0].bookings[0];
    row.service_id = 2;
    row.provider_id = 2;
    row.start_datetime = date + " 13:00:00";
    row.end_datetime = date + " 13:50:00";
  }
  invoice.due_datetime = new Date(Date.now() + 1200000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  let available = true,
    books = 0;
  const f = await fixture({
    full: true,
    end: 0,
    secrets: {
      SOURCE_REVISION: "d".repeat(40),
      LIVE_CUSTOMER_ACCESS: "enabled",
      SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
    },
    respond: (request, body) => {
      if (request.url.endsWith("/admin/invoices/901/payment-link"))
        return Response.json({
          link: "https://soccerbotstudiosg.simplybook.asia/v2/client/pay-later/id/synthetic-id/hash/synthetic-hash",
        });
      if (request.url.endsWith("/admin/invoices/901"))
        return Response.json(invoice);
      if (!body) return;
      const matrix = {};
      if (body.method === "getStartTimeMatrix")
        for (
          let day = new Date(body.params[0] + "T00:00:00Z");
          day.toISOString().slice(0, 10) <= body.params[1];
          day.setUTCDate(day.getUTCDate() + 1)
        ) {
          const key = day.toISOString().slice(0, 10);
          matrix[key] = key === date && available ? ["13:00:00"] : [];
        }
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
        getStartTimeMatrix: matrix,
        getAdditionalFields: [],
        getAvailableUnits: [2],
        book: creation,
        getBookingDetails: booking,
      };
      if (body.method === "book") books++;
      if (Object.hasOwn(results, body.method))
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: results[body.method],
        });
    },
  });
  try {
    await f.sql(
      "INSERT INTO budget(campaign,used) VALUES(?,2000)",
      config.vars.CAMPAIGN_ID,
    );
    const home = await f.mf.dispatchFetch(
      origin + "/api/calendar/" + date.slice(0, 7),
    );
    assert.equal(home.status, 200, JSON.stringify(await home.clone().json()));
    const homepageDay = (await home.json()).dates.find(
      (day) => day.date === date,
    );
    assert.equal(homepageDay.available, true);
    assert.deepEqual(homepageDay.offers, [
      {
        serviceId: "2",
        serviceName: "Synthetic Session",
        instructorId: "2",
        instructorName: "Synthetic Trainer",
        startMs: Date.parse(date + "T13:00:00+08:00"),
        priceMinor: 8800,
        currency: "SGD",
      },
    ]);
    const beforeAnonymous = f.calls.length;
    const anonymousCatalogue = await f.mf.dispatchFetch(
      origin + "/api/catalogue",
    );
    assert.equal(anonymousCatalogue.status, 200);
    assert.equal(anonymousCatalogue.headers.get("set-cookie"), null);
    const publicData = await anonymousCatalogue.json();
    assert.deepEqual(Object.keys(publicData).sort(), [
      "complete",
      "environment",
      "instructors",
      "observedAtMs",
      "services",
    ]);
    assert.equal(publicData.services[0].id, "2");
    assert.equal(
      f.calls.length,
      beforeAnonymous,
      "homepage metadata reuses the shared catalogue",
    );
    assert.equal(
      (await f.mf.dispatchFetch(origin + "/api/booking/availability/2/" + date))
        .status,
      401,
      "public display metadata never grants protected availability access",
    );
    const access = await f.mf.dispatchFetch(origin + "/api/access", {
      method: "POST",
      headers: { origin },
    });
    const cookie = access.headers.get("set-cookie").split(";")[0];
    const before = f.calls.length;
    const catalogue = await f.mf.dispatchFetch(origin + "/api/catalogue", {
      headers: { cookie },
    });
    assert.equal(catalogue.status, 200);
    assert.equal(
      f.calls.length,
      before,
      "shared cache survives a new browser identity",
    );
    assert.equal(
      (
        await f.db
          .prepare("SELECT COUNT(*) n FROM native_checkout_grants")
          .first()
      ).n,
      0,
    );
    const value = {
      key: crypto.randomUUID(),
      accepted: true,
      contact: {
        name: "Synthetic Guest",
        email: "guest@example.com",
        phone: "00000000",
        contactMethod: "email",
        academy: "",
      },
      sessions: [
        {
          serviceId: "2",
          instructorId: "2",
          startMs,
          players: 2,
          totalMinor: 8800,
        },
      ],
    };
    const prepare = (input = value) =>
      f.mf.dispatchFetch(origin + "/api/booking/prepare", {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    available = false;
    const changed = await prepare();
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).error, "native_selection_changed");
    assert.equal(
      (
        await f.db
          .prepare("SELECT COUNT(*) n FROM native_checkout_grants")
          .first()
      ).n,
      0,
    );
    const refreshed = await f.mf.dispatchFetch(
      origin + "/api/calendar/" + date.slice(0, 7),
    );
    assert.equal(
      (await refreshed.json()).dates.find((day) => day.date === date).available,
      false,
    );
    available = true;
    const prepared = await prepare();
    assert.equal(
      prepared.status,
      201,
      JSON.stringify(await prepared.clone().json()),
    );
    const attempt = await prepared.json();
    assert.deepEqual(await (await prepare()).json(), attempt);
    const grant = await f.db
      .prepare("SELECT * FROM native_checkout_grants")
      .first();
    assert.equal(grant.ongoing, 1);
    assert.equal(JSON.parse(grant.contract_json).bookingLeadMinutes, 240);
    assert.ok(grant.starting_used >= 2000);
    assert.equal(grant.maximum_used - grant.starting_used, 96);
    assert.equal(books, 0);
    // Other visitors may consume reads between preparation and checkout.
    await f.sql(
      "UPDATE budget SET used=used+1000 WHERE campaign=?",
      config.vars.CAMPAIGN_ID,
    );
    const checkout = () =>
      f.mf.dispatchFetch(origin + "/api/booking/native/" + attempt.attemptId, {
        method: "POST",
        headers: { cookie, origin },
      });
    const executed = await checkout();
    const outcome = await executed.json();
    assert.equal(executed.status, 200, JSON.stringify(outcome));
    assert.equal(
      outcome.state,
      "associated",
      JSON.stringify(
        await f.db
          .prepare("SELECT result_json FROM native_checkout_grants")
          .first(),
      ),
    );
    assert.equal(outcome.paymentAvailable, true);
    assert.equal(books, 1);
    const count = f.calls.length;
    assert.equal((await checkout()).status, 200);
    assert.equal(books, 1);
    assert.equal(
      f.calls.length,
      count,
      "a duplicate checkout must never redispatch",
    );
    const token = await f.grant();
    const operator = await f.call(token);
    assert.equal(
      operator.body.state,
      "blocked",
      "ongoing customer access does not reopen operator experiments",
    );
    assert.equal(operator.body.result.reason, "campaign_closed");
    assert.equal(f.calls.length, count);
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
        getStartTimeMatrix: { [date]: ["13:00:00", "13:50:00"] },
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

const webhookOrigin = "https://soccerbot-dev.limyousheng-94.workers.dev";
async function subscriptionFixture({
  entries = [],
  createFailure = false,
  deleteFailure = false,
  deleteResponse,
  deleteEffect = "remove",
  afterDeleteResponse,
  maximum = 80,
  changeAfterCreate = false,
  createdFlag = 1,
  events = ["new_booking"],
} = {}) {
  let records = structuredClone(entries),
    creates = 0,
    deletes = [];
  const f = await fixture({
    full: true,
    secrets: {
      APP_ORIGIN: webhookOrigin,
      SOURCE_REVISION: "d".repeat(40),
      PROVIDER_CALL_CEILING: "640",
    },
    respond(request, body) {
      const path = new URL(request.url).pathname;
      if (path === "/admin/webhooks" && request.method === "GET")
        return deletes.length && afterDeleteResponse
          ? afterDeleteResponse()
          : Response.json(records);
      if (path === "/admin/webhooks" && request.method === "POST") {
        creates++;
        const event = events[Math.min(creates - 1, events.length - 1)];
        assert.deepEqual(body, {
          url:
            webhookOrigin +
            "/api/provider/webhook" +
            (event === "new_invoice" ? "/new_invoice" : ""),
          event,
        });
        records.push({
          id: 98 + creates,
          event: body.event,
          url: body.url,
          is_active: createdFlag,
        });
        if (changeAfterCreate) records[0] = { ...records[0], is_active: 0 };
        return createFailure
          ? new Response("unknown", { status: 502 })
          : Response.json({ arbitrary: "not-used-as-identity" });
      }
      if (
        /^\/admin\/webhooks\/(99|100)$/.test(path) &&
        request.method === "DELETE"
      ) {
        const id = path.split("/").at(-1);
        deletes.push(id);
        if (deleteFailure) return new Response("unknown", { status: 502 });
        if (deleteEffect !== "retain")
          records = records.filter((entry) => String(entry.id) !== id);
        if (deleteEffect === "change-prior") records[0].is_active = 0;
        return deleteResponse
          ? deleteResponse()
          : new Response(null, { status: 204 });
      }
    },
  });
  const window = crypto.randomUUID(),
    create = "c".repeat(64),
    cleanup = "e".repeat(64),
    now = Date.now();
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  await f.db
    .prepare(
      "INSERT INTO webhook_capture_windows VALUES(?,?,?,?,?,?,?,?,?,'open')",
    )
    .bind(
      window,
      "d".repeat(40),
      config.vars.DEPLOYMENT_ACCOUNT_ID,
      "synthetic-developer",
      "developer",
      webhookOrigin,
      now - 1000,
      now + 120000,
      16,
    )
    .run();
  await f.db
    .prepare(
      "INSERT INTO webhook_subscription_grants(window_id,create_hash,cleanup_hash,starting_used,maximum_used) VALUES(?,?,?,0,?)",
    )
    .bind(window, hash(create), hash(cleanup), maximum)
    .run();
  return {
    ...f,
    window,
    records: () => records,
    creates: () => creates,
    deletes,
    async manage(action, token = action === "create" ? create : cleanup) {
      const response = await f.mf.dispatchFetch(
        webhookOrigin + "/api/developer/webhook-" + action,
        {
          method: "POST",
          headers: { origin: webhookOrigin, authorization: "Bearer " + token },
        },
      );
      return { status: response.status, body: await response.json() };
    },
    row: () =>
      f.db
        .prepare("SELECT * FROM webhook_subscription_grants WHERE window_id=?")
        .bind(window)
        .first(),
  };
}
test("finite webhook subscription preserves prior destinations and deletes only its freshly proven ID", async () => {
  const prior = [
    {
      id: 7,
      event: "new_booking",
      url: "https://prior.invalid/hook",
      is_active: 1,
    },
  ];
  const f = await subscriptionFixture({ entries: prior });
  try {
    const created = await f.manage("create");
    assert.equal(created.status, 200);
    assert.equal(created.body.verified, true);
    assert.equal(created.body.state, "active");
    const row = await f.row();
    assert.equal(row.subscription_id, "99");
    assert.equal(row.calls_used, 7);
    const closed = await f.manage("cleanup");
    assert.equal(closed.body.verified, true);
    assert.equal(closed.body.state, "closed");
    assert.deepEqual(f.records(), prior);
    assert.deepEqual(f.deletes, ["99"]);
    assert.equal(f.creates(), 1);
    const count = f.calls.length;
    assert.equal((await f.manage("create")).status, 503);
    assert.equal((await f.manage("cleanup")).status, 503);
    assert.equal(f.calls.length, count);
    assert.doesNotMatch(
      JSON.stringify([created, closed, await f.row()]),
      /prior\.invalid|X-Token|synthetic-admin-token/,
    );
  } finally {
    await f.mf.dispose();
  }
});
test("finite webhook subscription accepts exact string flags and restores mixed representation baselines", async () => {
  const prior = [
    {
      id: "7",
      event: "new_booking",
      url: "https://prior.invalid/string",
      is_active: "1",
    },
    {
      id: 8,
      event: "new_invoice",
      url: "https://prior.invalid/number",
      is_active: 1,
    },
  ];
  const f = await subscriptionFixture({ entries: prior, createdFlag: "1" });
  try {
    const created = await f.manage("create");
    assert.equal(created.body.verified, true, JSON.stringify(created.body));
    assert.equal((await f.row()).subscription_id, "99");
    const closed = await f.manage("cleanup");
    assert.equal(closed.body.verified, true, JSON.stringify(closed.body));
    assert.equal(closed.body.state, "closed");
    assert.deepEqual(f.records(), prior);
    assert.deepEqual(f.deletes, ["99"]);
    assert.equal(f.creates(), 1);
    const count = f.calls.length;
    assert.equal((await f.manage("create")).status, 503);
    assert.equal((await f.manage("cleanup")).status, 503);
    assert.equal(f.calls.length, count);
    assert.doesNotMatch(
      JSON.stringify([created, closed, await f.row()]),
      /prior\.invalid|synthetic-admin-token/,
    );
  } finally {
    await f.mf.dispose();
  }
});
test("finite webhook subscription string zero remains inactive and malformed flags cannot authorize writes", async () => {
  for (const flag of [
    "0",
    true,
    false,
    "true",
    "false",
    "",
    "01",
    " 1",
    "1 ",
    2,
    null,
    undefined,
  ]) {
    const f = await subscriptionFixture({
      entries: [
        {
          id: "7",
          event: "new_booking",
          url: "https://prior.invalid/must-not-escape",
          is_active: flag,
        },
      ],
    });
    try {
      const result = await f.manage("create");
      assert.equal(result.body.verified, false);
      assert.equal(result.body.state, "blocked");
      assert.equal(
        result.body.reason,
        flag === "0"
          ? "webhook_subscription_unavailable"
          : "setup_subscription_is_active_invalid",
      );
      assert.equal(f.creates(), 0);
      assert.deepEqual(f.deletes, []);
      assert.equal((await f.row()).subscription_id, null);
      assert.doesNotMatch(
        JSON.stringify(result),
        /prior\.invalid|must-not-escape/,
      );
    } finally {
      await f.mf.dispose();
    }
  }
});
test("finite webhook subscription retains a private field error after create without replay or unsafe cleanup", async () => {
  const f = await subscriptionFixture({
    createdFlag: "private-unsupported-flag",
  });
  try {
    const result = await f.manage("create");
    assert.equal(result.body.state, "create_unknown");
    assert.equal(result.body.reason, "setup_subscription_is_active_invalid");
    assert.equal(f.creates(), 1);
    assert.equal((await f.row()).subscription_id, null);
    const count = f.calls.length;
    assert.equal((await f.manage("create")).status, 503);
    assert.equal(f.calls.length, count);
    const cleanup = await f.manage("cleanup");
    assert.equal(cleanup.body.state, "blocked");
    assert.equal(cleanup.body.reason, "setup_subscription_is_active_invalid");
    assert.deepEqual(f.deletes, []);
    assert.doesNotMatch(
      JSON.stringify([result, cleanup, await f.row()]),
      /private-unsupported-flag|synthetic-admin-token/,
    );
  } finally {
    await f.mf.dispose();
  }
});
test("finite webhook subscription refuses sixth event and preexisting campaign destination", async () => {
  for (const entries of [
    Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      event: "new_booking",
      url: `https://prior.invalid/${i}`,
      is_active: 1,
    })),
    [
      {
        id: 7,
        event: "change_booking",
        url: webhookOrigin + "/api/provider/webhook",
        is_active: 1,
      },
    ],
  ]) {
    const f = await subscriptionFixture({ entries });
    try {
      assert.equal((await f.manage("create")).body.verified, false);
      assert.equal(f.creates(), 0);
      assert.deepEqual(f.records(), entries);
    } finally {
      await f.mf.dispose();
    }
  }
});
test("finite webhook subscription closes admission for foreign source, company, expired and unknown capabilities", async () => {
  for (const field of [
    "source_revision",
    "company_login",
    "expires_ms",
    "unknown",
  ]) {
    const f = await subscriptionFixture();
    try {
      if (field !== "unknown")
        await f.db
          .prepare(`UPDATE webhook_capture_windows SET ${field}=? WHERE id=?`)
          .bind(
            field === "expires_ms"
              ? Date.now() - 1
              : field === "source_revision"
                ? "f".repeat(40)
                : "foreign-company",
            f.window,
          )
          .run();
      const response = await f.manage(
        "create",
        field === "unknown" ? "f".repeat(64) : undefined,
      );
      assert.equal(response.status, 503);
      assert.equal(f.calls.length, 0);
    } finally {
      await f.mf.dispose();
    }
  }
});
test("finite webhook subscription unknown create cannot replay and cleanup requires fresh exact baseline", async () => {
  const f = await subscriptionFixture({ createFailure: true });
  try {
    assert.equal((await f.manage("create")).body.state, "create_unknown");
    assert.equal(f.creates(), 1);
    const count = f.calls.length;
    assert.equal((await f.manage("create")).status, 503);
    assert.equal(f.calls.length, count);
    // A provider HTTP failure invokes the existing account cooldown. Preserve it;
    // source proof here validates the durable effect and no-replay boundary.
    assert.equal((await f.row()).subscription_id, null);
    assert.equal((await f.row()).state, "create_unknown");
  } finally {
    await f.mf.dispose();
  }
});
test("finite webhook subscription simultaneous create consumes exactly one durable write claim", async () => {
  const f = await subscriptionFixture();
  try {
    const values = await Promise.all([f.manage("create"), f.manage("create")]);
    assert.equal(values.filter((v) => v.body.verified).length, 1);
    assert.equal(f.creates(), 1);
  } finally {
    await f.mf.dispose();
  }
});
test("finite webhook subscription changed prior entry blocks acceptance and never deletes old IDs", async () => {
  const f = await subscriptionFixture({
    entries: [
      {
        id: 7,
        event: "new_booking",
        url: "https://prior.invalid/hook",
        is_active: 1,
      },
    ],
    changeAfterCreate: true,
  });
  try {
    assert.equal((await f.manage("create")).body.state, "create_unknown");
    assert.equal((await f.manage("cleanup")).body.verified, false);
    assert.deepEqual(f.deletes, []);
  } finally {
    await f.mf.dispose();
  }
});
test("finite webhook subscription failed deletion is retained and cannot dispatch a second DELETE", async () => {
  const f = await subscriptionFixture({ deleteFailure: true });
  try {
    assert.equal((await f.manage("create")).body.verified, true);
    assert.equal((await f.manage("cleanup")).body.state, "delete_unknown");
    const count = f.calls.length;
    assert.equal((await f.manage("cleanup")).status, 503);
    assert.equal(f.calls.length, count);
    assert.deepEqual(f.deletes, ["99"]);
  } finally {
    await f.mf.dispose();
  }
});
test("finite webhook cleanup verifies the fresh baseline after body-independent HTTP acknowledgement", async () => {
  for (const [status, body, contentType] of [
    [200, null, null],
    [200, "removed", "text/plain"],
    [200, "not-json", "application/json"],
    [202, "accepted", "text/plain"],
    [204, null, null],
  ]) {
    const prior = [
      {
        id: 7,
        event: "new_invoice",
        url: "https://prior.invalid/hook",
        is_active: "1",
      },
    ];
    const f = await subscriptionFixture({
      entries: prior,
      deleteResponse: () =>
        new Response(body, {
          status,
          headers: contentType ? { "content-type": contentType } : {},
        }),
    });
    try {
      assert.equal((await f.manage("create")).body.verified, true);
      const before = f.calls.length;
      const closed = await f.manage("cleanup");
      assert.equal(
        closed.body.verified,
        true,
        JSON.stringify({ status, closed }),
      );
      assert.equal(closed.body.state, "closed");
      assert.equal(closed.body.deleteAcknowledgement.httpStatus, status);
      assert.equal(
        closed.body.deleteAcknowledgement.contentType,
        contentType === "application/json"
          ? "json"
          : contentType
            ? "other"
            : "absent",
      );
      assert.deepEqual(f.records(), prior);
      assert.deepEqual(f.deletes, ["99"]);
      const cleanupCalls = f.calls.slice(before);
      assert.equal(cleanupCalls.at(-1).method, "GET");
      assert.equal(
        new URL(cleanupCalls.at(-1).url).pathname,
        "/admin/webhooks",
      );
      const count = f.calls.length;
      assert.equal((await f.manage("cleanup")).status, 503);
      assert.equal(f.calls.length, count);
    } finally {
      await f.mf.dispose();
    }
  }
});
test("finite webhook cleanup never treats acknowledgement as proof when the fresh baseline fails", async () => {
  for (const mode of ["retain", "change-prior", "bad-read"]) {
    const f = await subscriptionFixture({
      entries: [
        {
          id: 7,
          event: "new_invoice",
          url: "https://prior.invalid/hook",
          is_active: 1,
        },
      ],
      deleteResponse: () => new Response(null, { status: 200 }),
      deleteEffect: mode,
      afterDeleteResponse:
        mode === "bad-read"
          ? () =>
              new Response("not-json", {
                headers: { "content-type": "application/json" },
              })
          : undefined,
    });
    try {
      assert.equal((await f.manage("create")).body.verified, true);
      const closed = await f.manage("cleanup");
      assert.equal(closed.body.verified, false);
      assert.equal(closed.body.state, "delete_unknown");
      assert.equal(closed.body.deleteAcknowledgement.httpStatus, 200);
      assert.equal((await f.row()).state, "delete_unknown");
      const count = f.calls.length;
      assert.equal((await f.manage("cleanup")).status, 503);
      assert.equal(f.calls.length, count);
      assert.deepEqual(f.deletes, ["99"]);
    } finally {
      await f.mf.dispose();
    }
  }
});
test("finite webhook cleanup rejects redirects and HTTP errors without following or replaying DELETE", async () => {
  for (const status of [302, 401, 404, 502]) {
    const f = await subscriptionFixture({
      deleteEffect: "retain",
      deleteResponse: () =>
        new Response("private-error", {
          status,
          headers: { location: "https://foreign.invalid/hook" },
        }),
    });
    try {
      assert.equal((await f.manage("create")).body.verified, true);
      const closed = await f.manage("cleanup");
      assert.equal(closed.body.verified, false);
      assert.equal(closed.body.state, "delete_unknown");
      assert.equal(closed.body.deleteAcknowledgement, undefined);
      assert.equal(f.calls.at(-1).method, "DELETE");
      assert.doesNotMatch(
        JSON.stringify(closed),
        /private-error|foreign.invalid/,
      );
      const count = f.calls.length;
      assert.equal((await f.manage("cleanup")).status, 503);
      assert.equal(f.calls.length, count);
      assert.deepEqual(f.deletes, ["99"]);
    } finally {
      await f.mf.dispose();
    }
  }
});
test("finite webhook subscription cap stops before create and preserves recovery reserve", async () => {
  const f = await subscriptionFixture({ maximum: 5 });
  try {
    assert.equal((await f.manage("create")).body.verified, false);
    assert.equal(f.calls.length, 5);
    assert.equal(f.creates(), 0);
    assert.equal((await f.row()).calls_used, 5);
  } finally {
    await f.mf.dispose();
  }
});

async function structureGrant(f, change = {}, expiry = Date.now() + 120000) {
  const token = await f.grant(expiry, "native_field_discovery");
  await f.db
    .prepare(
      "UPDATE developer_operations SET result_json=? WHERE capability_hash=?",
    )
    .bind(
      JSON.stringify({
        kind: "native-webhook-structure",
        sourceRevision: "e".repeat(40),
        accountId: config.vars.DEPLOYMENT_ACCOUNT_ID,
        startingUsed: 0,
        maxCalls: 6,
        ...change,
      }),
      createHash("sha256").update(token).digest("hex"),
    )
    .run();
  return token;
}
test("webhook structure inspection reads one account list and exposes types without assuming the active flag representation", async () => {
  const f = await fixture({
    secrets: { SOURCE_REVISION: "e".repeat(40), PROVIDER_CALL_CEILING: "640" },
    respond(request) {
      if (new URL(request.url).pathname === "/admin/webhooks") {
        assert.equal(request.method, "GET");
        return Response.json([
          {
            id: 99,
            url: "https://private-destination.invalid/secret",
            event: "new_booking",
            is_active: true,
            changed: "private-timestamp",
            privateContact: "private-value",
          },
        ]);
      }
    },
  });
  try {
    await f.sql(
      "INSERT INTO budget(campaign,used) VALUES('developer-20261008',455)",
    );
    const token = await structureGrant(f, { startingUsed: 455 }),
      result = await f.call(token, "POST", "native_field_discovery");
    assert.equal(result.body.state, "complete");
    assert.equal(result.body.result.evidence, "subscription_structure_only");
    assert.equal(result.body.result.normalized, false);
    assert.equal(f.calls.length, 5);
    assert.equal(result.body.result.accounting.used, 460);
    const row = result.body.result.representation.entries[0];
    assert.deepEqual(row.fields.find((x) => x.key === "is_active").value, {
      type: "boolean",
    });
    assert.doesNotMatch(
      JSON.stringify(result),
      /private-|new_booking|synthetic-admin-token/,
    );
    await f.call(token, "POST", "native_field_discovery");
    assert.equal(f.calls.length, 5);
    assert.equal(
      f.calls.filter((x) => x.url.endsWith("/admin/webhooks")).length,
      1,
    );
  } finally {
    await f.mf.dispose();
  }
});
test("webhook structure inspection refuses changed source budget scope and expired one-use authority before transport", async () => {
  for (const change of [
    { sourceRevision: "f".repeat(40) },
    { accountId: "foreign" },
    { startingUsed: 1 },
    { maxCalls: 7 },
    { url: "https://unapproved.invalid" },
  ]) {
    const f = await fixture({
      secrets: {
        SOURCE_REVISION: "e".repeat(40),
        PROVIDER_CALL_CEILING: "640",
      },
    });
    try {
      const token = await structureGrant(f, change);
      assert.equal(
        (await f.call(token, "POST", "native_field_discovery")).body.state,
        "blocked",
      );
      assert.equal(f.calls.length, 0);
    } finally {
      await f.mf.dispose();
    }
  }
  const f = await fixture({ secrets: { SOURCE_REVISION: "e".repeat(40) } });
  try {
    const token = await structureGrant(f, {}, Date.now() - 1);
    assert.equal(
      (await f.call(token, "POST", "native_field_discovery")).status,
      401,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    await f.mf.dispose();
  }
});
test("webhook structure inspection bounds nested diagnostics and never interprets an unknown envelope as subscription acceptance", async () => {
  const f = await fixture({
    secrets: { SOURCE_REVISION: "e".repeat(40) },
    respond(request) {
      if (new URL(request.url).pathname === "/admin/webhooks")
        return Response.json({
          data: Array.from({ length: 40 }, () => ({
            id: 987,
            url: "private-url",
            event: "private-event",
            is_active: "private-flag",
            privateContact: "private-contact",
          })),
          unknown: "private-root",
        });
    },
  });
  try {
    const result = await f.call(
      await structureGrant(f),
      "POST",
      "native_field_discovery",
    );
    assert.equal(result.body.state, "complete");
    assert.equal(result.body.result.normalized, false);
    const raw = JSON.stringify(result.body.result.representation);
    assert.ok(raw.length < 6000);
    assert.doesNotMatch(raw, /private-|987/);
    assert.equal(f.calls.length, 5);
  } finally {
    await f.mf.dispose();
  }
});

async function installInvoiceControl(f, startingUsed) {
  const window = crypto.randomUUID();
  const create = "1".repeat(64),
    cleanup = "2".repeat(64);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  await f.db
    .prepare(
      "INSERT INTO webhook_capture_windows SELECT ?,source_revision,account_id,company_login,environment,origin,opened_ms,expires_ms,maximum_receipts,state FROM webhook_capture_windows WHERE id=?",
    )
    .bind(window, f.window)
    .run();
  await f.db
    .prepare("INSERT INTO webhook_event_scopes VALUES(?,'new_invoice')")
    .bind(window)
    .run();
  await f.db
    .prepare(
      "INSERT INTO webhook_subscription_grants(window_id,create_hash,cleanup_hash,starting_used,maximum_used) VALUES(?,?,?,?,80)",
    )
    .bind(window, hash(create), hash(cleanup), startingUsed)
    .run();
  return { window, create, cleanup };
}
test("paired webhook channels preserve exact baselines through reverse cleanup without replay", async () => {
  const prior = [
    {
      id: 7,
      event: "new_booking",
      url: "https://prior.invalid/hook",
      is_active: 1,
    },
  ];
  const f = await subscriptionFixture({
    entries: prior,
    events: ["new_booking", "new_invoice"],
  });
  try {
    const booking = await f.manage("create");
    assert.equal(booking.body.verified, true);
    const invoice = await installInvoiceControl(
      f,
      booking.body.accounting.used,
    );
    const created = await f.manage("create", invoice.create);
    assert.equal(created.body.verified, true);
    assert.deepEqual(
      f.records().map((x) => x.event),
      ["new_booking", "new_booking", "new_invoice"],
    );
    assert.equal(
      (await f.manage("cleanup", invoice.cleanup)).body.verified,
      true,
    );
    assert.deepEqual(
      f.records().map((x) => String(x.id)),
      ["7", "99"],
    );
    assert.equal((await f.manage("cleanup")).body.verified, true);
    assert.deepEqual(f.records(), prior);
    assert.deepEqual(f.deletes, ["100", "99"]);
    const count = f.calls.length;
    assert.equal((await f.manage("create", invoice.create)).status, 503);
    assert.equal((await f.manage("cleanup", invoice.cleanup)).status, 503);
    assert.equal(f.calls.length, count);
    const rows = (
      await f.db
        .prepare("SELECT calls_used,state FROM webhook_subscription_grants")
        .all()
    ).results;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.state, "closed");
      assert.ok(row.calls_used > 0 && row.calls_used <= 20);
    }
    assert.equal(
      rows.reduce((sum, row) => sum + row.calls_used, 0),
      f.calls.length,
    );
  } finally {
    await f.mf.dispose();
  }
});
test("paired webhook cleanup refuses out of order deletion and preserves both subscriptions", async () => {
  const f = await subscriptionFixture({
    events: ["new_booking", "new_invoice"],
  });
  try {
    const first = await f.manage("create");
    const invoice = await installInvoiceControl(f, first.body.accounting.used);
    assert.equal(
      (await f.manage("create", invoice.create)).body.verified,
      true,
    );
    const cleanup = await f.manage("cleanup");
    assert.equal(cleanup.body.verified, false);
    assert.equal(cleanup.body.state, "blocked");
    assert.deepEqual(f.deletes, []);
    assert.equal(f.records().length, 2);
  } finally {
    await f.mf.dispose();
  }
});
test("invoice webhook scope enforces its own event cap before any subscription write", async () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    event: "new_invoice",
    url: `https://prior.invalid/${i}`,
    is_active: 1,
  }));
  const f = await subscriptionFixture({ entries, events: ["new_invoice"] });
  try {
    await f.db
      .prepare("INSERT INTO webhook_event_scopes VALUES(?,'new_invoice')")
      .bind(f.window)
      .run();
    const result = await f.manage("create");
    assert.equal(result.body.verified, false);
    assert.equal(f.creates(), 0);
    assert.deepEqual(f.records(), entries);
    assert.deepEqual(f.deletes, []);
  } finally {
    await f.mf.dispose();
  }
});

test("ongoing checkout admits the priced weekend service with the customer lead-time contract", async () => {
  const day = new Date(Date.now() + 3 * 86400000);
  while (day.getUTCDay() !== 6) day.setUTCDate(day.getUTCDate() + 1);
  const date = day.toISOString().slice(0, 10);
  const f = await fixture({
    full: true,
    end: 0,
    secrets: {
      SOURCE_REVISION: "d".repeat(40),
      LIVE_CUSTOMER_ACCESS: "enabled",
      PREMIUM_SERVICE_ID: "3",
    },
    respond: (_request, body) => {
      if (!body) return;
      const matrix = {};
      if (body.method === "getStartTimeMatrix")
        for (
          let cursor = new Date(body.params[0] + "T00:00:00Z");
          cursor.toISOString().slice(0, 10) <= body.params[1];
          cursor.setUTCDate(cursor.getUTCDate() + 1)
        ) {
          const key = cursor.toISOString().slice(0, 10);
          matrix[key] = key === date ? ["13:00:00"] : [];
        }
      const results = {
        getEventList: Object.fromEntries(
          [2, 3].map((id) => [
            id,
            {
              id,
              name: "Synthetic Session " + id,
              duration: "40",
              is_active: "1",
              is_public: "1",
              is_recurring: "0",
              price: id === 3 ? "108" : "88",
              currency: "SGD",
              unit_map: [2],
            },
          ]),
        ),
        getUnitList: {
          2: { id: 2, name: "Synthetic Trainer", is_active: "1" },
        },
        getStartTimeMatrix: matrix,
        getAdditionalFields: [],
        getAvailableUnits: [2],
      };
      if (Object.hasOwn(results, body.method))
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: results[body.method],
        });
    },
  });
  try {
    const access = await f.mf.dispatchFetch(origin + "/api/access", {
      method: "POST",
      headers: { origin },
    });
    const cookie = access.headers.get("set-cookie").split(";")[0];
    const prepared = await f.mf.dispatchFetch(origin + "/api/booking/prepare", {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({
        key: crypto.randomUUID(),
        accepted: true,
        contact: {
          name: "Synthetic Guest",
          email: "guest@example.com",
          phone: "00000000",
          contactMethod: "email",
          academy: "",
        },
        sessions: [
          {
            serviceId: "3",
            instructorId: "2",
            startMs: Date.parse(date + "T13:00:00+08:00"),
            players: 2,
            totalMinor: 10800,
          },
        ],
      }),
    });
    assert.equal(
      prepared.status,
      201,
      JSON.stringify(await prepared.clone().json()),
    );
    const grant = await f.db
      .prepare("SELECT contract_json FROM native_checkout_grants")
      .first();
    assert.equal(JSON.parse(grant.contract_json).bookingLeadMinutes, 240);
    assert.equal(JSON.parse(grant.contract_json).premiumServiceId, "3");
    assert.ok(
      f.calls.some((call) => call.body?.method === "getStartTimeMatrix"),
    );
    assert.ok(f.calls.every((call) => call.body?.method !== "book"));
  } finally {
    await f.mf.dispose();
  }
});

test("held checkout crosses authenticated HTTP routes and durable coordination without rechecking its reserved slot", async () => {
  const { createBookingMechanism } =
    await import("./booking-mechanism-fixture.mjs");
  const f = await createBookingMechanism();
  try {
    const catalogue = await f.mf.dispatchFetch(f.origin + "/api/catalogue");
    assert.equal(catalogue.status, 200, await catalogue.text());
    const calendar = await f.mf.dispatchFetch(
      f.origin + "/api/calendar/" + f.date.slice(0, 7),
    );
    const dates = await calendar.json();
    assert.equal(calendar.status, 200, JSON.stringify(dates));
    assert.ok(dates.dates.some((d) => d.date === f.date && d.available));
    const guest = await f.mf.dispatchFetch(f.origin + "/api/access", {
      method: "POST",
      headers: { origin: f.origin },
    });
    assert.equal(guest.status, 201);
    const cookie = guest.headers.get("set-cookie").split(";")[0];
    const headers = {
      origin: f.origin,
      cookie,
      "content-type": "application/json",
    };
    const prepared = await f.mf.dispatchFetch(
      f.origin + "/api/booking/prepare",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          key: crypto.randomUUID(),
          accepted: false,
          holding: true,
          contact: {
            name: "Synthetic Guest",
            email: "synthetic@example.test",
            phone: "+6591234567",
            contactMethod: "email",
            academy: "Synthetic School",
          },
          sessions: [
            {
              serviceId: "2",
              instructorId: "14",
              startMs: f.startMs,
              players: 2,
              totalMinor: 8800,
            },
          ],
        }),
      },
    );
    const preparation = await prepared.json();
    assert.equal(prepared.status, 201, JSON.stringify(preparation));
    const id = preparation.attemptId;
    const hold = () =>
      f.mf.dispatchFetch(f.origin + `/api/booking/native/${id}?hold=1`, {
        method: "POST",
        headers,
      });
    const first = await hold();
    const result = await first.json();
    assert.equal(first.status, 200, JSON.stringify(result));
    assert.equal(
      result.state,
      "associated",
      JSON.stringify(
        await f.db
          .prepare(
            "SELECT result_json FROM native_checkout_grants WHERE attempt_id=?",
          )
          .bind(id)
          .first(),
      ),
    );
    assert.equal(result.paymentAvailable, false);
    const retry = await hold();
    assert.equal(retry.status, 200, await retry.text());
    const current = await f.mf.dispatchFetch(
      f.origin + "/api/booking/current",
      { headers },
    );
    assert.equal((await current.json()).state, "held");
    const pay = await f.mf.dispatchFetch(
      f.origin + `/api/booking/hitpay/${id}`,
      { method: "POST", headers, body: JSON.stringify({ accepted: true }) },
    );
    const paid = await pay.json();
    assert.equal(pay.status, 200, JSON.stringify(paid));
    assert.equal(paid.paymentAvailable, true);
    const context = await f.mf.dispatchFetch(
      f.origin + `/api/attempts/${id}/checkout`,
      { headers },
    );
    assert.equal((await context.json()).checkout.url, f.checkoutUrl);
    const invalidWebhook = await f.mf.dispatchFetch(
      f.origin + "/api/webhooks/hitpay",
      {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "Hitpay-Signature": "0".repeat(64),
        },
      },
    );
    assert.equal(invalidWebhook.status, 401);
    assert.equal(
      f.calls.filter((c) => c.url.endsWith("/accept-payment")).length,
      0,
    );
    assert.equal((await f.completePayment()).status, 202);
    await (await f.mf.getWorker()).scheduled();
    const confirmation = await f.mf.dispatchFetch(
      f.origin + `/api/attempts/${id}/confirmation`,
      { headers },
    );
    const confirmed = await confirmation.json();
    assert.equal(confirmed.status, "confirmed", JSON.stringify(confirmed));
    assert.equal((await f.completePayment()).status, 202);
    await (await f.mf.getWorker()).scheduled();
    assert.equal(
      f.calls.filter((c) => c.url.endsWith("/accept-payment")).length,
      1,
    );
    const bookingIndex = f.calls.findIndex((c) => c.body?.method === "book");
    assert.ok(bookingIndex >= 0);
    assert.equal(f.calls.filter((c) => c.body?.method === "book").length, 1);
    assert.equal(
      f.calls.filter(
        (c) => c.url.includes("hit-pay.com") && c.method === "POST",
      ).length,
      1,
    );
    assert.equal(
      f.calls
        .slice(bookingIndex + 1)
        .some((c) =>
          ["getStartTimeMatrix", "getAvailableUnits"].includes(c.body?.method),
        ),
      false,
    );
    assert.deepEqual(f.unexpected, []);
  } finally {
    await f.close();
  }
});
