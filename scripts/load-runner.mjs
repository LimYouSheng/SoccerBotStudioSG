// Isolated runtime only: intentionally no target URL, credentials or remote mode.
import assert from "node:assert/strict";
import { createBookingMechanism } from "../worker/tests/booking-mechanism-fixture.mjs";
import { loadProvider } from "./load-provider.mjs";
export function distribution(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}
export function campaign(smoke = false) {
  return (smoke ? [1, 3] : [1, 3, 5, 10]).flatMap((customers) =>
    ["baseline", "faults"].map((profile) => ({
      customers,
      profile,
      providerDelayMs: profile === "faults" ? 30 : 0,
      deadlineMs: 120000,
      maxProviderCalls: 2000,
    })),
  );
}
export async function runCohort(config) {
  assert.ok([1, 3, 5, 10].includes(config.customers));
  assert.ok(["baseline", "faults"].includes(config.profile));
  const started = performance.now(),
    rows = [],
    queues = [],
    checkout = [],
    traces = [];
  const provider = loadProvider({
    delayMs: config.providerDelayMs,
    maxCalls: config.maxProviderCalls,
  });
  const m = await createBookingMechanism({
    displayWarming: true,
    respond: provider.respond,
    onLog(line) {
      try {
        const event = JSON.parse(line);
        if (event.event === "provider_queue")
          queues.push({
            priority: event.priority,
            outcome: event.outcome,
            waitMs: event.waitMs,
          });
        if (event.event === "checkout_trace") checkout.push(event.phases);
        if (event.event === "foundation_trace" && event.boundary === "http")
          traces.push(event.spans);
      } catch {
        /* Non-JSON platform logs are not exported. */
      }
    },
  });
  const report = {
    ...config,
    status: "running",
    environment: "isolated-workerd-synthetic-providers",
    requests: rows,
    assertions: [],
    externalNetworkRequests: 0,
  };
  async function request(kind, path, init = {}) {
    assert.ok(
      performance.now() - started < config.deadlineMs,
      "Cohort deadline exceeded",
    );
    assert.ok(path.startsWith("/api/"), "Only application API paths allowed");
    const t = performance.now();
    const response = await m.mf.dispatchFetch(m.origin + path, init);
    const body = await response.json();
    rows.push({
      startedAtMs: t - started,
      kind,
      status: response.status,
      durationMs: performance.now() - t,
    });
    return { response, body };
  }
  const customers = [];
  let deadline;
  const work = async () => {
    // Real access routes; unique identities and non-overlapping weekday slots.
    for (let i = 0; i < config.customers; i++) {
      const access = await request("access", "/api/access", {
        method: "POST",
        headers: { origin: m.origin },
      });
      assert.equal(access.response.status, 201);
      const headers = {
        origin: m.origin,
        cookie: access.response.headers.get("set-cookie").split(";")[0],
        "content-type": "application/json",
      };
      const d = new Date(m.startMs);
      d.setUTCDate(d.getUTCDate() + i);
      while (
        [0, 6].includes(d.getUTCDay()) ||
        customers.some((c) => c.date === d.toISOString().slice(0, 10))
      )
        d.setUTCDate(d.getUTCDate() + 1);
      const startMs = d.getTime(),
        size = [1, 4, 8][i % 3],
        id = crypto.randomUUID();
      customers.push({
        id,
        headers,
        date: d.toISOString().slice(0, 10),
        size,
        input: {
          key: id,
          holding: true,
          accepted: true,
          contact: {
            name: `Synthetic Load ${i}`,
            email: `load-${i}@example.test`,
            phone: "+6591234567",
            contactMethod: "email",
            academy: "",
          },
          sessions: Array.from({ length: size }, (_, j) => ({
            serviceId: "2",
            instructorId: "14",
            startMs: startMs + j * 3000000,
            players: 2,
            totalMinor: 8800,
          })),
        },
      });
    }
    const browse = async () => {
      await Promise.all(
        customers.map(async (c) => {
          const catalogue = await request("catalogue", "/api/catalogue");
          assert.equal(catalogue.response.status, 200);
          const calendar = await request(
            "calendar",
            `/api/booking/calendar/2/${c.date.slice(0, 7)}`,
            { headers: c.headers },
          );
          assert.equal(calendar.response.status, 200);
        }),
      );
    };
    await browse();
    const results = await Promise.allSettled(
      customers.map(async (c) => {
        const result = await request(
          `checkout-${c.size}`,
          `/api/booking/checkout/${c.id}`,
          { method: "POST", headers: c.headers, body: JSON.stringify(c.input) },
        );
        assert.equal(
          result.response.status,
          200,
          `Checkout failed: ${result.body.error ?? result.body.state}`,
        );
        assert.equal(
          result.body.paymentAvailable,
          true,
          `Checkout state: ${result.body.state}`,
        );
        assert.equal(result.body.state, "associated");
      }),
    );
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    assert.equal(provider.payments.size, customers.length);
    assert.equal(
      provider.occupied.size,
      customers.reduce((n, c) => n + c.size, 0),
    );
    const before = await m.db
      .prepare(
        "SELECT attempt_id,created_ms,expires_ms,recovery_end_ms FROM hitpay_payments ORDER BY attempt_id",
      )
      .all();
    const attemptDeadlines = (
      await m.db
        .prepare(
          "SELECT a.id,a.deadline_ms,p.booking_created_ms,p.payment_window_ms,p.hold_window_ms FROM attempts a JOIN checkout_progress p ON p.attempt_id=a.id ORDER BY a.id",
        )
        .all()
    ).results;
    const holdDeadlines = (
      await m.db
        .prepare(
          "SELECT attempt_id,expires_ms FROM hitpay_holds ORDER BY attempt_id",
        )
        .all()
    ).results;
    const paymentRows = await m.db
      .prepare("SELECT attempt_id,request_id FROM hitpay_payments")
      .all();
    const webhook = async (id, status) => {
      const r = await request(
        "webhook",
        "/api/webhooks/hitpay",
        provider.webhook(id, status),
      );
      assert.equal(r.response.status, 202);
    };
    // First delivery claims completed while provider still says pending: no confirmation authority.
    if (config.profile === "faults") provider.fault(429);
    await webhook(paymentRows.results[0].request_id, "completed");
    await m.recover();
    assert.equal(
      [...provider.groups.values()].filter((g) => g.accepted).length,
      0,
    );
    if (config.profile === "faults") {
      assert.equal(
        provider.faultPending,
        false,
        "429 injection was not exercised",
      );
      provider.fault(503);
    }
    for (const row of paymentRows.results) provider.complete(row.request_id);
    const recoveryStarted = performance.now();
    // Reordered stale payload and duplicates are hints only. Acknowledgement is
    // intentionally discarded, then the exact delivery is repeated.
    await Promise.all([
      browse(),
      ...paymentRows.results.map(async (row) => {
        await webhook(row.request_id, "pending");
        await webhook(row.request_id, "pending");
        await webhook(row.request_id, "completed");
      }),
    ]);
    // A bounded scheduled/re-delivery driver, not a retry of booking/payment creation.
    for (let turn = 0; turn < customers.length + 3; turn++) {
      await m.recover();
      const states = await m.db
        .prepare("SELECT state FROM hitpay_payments")
        .all();
      if (states.results.every((row) => row.state === "complete")) break;
      // A new authentic event wakes recovery without changing original deadlines.
      for (const row of paymentRows.results)
        await webhook(row.request_id, "completed");
    }
    report.recoveryMs = performance.now() - recoveryStarted;
    if (config.profile === "faults")
      assert.equal(
        provider.faultPending,
        false,
        "503 injection was not exercised",
      );
    const states = await m.db
      .prepare("SELECT state,external_state FROM hitpay_payments")
      .all();
    report.paymentStates = states.results;
    assert.equal(states.results.length, customers.length);
    assert.ok(
      states.results.every(
        (row) => row.state === "complete" && row.external_state === "observed",
      ),
      "Recovery did not complete within bounded driver",
    );
    assert.deepEqual(
      (
        await m.db
          .prepare(
            "SELECT attempt_id,created_ms,expires_ms,recovery_end_ms FROM hitpay_payments ORDER BY attempt_id",
          )
          .all()
      ).results,
      before.results,
    );
    assert.deepEqual(
      (
        await m.db
          .prepare(
            "SELECT a.id,a.deadline_ms,p.booking_created_ms,p.payment_window_ms,p.hold_window_ms FROM attempts a JOIN checkout_progress p ON p.attempt_id=a.id ORDER BY a.id",
          )
          .all()
      ).results,
      attemptDeadlines,
    );
    assert.deepEqual(
      (
        await m.db
          .prepare(
            "SELECT attempt_id,expires_ms FROM hitpay_holds ORDER BY attempt_id",
          )
          .all()
      ).results,
      holdDeadlines,
    );
    for (const g of provider.groups.values()) assert.equal(g.accepted, 1);
    const receiptCount = await m.db
      .prepare("SELECT COUNT(*) AS n FROM hitpay_receipts")
      .first();
    report.webhookReceipts = receiptCount.n;
    assert.equal(
      receiptCount.n,
      customers.length * 2,
      "Duplicate webhook receipt was not deduplicated",
    );
    // Read protected context, lose the first dismissal acknowledgement, then retry.
    for (const c of customers) {
      const context = await request(
        "context",
        `/api/attempts/${c.id}/checkout`,
        { headers: c.headers },
      );
      assert.equal(context.response.status, 200);
      assert.ok(context.body.confirmation);
      const first = await request("dismiss", `/api/attempts/${c.id}/dismiss`, {
        method: "POST",
        headers: c.headers,
      });
      assert.equal(first.response.status, 200);
      const repeated = await request(
        "dismiss-redelivery",
        `/api/attempts/${c.id}/dismiss`,
        { method: "POST", headers: c.headers },
      );
      assert.equal(repeated.response.status, 200);
      const current = await request("current", "/api/booking/current", {
        headers: c.headers,
      });
      assert.equal(current.body.state, "empty");
    }
    assert.equal(provider.payments.size, customers.length);
    assert.equal(
      provider.occupied.size,
      customers.reduce((n, c) => n + c.size, 0),
    );
    assert.deepEqual(m.unexpected, []);
    report.assertions = [
      "one-payment-per-complete-attempt",
      "one-booking-per-selected-slot",
      "one-external-accounting-effect",
      "webhook-payload-not-payment-authority",
      "original-payment-deadlines-preserved",
      "confirmed-context",
      "dismissal-redelivery-safe",
      "zero-unexpected-provider-requests",
    ];
    report.status = "passed";
  };
  try {
    await Promise.race([
      work(),
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Cohort deadline exceeded")),
          config.deadlineMs,
        );
      }),
    ]);
  } catch (error) {
    report.status = "failed";
    report.failure = error.message;
    report.retainedStates = (
      await m.db.prepare("SELECT state FROM attempts").all()
    ).results;
  } finally {
    clearTimeout(deadline);
    await m.close();
    report.durationMs = performance.now() - started;
    report.requestLatency = Object.fromEntries(
      [...new Set(rows.map((r) => r.kind))].map((kind) => [
        kind,
        distribution(
          rows.filter((r) => r.kind === kind).map((r) => r.durationMs),
        ),
      ]),
    );
    report.completedRequests = rows.length;
    report.acceptedRequests = rows.filter(
      (r) => r.status >= 200 && r.status < 300,
    ).length;
    report.providerCalls = provider.observations;
    report.queues = queues;
    report.queueWait = Object.fromEntries(
      ["display", "foreground", "recovery"].map((priority) => [
        priority,
        distribution(
          queues
            .filter((q) => q.priority === priority && q.outcome === "started")
            .map((q) => q.waitMs),
        ),
      ]),
    );
    report.checkoutPhases = checkout;
    report.httpStorageMetrics = traces;
  }
  return report;
}
