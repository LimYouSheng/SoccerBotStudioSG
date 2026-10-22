import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const bundle = await build({
  entryPoints: ["worker/telemetry.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
});
const {
  sanitizeDiagnostic,
  telemetryPayload,
  default: handler,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const correlationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const record = {
  event: "checkout_trace",
  correlationId,
  durationMs: 500,
  tokenCached: true,
  phases: { queue: { durationMs: 12, d1Count: 0 }, prepare: { d1Count: 5 } },
};
const now = Date.now();
const envelope = (records, extra = {}) => ({
  scriptName: "soccerbot-dev",
  outcome: "ok",
  eventTimestamp: now - 500,
  executionModel: "stateful",
  logs: records.map((r) => ({ message: [JSON.stringify(r)], timestamp: now })),
  ...extra,
});
const env = {
  EXPORT_ENABLED: "true",
  SUCCESS_SAMPLE_RATE: "1",
  GRAFANA_OTLP_ENDPOINT: "https://otlp-gateway-test.grafana.net/otlp",
  GRAFANA_AUTHORIZATION: "Basic c3ludGhldGlj",
};

test("telemetry allowlist excludes secrets and rejects arbitrary labels identities and nonfinite metrics", () => {
  const safe = sanitizeDiagnostic({
    ...record,
    customer: "SECRET",
    url: "SECRET",
    phases: {
      ...record.phases,
      SECRET: { d1Count: 90 },
      hitpay: { calls: Infinity, durationMs: -1, error: "SECRET" },
    },
  });
  assert.equal(safe.d1_count, 5);
  assert.equal(safe.token_cached, true);
  assert.ok(!JSON.stringify(safe).includes("SECRET"));
  assert.ok(!Object.hasOwn(safe, "hitpay.calls"));
  assert.equal(
    sanitizeDiagnostic({ ...record, correlationId: "SECRET" }),
    undefined,
  );
  assert.equal(sanitizeDiagnostic({ ...record, event: "SECRET" }), undefined);
  assert.equal(
    sanitizeDiagnostic({
      event: "provider_token_cache",
      correlationId,
      family: "public",
      result: "SECRET",
    }),
    undefined,
  );
});

test("telemetry samples successful correlations consistently and retains detected failures at zero success sampling", async () => {
  assert.equal(
    (await telemetryPayload([envelope([record])], 0)).spans.length,
    0,
  );
  const failure = {
    event: "foundation_trace",
    correlationId,
    boundary: "coordinator",
    outcome: "error",
    durationMs: 501,
  };
  const result = await telemetryPayload([envelope([record, failure])], 0);
  assert.equal(result.spans.length, 2);
  assert.equal(result.spans[0].traceId, result.spans[1].traceId);
  assert.notEqual(result.spans[0].spanId, result.spans[1].spanId);
  assert.equal(result.spans[1].status.code, 2);
  const confirmation = {
    event: "confirmation_trace",
    correlationId,
    boundary: "recovery",
    result: "manual_review",
    recoveryKey: "f".repeat(64),
  };
  assert.equal(
    (await telemetryPayload([envelope([confirmation])], 0)).spans.length,
    1,
  );
});

test("telemetry separates delayed invocations and retains safe recovery links without fabricated parents", async () => {
  const confirmation = {
    event: "confirmation_trace",
    correlationId,
    boundary: "recovery",
    durationMs: 20,
    recoveryKey: "b".repeat(64),
    operations: { d1: { count: 5 } },
  };
  const result = await telemetryPayload(
    [
      envelope([confirmation]),
      envelope([confirmation], { eventTimestamp: now + 60000 }),
    ],
    1,
  );
  assert.notEqual(result.spans[0].traceId, result.spans[1].traceId);
  assert.deepEqual(result.spans[0].attributes, result.spans[1].attributes);
  assert.equal(result.spans[0].parentSpanId, undefined);
  assert.equal(
    BigInt(result.spans[0].endTimeUnixNano) -
      BigInt(result.spans[0].startTimeUnixNano),
    20000000n,
  );
});

test("telemetry ignores raw Tail payloads malformed logs and foreign producers and bounds output", async () => {
  const source = envelope([record], {
    event: { request: { url: "SECRET", headers: { authorization: "SECRET" } } },
    exceptions: [{ message: "SECRET" }],
  });
  source.logs.push(
    { message: ["SECRET"], timestamp: now },
    { message: [JSON.stringify(record), "SECRET"], timestamp: now },
  );
  const result = await telemetryPayload(
    [source, envelope([record], { scriptName: "foreign" })],
    1,
  );
  assert.equal(result.spans.length, 1);
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  const bounded = await telemetryPayload(
    [envelope(Array.from({ length: 300 }, () => record))],
    1,
  );
  assert.equal(bounded.spans.length, 128);
  assert.equal(bounded.dropped, 172);
});

test("telemetry stays disabled without configuration and refuses redirectable or foreign destinations", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("must not send");
  });
  t.mock.method(console, "log", () => {});
  for (const override of [
    { EXPORT_ENABLED: "false" },
    { GRAFANA_OTLP_ENDPOINT: "https://evil.test/otlp" },
    { GRAFANA_OTLP_ENDPOINT: env.GRAFANA_OTLP_ENDPOINT + "?secret=x" },
    { SUCCESS_SAMPLE_RATE: "NaN" },
    { GRAFANA_AUTHORIZATION: "" },
  ])
    await handler.tail([envelope([record])], { ...env, ...override });
  assert.equal(calls, 0);
});

test("telemetry transport bounds timeout rejects redirects and hides exporter failures", async (t) => {
  const logs = [];
  t.mock.method(console, "log", (message) => logs.push(message));
  const outbound = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, env.GRAFANA_OTLP_ENDPOINT + "/v1/traces");
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, env.GRAFANA_AUTHORIZATION);
    assert.equal(
      JSON.parse(options.body).resourceSpans[0].scopeSpans[0].spans.length,
      1,
    );
    return new Response("SECRET", {
      status: 302,
      headers: { Location: "https://evil.test" },
    });
  });
  await handler.tail([envelope([record])], env);
  outbound.mock.mockImplementation(async () => {
    throw new Error("SECRET");
  });
  await handler.tail([envelope([record])], env);
  assert.equal(outbound.mock.callCount(), 2);
  assert.match(logs[0], /rejected_http/);
  assert.match(logs[1], /unavailable/);
  assert.ok(!logs.join("").includes("SECRET"));
});

test(
  "real Workers Tail delivery exports sanitized OTLP independently of producer response",
  { timeout: 10000 },
  async () => {
    const received = Promise.withResolvers();
    const producer = convertV4MiniflareOptions({
      name: "soccerbot-dev",
      modules: true,
      script: `export default { fetch() { console.log(${JSON.stringify(JSON.stringify(record))}); return new Response("booking response"); } }`,
      compatibilityDate: "2026-10-08",
      cf: false,
    }).workers[0];
    producer.config.tailConsumers = [{ worker: "soccerbot-telemetry" }];
    // workerd omits scriptName locally (Miniflare documents this in its tail
    // collector). Supply only that platform metadata in this test adapter.
    const localTail = await build({
      stdin: {
        contents: `import handler from "./worker/telemetry.ts"; export default { tail(events, env) { return handler.tail(events.map(e => ({ ...e, scriptName: "soccerbot-dev" })), env); } };`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
    });
    const consumer = convertV4MiniflareOptions({
      name: "soccerbot-telemetry",
      modules: true,
      script: localTail.outputFiles[0].text,
      compatibilityDate: "2026-10-08",
      cf: false,
      bindings: env,
      outboundService: async (request) => {
        received.resolve(await request.json());
        return new Response(null, { status: 503 });
      },
    }).workers[0];
    const mf = new Miniflare({ workers: [producer, consumer], cf: false });
    try {
      const response = await mf.dispatchFetch("https://soccerbot.test/");
      assert.equal(await response.text(), "booking response");
      const payload = await received.promise;
      assert.equal(
        payload.resourceSpans[0].scopeSpans[0].spans[0].name,
        "soccerbot.checkout_trace",
      );
    } finally {
      await mf.dispose();
    }
  },
);

test("placement diagnostics retain bounded timings and D1 locations without provider or customer payloads", () => {
  const safe = sanitizeDiagnostic({
    event: "provider_transport_timing",
    correlationId,
    operation: "public_auth",
    outcome: "ok",
    durationMs: 100,
    headersMs: 90,
    bodyMs: 10,
    url: "SECRET",
    token: "SECRET",
  });
  assert.equal(safe.headersMs, 90);
  assert.equal(safe.bodyMs, 10);
  assert.equal(safe.operation, "public_auth");
  assert.doesNotMatch(JSON.stringify(safe), /SECRET/);
  assert.equal(
    sanitizeDiagnostic({
      event: "provider_transport_timing",
      correlationId,
      operation: "SECRET",
    }),
    undefined,
  );
  const d1 = sanitizeDiagnostic({
    event: "foundation_trace",
    correlationId,
    d1Execution: {
      statements: 2,
      sqlDurationMs: 0.5,
      colos: ["KIX", "SECRET", "SIN"],
      sql: "SECRET",
      results: ["SECRET"],
    },
  });
  assert.equal(d1["d1_execution.sqlDurationMs"], 0.5);
  assert.equal(d1.d1_colos, "KIX,SIN");
  assert.doesNotMatch(JSON.stringify(d1), /SECRET/);
  for (const result of ["refresh_due", "refreshed"]) {
    assert.equal(
      sanitizeDiagnostic({
        event: "provider_token_cache",
        correlationId,
        family: "public",
        result,
      }).result,
      result,
    );
  }
});

test("D1 diagnostics preserve promise identity and count batch statements separately from round trips", async (t) => {
  const compiled = await build({
    entryPoints: ["worker/diagnostics.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  const { traced, instrumentStorage, providerTransportTiming } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
  );
  const logs = [];
  t.mock.method(console, "log", (line) => logs.push(JSON.parse(line)));
  const response = [
    {
      meta: { timings: { sql_duration_ms: 0.2 }, served_by_colo: "KIX" },
      results: ["SECRET"],
    },
    {
      meta: { timings: { sql_duration_ms: 0.3 }, served_by_colo: "KIX" },
      results: ["SECRET"],
    },
    { meta: { timings: { sql_duration_ms: NaN }, served_by_colo: "SECRET" } },
  ];
  const promise = Promise.resolve(response);
  const failure = new Error("SECRET");
  const target = {
    batch() {
      assert.equal(this, target);
      return promise;
    },
    run() {
      return Promise.reject(failure);
    },
    first() {
      return Promise.resolve({
        meta: { timings: { sql_duration_ms: 999 }, served_by_colo: "BAD" },
      });
    },
  };
  await traced(correlationId, "http", async () => {
    const wrapped = instrumentStorage(target, "d1");
    assert.equal(wrapped.batch(), promise);
    assert.equal(await promise, response);
    await wrapped.first();
    await assert.rejects(wrapped.run(), (error) => error === failure);
    const transport = providerTransportTiming("public_auth");
    transport.headers();
    transport.finish(false);
  });
  const trace = logs.find((log) => log.event === "foundation_trace");
  assert.deepEqual(trace.d1Execution, {
    statements: 2,
    sqlDurationMs: 0.5,
    colos: ["KIX"],
  });
  assert.equal(trace.spans.d1.count, 3);
  assert.equal(trace.spans.d1.errors, 1);
  const transport = logs.find(
    (log) => log.event === "provider_transport_timing",
  );
  assert.equal(transport.correlationId, correlationId);
  assert.ok(transport.headersMs >= 0 && transport.bodyMs >= 0);
  assert.equal(transport.durationMs, transport.headersMs + transport.bodyMs);
  assert.doesNotMatch(JSON.stringify(logs), /SECRET/);
});
