// Separate Tail Worker: never imported by the booking Worker. Only reconstructed
// diagnostic summaries leave Cloudflare; raw Tail events are never serialized.
type Fields = Record<string, string | number | boolean>;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const number = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e12;
const phases = [
  "queue",
  "prepare",
  "simplybook",
  "booking_work",
  "verification",
  "hitpay",
  "payment_save",
];
const stages = [
  "queue",
  "claim",
  "hitpay",
  "payment_evidence",
  "booking_before",
  "accounting",
  "booking_after",
  "publish",
  "commit",
  "status",
  "context",
  "receipt",
];
const operations = [
  "d1",
  "admission",
  "public_auth",
  "admin_auth",
  "identity",
  "tariff",
  "booking_read",
  "invoice_read",
  "accounting_write",
  "hitpay_read",
  "hitpay_search",
];

function metrics(
  target: Fields,
  prefix: string,
  value: unknown,
  names: string[],
) {
  const source = object(value);
  for (const name of names)
    if (number(source[name])) target[prefix + name] = source[name];
}
function choice(
  target: Fields,
  name: string,
  value: unknown,
  choices: string[],
) {
  if (typeof value === "string" && choices.includes(value))
    target[name] = value;
}
export function sanitizeDiagnostic(value: unknown): Fields | undefined {
  const source = object(value);
  if (
    typeof source.correlationId !== "string" ||
    !uuid.test(source.correlationId)
  )
    return;
  const result: Fields = { correlation_id: source.correlationId };
  choice(result, "event", source.event, [
    "provider_transport_timing",
    "foundation_trace",
    "checkout_trace",
    "confirmation_trace",
    "provider_token_cache",
    "hitpay_transport_failure",
  ]);
  if (!result.event) return;
  metrics(result, "", source, ["durationMs"]);
  choice(result, "outcome", source.outcome, ["ok", "error"]);
  if (source.event === "provider_transport_timing") {
    choice(result, "operation", source.operation, [
      "public_auth",
      "admin_auth",
      "simplybook",
      "hitpay_create",
    ]);
    if (!result.operation) return;
    metrics(result, "", source, ["headersMs", "bodyMs"]);
  } else if (source.event === "foundation_trace") {
    metrics(result, "d1_execution.", source.d1Execution, [
      "statements",
      "sqlDurationMs",
    ]);
    const colos = object(source.d1Execution).colos;
    if (Array.isArray(colos)) {
      const safe = colos
        .filter((v) => typeof v === "string" && /^[A-Z]{3}$/.test(v))
        .slice(0, 8);
      if (safe.length) result.d1_colos = safe.join(",");
    }
    choice(result, "boundary", source.boundary, [
      "http",
      "coordinator",
      "scheduled",
    ]);
    if (
      number(source.httpStatus) &&
      source.httpStatus >= 100 &&
      source.httpStatus <= 599
    )
      result.http_status = source.httpStatus;
    for (const label of [
      "storage",
      "d1",
      "coordinator",
      "coordinator_rpc",
      "coordinator_wait",
      "provider",
    ])
      metrics(result, label + ".", object(source.spans)[label], [
        "count",
        "durationMs",
        "errors",
      ]);
  } else if (source.event === "checkout_trace") {
    if (typeof source.tokenCached === "boolean")
      result.token_cached = source.tokenCached;
    metrics(result, "", source, ["tokenDurationMs"]);
    let total = 0;
    for (const phase of phases) {
      metrics(result, phase + ".", object(source.phases)[phase], [
        "durationMs",
        "calls",
        "d1Count",
        "d1DurationMs",
        "d1Errors",
      ]);
      total += Number(result[phase + ".d1Count"] ?? 0);
    }
    result.d1_count = total;
  } else if (source.event === "confirmation_trace") {
    choice(result, "boundary", source.boundary, [
      "recovery",
      "status",
      "context",
      "receipt",
    ]);
    choice(result, "result", source.result, [
      "pending",
      "complete",
      "manual_review",
      "not_claimed",
    ]);
    if (
      typeof source.recoveryKey === "string" &&
      /^[a-f0-9]{64}$/.test(source.recoveryKey)
    )
      result.recovery_key = source.recoveryKey;
    for (const stage of stages)
      metrics(result, "stage." + stage + ".", object(source.stages)[stage], [
        "durationMs",
      ]);
    for (const operation of operations)
      metrics(result, operation + ".", object(source.operations)[operation], [
        "count",
        "durationMs",
        "errors",
      ]);
    for (const family of ["public", "admin", "identity"])
      metrics(result, "cache.", source.caches, [
        family + "_hit",
        family + "_miss",
        family + "_shared",
      ]);
  } else if (source.event === "provider_token_cache") {
    choice(result, "family", source.family, ["public", "admin"]);
    choice(result, "result", source.result, [
      "absent",
      "restored",
      "invalid",
      "expired",
      "scope_changed",
      "authentication_rejected",
      "stale_rejection",
      "refresh_due",
      "refreshed",
    ]);
    if (!result.family || !result.result) return;
  } else {
    choice(result, "operation", source.operation, ["create", "read", "search"]);
    choice(result, "representation", source.representation, [
      "json",
      "html",
      "other",
      "missing",
    ]);
    metrics(result, "", source, ["status"]);
    result.outcome = "error";
  }
  return result;
}
const attributes = (fields: Fields) =>
  Object.entries(fields).map(([key, value]) => ({
    key: "soccerbot." + key,
    value:
      typeof value === "string"
        ? { stringValue: value }
        : typeof value === "boolean"
          ? { boolValue: value }
          : { doubleValue: value },
  }));
const nanos = (ms: number) =>
  (BigInt(Math.round(ms * 1000)) * 1000n).toString();
async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function telemetryPayload(events: TraceItem[], rate: number) {
  const spans = [];
  let dropped = 0;
  for (const event of events.slice(0, 32)) {
    if (event.scriptName !== "soccerbot-dev") continue;
    const records: { fields: Fields; timestamp: number; index: number }[] = [];
    for (const [index, log] of event.logs.slice(0, 256).entries()) {
      const message: unknown = log.message;
      if (
        !Array.isArray(message) ||
        message.length !== 1 ||
        typeof message[0] !== "string" ||
        message[0].length > 32768 ||
        !Number.isSafeInteger(log.timestamp) ||
        log.timestamp < 0 ||
        log.timestamp > 8640000000000000
      )
        continue;
      try {
        const fields = sanitizeDiagnostic(JSON.parse(message[0]));
        if (fields) records.push({ fields, timestamp: log.timestamp, index });
      } catch {
        /* Malformed/unrelated messages are discarded, never forwarded. */
      }
    }
    const failed =
      event.outcome !== "ok" ||
      records.some(
        ({ fields }) =>
          fields.outcome === "error" ||
          fields.result === "manual_review" ||
          fields.result === "invalid" ||
          fields.result === "authentication_rejected",
      );
    for (const { fields, timestamp, index } of records) {
      const id = String(fields.correlation_id).replaceAll("-", "");
      if (!failed && parseInt(id.slice(-8), 16) / 0x100000000 >= rate) continue;
      if (spans.length >= 128) {
        dropped++;
        continue;
      }
      // Each invocation has its own trace. Explicit correlation attributes join
      // HTTP/RPC/alarms without inventing parents or extending a days-old trace.
      const digest = await hash(
        id +
          ":" +
          (event.eventTimestamp ?? records[0]?.timestamp) +
          ":" +
          event.executionModel,
      );
      const spanId = (await hash(digest + ":" + index + ":" + timestamp)).slice(
        0,
        16,
      );
      const duration =
        typeof fields.durationMs === "number"
          ? Math.min(fields.durationMs, timestamp)
          : 0;
      fields.sample_rate = failed ? 1 : rate;
      fields.retention = failed ? "failure" : "sampled_success";
      fields.timing = "diagnostic_summary";
      fields.truncated = event.truncated === true;
      choice(fields, "execution_model", event.executionModel, [
        "stateless",
        "stateful",
      ]);
      if (event.scriptVersion?.id && uuid.test(event.scriptVersion.id))
        fields.worker_version = event.scriptVersion.id;
      spans.push({
        traceId: digest.slice(0, 32),
        spanId,
        name:
          "soccerbot." +
          fields.event +
          (fields.boundary ? "." + fields.boundary : ""),
        kind: 1,
        startTimeUnixNano: nanos(timestamp - duration),
        endTimeUnixNano: nanos(timestamp),
        attributes: attributes(fields),
        status: { code: fields.outcome === "error" ? 2 : 0 },
      });
    }
    dropped += Math.max(0, event.logs.length - 256);
  }
  return { spans, dropped: dropped + Math.max(0, events.length - 32) };
}

export default {
  async tail(events, env) {
    if (env.EXPORT_ENABLED !== "true") return;
    const rate = Number(env.SUCCESS_SAMPLE_RATE);
    // Only the standard Grafana Cloud OTLP gateway; no redirects/URL credentials.
    if (
      !/^https:\/\/otlp-gateway-[a-z0-9-]+\.grafana\.net\/otlp$/.test(
        env.GRAFANA_OTLP_ENDPOINT,
      ) ||
      !/^Basic [A-Za-z0-9+/]+=*$/.test(env.GRAFANA_AUTHORIZATION) ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 1
    ) {
      console.log(
        JSON.stringify({ event: "telemetry_export", result: "invalid_config" }),
      );
      return;
    }
    const { spans, dropped } = await telemetryPayload(events, rate);
    if (!spans.length) return;
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "soccerbot-dev" } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "soccerbot.sanitized-diagnostics", version: "1" },
              spans,
            },
          ],
        },
      ],
    });
    if (new TextEncoder().encode(body).length > 512000) {
      console.log(
        JSON.stringify({ event: "telemetry_export", result: "oversize" }),
      );
      return;
    }
    try {
      const response = await fetch(env.GRAFANA_OTLP_ENDPOINT + "/v1/traces", {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: {
          "Content-Type": "application/json",
          Authorization: env.GRAFANA_AUTHORIZATION,
        },
        body,
      });
      // Never consume or log a receiver body, which may contain reflected input.
      await response.body?.cancel();
      console.log(
        JSON.stringify({
          event: "telemetry_export",
          result: response.ok ? "accepted_http" : "rejected_http",
          status: response.status,
          spans: spans.length,
          dropped,
        }),
      );
    } catch {
      console.log(
        JSON.stringify({
          event: "telemetry_export",
          result: "unavailable",
          spans: spans.length,
          dropped,
        }),
      );
    }
  },
} satisfies ExportedHandler<TelemetryEnv>;
