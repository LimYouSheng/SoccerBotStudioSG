import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { build } from "esbuild";
import ts from "typescript";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { seedFoundation } from "./foundation-fixture.mjs";
const config = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync("wrangler.jsonc", "utf8"),
).config;
const origin = "https://soccerbot.test",
  salt = "synthetic-endpoint-salt",
  key = "synthetic-api-key";
const attemptId = "00000000-0000-4000-8000-000000000001",
  requestId = "00000000-0000-4000-8000-000000000002",
  businessId = "00000000-0000-4000-8000-000000000003",
  paymentId = "00000000-0000-4000-8000-000000000004";
const scope = {
  accountId: config.account_id,
  environmentId: "developer",
  companyLogin: "synthetic-developer",
  businessId,
  merchant: "soccerbot",
  externalProcessor: "manual",
  keyDigest: createHash("sha256").update(key).digest("hex"),
  attemptId,
  intentHash: "synthetic-hash",
  associationJson: '{"invoiceId":"7","bookingIds":["8"]}',
  invoiceId: "7",
  customerId: "synthetic-customer",
  totalMinor: 8800,
  currency: "SGD",
};
const fixtures = JSON.parse(
  readFileSync("worker/tests/native-fixtures.json", "utf8"),
).responses;
let script, mf, db, contract, outbound, handler, logs;
const intent = {
  accountId: config.account_id,
  environmentId: "developer",
  customerId: "51",
  contact: {
    name: "Synthetic Customer",
    email: "synthetic@example.test",
    phone: "+6591234567",
    contactMethod: "email",
    academy: "",
  },
  currency: "SGD",
  totalMinor: 8800,
  taxMinor: 0,
  sessions: [
    {
      serviceId: "12",
      instructorId: "14",
      startMs: Math.floor(Date.now() / 60000) * 60000 + 86400000,
      players: 1,
      totalMinor: 8800,
      taxMinor: 0,
    },
  ],
};
scope.customerId = "51";
scope.invoiceId = "901";
scope.associationJson = JSON.stringify({
  invoiceId: "901",
  bookingIds: ["701"],
});
scope.intentHash = createHash("sha256")
  .update(JSON.stringify(intent))
  .digest("hex");
before(async () => {
  script = (
    await build({
      entryPoints: ["worker/tests/hitpay-harness.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["cloudflare:workers", "node:async_hooks"],
    })
  ).outputFiles[0].text;
  const source = (
    await build({
      entryPoints: ["worker/hitpay-contract.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
    })
  ).outputFiles[0].text;
  contract = await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
});
beforeEach(async () => {
  outbound = 0;
  handler = null;
  logs = [];
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "soccerbot-hitpay-test",
      modules: true,
      script,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      cf: false,
      handleStructuredLogs: (entry) => logs.push(entry.message),
      bindings: {
        ...config.vars,
        APP_ORIGIN: origin,
        SOURCE_REVISION: "a".repeat(40),
        HITPAY_RECOVERY: "enabled",
        HITPAY_CHECKOUT: "enabled",
        HITPAY_CONTRACT_ACCEPTED: "sandbox-reviewed",
        PROVIDER_ACCESS: "trusted-reads",
        LIVE_CUSTOMER_ACCESS: "enabled",
        SIMPLYBOOK_DEV_API_KEY: "synthetic-public-key",
        SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-admin",
        SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "synthetic-admin-key",
        SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
        SIMPLYBOOK_EXTERNAL_PAYMENT: "sandbox-reviewed",
        SIMPLYBOOK_EXTERNAL_PROCESSOR: "manual",
        HITPAY_WEBHOOK: "enabled",
        HITPAY_WEBHOOK_SALT: salt,
        HITPAY_SANDBOX_API_KEY: key,
        HITPAY_BUSINESS_ID: businessId,
        HITPAY_MERCHANT: "soccerbot",
        SIMPLYBOOK_DEV_COMPANY_LOGIN: scope.companyLogin,
      },
      d1Databases: { STATE: "synthetic-state" },
      durableObjects: {
        COORDINATOR: {
          className: "SoccerBotAccountCoordinator",
          useSQLite: true,
        },
      },
      outboundService: (request) => {
        if (handler) return handler(request);
        outbound++;
        return new Response(null, { status: 599 });
      },
      serviceBindings: { ASSETS: () => new Response("static") },
    }),
  );
  await mf.ready;
  db = await mf.getD1Database("STATE");
  for (const name of readdirSync("migrations")
    .sort()
    .filter((n) => !n.startsWith("0005")))
    await db.exec(
      readFileSync(`migrations/${name}`, "utf8")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  await seedFoundation(mf, db);
  await db
    .prepare(
      "INSERT INTO attempts(id,owner_id,idempotency_key,intent_json,intent_hash,created_ms,deadline_ms,state,association_json) VALUES(?,?,?,?,?,?,?,'dispatching',?)",
    )
    .bind(
      attemptId,
      "synthetic-owner",
      "synthetic-idempotency",
      JSON.stringify(intent),
      scope.intentHash,
      Date.now() - 60000,
      Date.now() + 600000,
      scope.associationJson,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO session_effects VALUES(?,'native-booking-key','observed',?)",
    )
    .bind(
      attemptId,
      JSON.stringify({ bookingId: "701", hash: "synthetic-booking-hash" }),
    )
    .run();
  await db
    .prepare("INSERT INTO checkout_payment_routes VALUES(?,'hitpay')")
    .bind(attemptId)
    .run();
});
async function seedPayment({ expired = false, recoveryExpired = false } = {}) {
  await db
    .prepare(
      "INSERT INTO hitpay_payments(attempt_id,scope_json,reference,request_id,expires_ms,created_ms,recovery_end_ms,state,reason,ready_ms) VALUES(?,?,?,?,?,?,?,'due','payment_pending',?)",
    )
    .bind(
      attemptId,
      JSON.stringify(scope),
      "synthetic-reference",
      requestId,
      expired ? Date.now() - 1 : Date.now() + 60000,
      Date.now(),
      recoveryExpired ? Date.now() - 1 : Date.now() + 86400000,
      Date.now() + 60000,
    )
    .run();
}
afterEach(async () => {
  await mf?.dispose();
  assert.equal(outbound, 0, "ingress never dispatches provider traffic");
});
const raw = () =>
  JSON.stringify({
    id: requestId,
    reference_number: "synthetic-reference",
    status: "completed",
    email: "synthetic@example.test",
  });
function send(body = raw(), headers = {}) {
  return mf.dispatchFetch(origin + "/api/webhooks/hitpay", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "Hitpay-Signature": createHmac("sha256", salt).update(body).digest("hex"),
      ...headers,
    },
  });
}
async function row() {
  return db
    .prepare("SELECT * FROM hitpay_payments WHERE attempt_id=?")
    .bind(attemptId)
    .first();
}

test("HitPay ingress verifies untouched bytes before parsing or durable effects", async () => {
  await seedPayment();
  for (const [body, headers, status] of [
    ["{", { "Hitpay-Signature": "0".repeat(64) }, 401],
    ["{", {}, 400],
    [
      raw() + " ",
      {
        "Hitpay-Signature": createHmac("sha256", salt)
          .update(raw())
          .digest("hex"),
      },
      401,
    ],
    [
      raw(),
      {
        "Hitpay-Signature": createHmac("sha256", key)
          .update(raw())
          .digest("hex"),
      },
      401,
    ],
    [raw(), { "content-type": "text/plain" }, 415],
    ["x".repeat(32769), {}, 413],
  ])
    assert.equal((await send(body, headers)).status, status);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM hitpay_receipts").first()).n,
    0,
  );
});
test("HitPay receipts deduplicate concurrent delivery and preserve payment evidence", async () => {
  await seedPayment();
  const replies = await Promise.all(Array.from({ length: 6 }, () => send()));
  assert.deepEqual(
    replies.map((r) => r.status),
    Array(6).fill(202),
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM hitpay_receipts").first()).n,
    1,
  );
  let saved = await row();
  assert.equal(saved.paid_ms, null);
  assert.equal(saved.payment_id, null);
  assert.equal(saved.tries, 0);
  assert.ok(saved.ready_ms <= Date.now());
  await db
    .prepare(
      "UPDATE hitpay_payments SET state='complete',paid_ms=?,payment_id=?,external_state='observed' WHERE attempt_id=?",
    )
    .bind(Date.now(), paymentId, attemptId)
    .run();
  saved = await row();
  assert.equal(
    (await send(JSON.stringify({ id: requestId, status: "failed" }))).status,
    202,
  );
  assert.deepEqual(await row(), saved);
  const receipt = await db
    .prepare("SELECT * FROM hitpay_receipts LIMIT 1")
    .first();
  assert.deepEqual(Object.keys(receipt).sort(), [
    "attempt_id",
    "digest",
    "received_ms",
  ]);
});
test("HitPay ingress rejects foreign references and bounded receipt exhaustion atomically", async () => {
  await seedPayment();
  assert.equal(
    (await send(JSON.stringify({ id: requestId, reference_number: "foreign" })))
      .status,
    409,
  );
  assert.equal(
    (
      await send(
        JSON.stringify({
          id: businessId,
          reference_number: "synthetic-reference",
        }),
      )
    ).status,
    404,
  );
  for (let i = 0; i < 64; i++)
    await db
      .prepare("INSERT INTO hitpay_receipts VALUES(?,?,?)")
      .bind(String(i).padStart(64, "0"), attemptId, Date.now())
      .run();
  const saved = await row();
  assert.notEqual((await send()).status, 202);
  assert.deepEqual(await row(), saved);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM hitpay_receipts").first()).n,
    64,
  );
});
test("HitPay journal makes routes scopes and verified identities immutable", async () => {
  await seedPayment();
  await assert.rejects(
    db
      .prepare(
        "UPDATE checkout_payment_routes SET route='native' WHERE attempt_id=?",
      )
      .bind(attemptId)
      .run(),
  );
  await assert.rejects(
    db
      .prepare("UPDATE hitpay_payments SET scope_json='{}' WHERE attempt_id=?")
      .bind(attemptId)
      .run(),
  );
  await assert.rejects(
    db
      .prepare("UPDATE hitpay_payments SET request_id=? WHERE attempt_id=?")
      .bind(businessId, attemptId)
      .run(),
  );
  await db
    .prepare(
      "UPDATE hitpay_payments SET external_state='unknown' WHERE attempt_id=?",
    )
    .bind(attemptId)
    .run();
  await assert.rejects(
    db
      .prepare(
        "UPDATE hitpay_payments SET external_state='none' WHERE attempt_id=?",
      )
      .bind(attemptId)
      .run(),
  );
});
test("HitPay authoritative contract rejects identity money currency refund and status mismatches", async () => {
  await seedPayment();
  const valid = {
    id: requestId,
    reference_number: "synthetic-reference",
    amount: "88.00",
    currency: "sgd",
    status: "completed",
    allow_repeated_payments: false,
    is_currency_editable: false,
    business_id: businessId,
    url: `https://securecheckout.sandbox.hit-pay.com/payment-request/@soccerbot/${requestId}/checkout`,
    payments: [
      {
        id: paymentId,
        amount: "88.00",
        currency: "SGD",
        status: "succeeded",
        refunded_amount: "0.00",
      },
    ],
  };
  const verify = (v) =>
    contract.verifyHitpayRequest(v, scope, "synthetic-reference", requestId);
  assert.equal(verify(valid).paymentId, paymentId);
  assert.equal(
    verify({
      ...valid,
      business_id: undefined,
      url: valid.url.replace("securecheckout.", "checkout."),
    }).paymentId,
    paymentId,
  );
  for (const url of [
    valid.url.replace("securecheckout.", "checkout.") + "?redirect=evil",
    valid.url
      .replace("securecheckout.", "checkout.")
      .replace("@soccerbot", "@foreign"),
    valid.url.replace("securecheckout.sandbox", "checkout"),
    valid.url
      .replace("securecheckout.", "checkout.")
      .replace(requestId, businessId),
  ])
    assert.throws(() => verify({ ...valid, url }));

  assert.equal(
    verify({ ...valid, expiry_date: "2026-10-15T18:00:00" }).expiresAtMs,
    Date.parse("2026-10-15T10:00:00Z"),
  );
  for (const expiry_date of [
    "2026-02-30T18:00:00",
    "2026-10-15T18:00:00Z",
    "invalid",
  ])
    assert.throws(() => verify({ ...valid, expiry_date }));
  for (const patch of [
    { id: businessId },
    { reference_number: "other" },
    { amount: "88.001" },
    { amount: "87.99" },
    { currency: "USD" },
    { status: "succeeded" },
    { business_id: requestId },
    { allow_repeated_payments: true },
    { is_currency_editable: true },
    { url: valid.url + "?redirect=evil" },
    { payments: [] },
    { payments: [...valid.payments, ...valid.payments] },
    { payments: [{ ...valid.payments[0], refunded_amount: "1" }] },
    { payments: [{ ...valid.payments[0], currency: "USD" }] },
  ])
    assert.throws(() => verify({ ...valid, ...patch }));
  for (const [field, patch] of [
    ["request_id", { id: businessId }],
    ["reference", { reference_number: "other" }],
    ["amount", { amount: "87.99" }],
    ["currency", { currency: "USD" }],
    ["business", { business_id: requestId }],
    ["checkout_url_format", { url: "https://wrong.invalid/private" }],
    ["checkout_path", { url: valid.url.replace("@soccerbot", "@different") }],
  ]) {
    assert.throws(
      () => verify({ ...valid, ...patch }),
      (error) => {
        assert.equal(error.code, "hitpay_association_mismatch");
        assert.equal(
          contract.hitpayFailureReason(error),
          "hitpay_mismatch_" + field,
        );
        return true;
      },
    );
  }
  for (const value of [null, "1e2", -1, " 88", "88.000", Infinity])
    assert.throws(() => contract.minorAmount(value));
  assert.equal(contract.minorAmount("0.01"), 1);
});
function paymentResponse() {
  return {
    id: requestId,
    reference_number: "synthetic-reference",
    amount: "88.00",
    currency: "SGD",
    status: "completed",
    allow_repeated_payments: false,
    is_currency_editable: false,
    business_id: businessId,
    url: `https://securecheckout.sandbox.hit-pay.com/payment-request/@soccerbot/${requestId}/checkout`,
    payments: [
      {
        id: paymentId,
        amount: "88.00",
        currency: "SGD",
        status: "succeeded",
        refunded_amount: "0",
      },
    ],
  };
}
function providerFixture({
  lostWrite = false,
  initialPaid = false,
  wrongAmount = false,
  cancelled = false,
} = {}) {
  let paid = initialPaid,
    writes = 0,
    reads = 0;
  const wall = (ms) =>
    new Date(ms + 28800000).toISOString().slice(0, 19).replace("T", " ");
  const booking = () => {
    const b = structuredClone(
      paid ? fixtures.bookingAfter : fixtures.bookingBefore,
    );
    b.start_date_time = wall(intent.sessions[0].startMs);
    b.end_date_time = wall(intent.sessions[0].startMs + 3000000);
    if (paid) b.invoice_payment_processor = "manual";
    if (cancelled) {
      b.status = "cancelled";
      b.is_confirmed = "0";
    }
    return b;
  };
  const invoice = () => {
    const i = structuredClone(
      paid ? fixtures.invoiceAfter : fixtures.invoiceBefore,
    );
    i.lines[0].bookings[0].start_datetime = wall(intent.sessions[0].startMs);
    i.lines[0].bookings[0].end_datetime = wall(
      intent.sessions[0].startMs + 3000000,
    );
    if (paid) i.payment_processor = "manual";
    return i;
  };
  handler = async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "api.sandbox.hit-pay.com") {
      reads++;
      assert.equal(request.method, "GET");
      assert.equal(request.headers.get("X-BUSINESS-API-KEY"), key);
      return Response.json({
        ...paymentResponse(),
        ...(wrongAmount ? { amount: "89.00" } : {}),
      });
    }
    const body =
      request.method === "POST" || request.method === "PUT"
        ? await request.json()
        : null;
    if (url.pathname === "/login")
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: "synthetic-public-token-123456789",
      });
    if (url.pathname === "/admin/auth")
      return Response.json({
        token: "synthetic-admin-token-123456789",
        require2fa: false,
      });
    if (url.pathname === "/admin/company/info")
      return Response.json({ login: scope.companyLogin });
    if (url.pathname === "/admin/tariff/current")
      return Response.json({
        limits: [{ key: "sheduler_limit", total: 100, rest: 90 }],
      });
    if (url.pathname === "/admin/invoices/901/accept-payment") {
      assert.equal(request.method, "PUT");
      assert.deepEqual(body, { payment_processor: "manual" });
      writes++;
      paid = true;
      if (lostWrite) throw new Error("synthetic-lost-response");
      return Response.json(invoice());
    }
    if (url.pathname === "/admin/invoices/901") return Response.json(invoice());
    if (body?.method === "getBookingDetails")
      return Response.json({ jsonrpc: "2.0", id: body.id, result: booking() });
    throw new Error("unexpected synthetic endpoint");
  };
  return { writes: () => writes, reads: () => reads };
}
async function recover() {
  await db
    .prepare("UPDATE hitpay_payments SET ready_ms=0 WHERE attempt_id=?")
    .bind(attemptId)
    .run();
  return mf.dispatchFetch(origin + "/test/recover");
}
test("HitPay webhook durable alarm races cron without duplicate financial writes", async () => {
  await seedPayment();
  const before = await row();
  const provider = providerFixture();
  assert.equal((await send()).status, 202);
  const queued = await (
    await mf.dispatchFetch(origin + "/test/wakeups")
  ).json();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].attempt_id, attemptId);
  assert.equal((await row()).tries, 0);
  const results = await Promise.all([
    mf.dispatchFetch(origin + "/test/alarm"),
    mf.dispatchFetch(origin + "/test/recover"),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  const saved = await row();
  assert.equal(saved.state, "complete", saved.reason);
  assert.equal(saved.recovery_end_ms, before.recovery_end_ms);
  assert.equal(saved.tries, 1);
  assert.equal(provider.writes(), 1);
  assert.equal(provider.reads(), 1);
  assert.deepEqual(
    await (await mf.dispatchFetch(origin + "/test/wakeups")).json(),
    [],
  );
  assert.equal((await send()).status, 202);
  assert.equal((await mf.dispatchFetch(origin + "/test/alarm")).status, 200);
  assert.equal(provider.writes(), 1);
  assert.equal(provider.reads(), 1);
});

test("HitPay alarm retains a webhook arriving while its earlier wakeup runs", async () => {
  await seedPayment();
  const provider = providerFixture();
  const standard = handler;
  let delivered = false;
  handler = async (request) => {
    if (
      !delivered &&
      new URL(request.url).hostname === "api.sandbox.hit-pay.com"
    ) {
      delivered = true;
      assert.equal((await send()).status, 202);
    }
    return standard(request);
  };
  assert.equal((await send()).status, 202);
  assert.equal((await mf.dispatchFetch(origin + "/test/alarm")).status, 200);
  const pending = await (
    await mf.dispatchFetch(origin + "/test/wakeups")
  ).json();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].generation, 2);
  assert.equal((await mf.dispatchFetch(origin + "/test/alarm")).status, 200);
  assert.deepEqual(
    await (await mf.dispatchFetch(origin + "/test/wakeups")).json(),
    [],
  );
  assert.equal(provider.writes(), 1);
  assert.equal(provider.reads(), 1);
});

test("HitPay recovery independently verifies payment and bookings before one external write", async () => {
  await seedPayment();
  const provider = providerFixture();
  assert.equal((await recover()).status, 200);
  const saved = await row();
  assert.equal(saved.state, "complete", saved.reason);
  assert.equal(saved.reason, "verified");
  assert.equal(saved.external_state, "observed");
  const trace = logs
    .map((message) => {
      try {
        return JSON.parse(message);
      } catch {
        return null;
      }
    })
    .find(
      (entry) =>
        entry?.event === "confirmation_trace" &&
        entry.boundary === "recovery" &&
        entry.result === "complete",
    );
  assert.ok(trace, "real coordinator recovery emits a completed trace");
  assert.equal(
    trace.recoveryKey,
    createHash("sha256")
      .update("confirmation:" + attemptId)
      .digest("hex"),
  );
  assert.equal(trace.operations.admin_auth.count, 1);
  assert.equal(trace.operations.public_auth.count, 1);
  assert.equal(trace.operations.identity.count, 1);
  assert.equal(trace.operations.tariff.count, 1);
  assert.equal(trace.operations.hitpay_read.count, 1);
  assert.equal(trace.operations.accounting_write.count, 1);
  assert.equal(trace.operations.booking_read.count, 2);
  assert.equal(trace.operations.invoice_read.count, 2);
  assert.equal(trace.caches.admin_miss, 1);
  assert.equal(trace.caches.public_miss, 1);
  assert.ok(trace.operations.d1.count > 0);
  assert.equal(
    trace.operations.d1.count,
    Object.values(trace.stages).reduce((n, stage) => n + stage.d1.count, 0),
  );
  const foundation = logs
    .map((message) => {
      try {
        return JSON.parse(message);
      } catch {
        return null;
      }
    })
    .find(
      (entry) =>
        entry?.event === "foundation_trace" &&
        entry.correlationId === trace.correlationId,
    );
  assert.equal(
    trace.operations.d1.count,
    foundation.spans.d1.count,
    "DO SQLite work must not count as D1",
  );
  for (const secret of [
    attemptId,
    requestId,
    paymentId,
    intent.contact.email,
    "synthetic-admin-token",
  ])
    assert.ok(!JSON.stringify(trace).includes(secret));
  assert.equal(provider.writes(), 1);
  assert.equal(provider.reads(), 1);
  await recover();
  assert.equal(provider.writes(), 1);
  assert.equal(provider.reads(), 1);
});
test("HitPay recovery preserves unknown writes and reads back without repeating payment", async () => {
  await seedPayment();
  const provider = providerFixture({ lostWrite: true });
  await recover();
  assert.equal((await row()).external_state, "unknown", (await row()).reason);
  assert.equal(provider.writes(), 1);
  await recover();
  assert.equal((await row()).reason, "cooldown");
  assert.equal(provider.writes(), 1);
  await mf.dispatchFetch(origin + "/test/elapsed-cooldown");
  await recover();
  assert.equal((await row()).state, "complete", (await row()).reason);
  assert.equal(provider.writes(), 1);
});
test("HitPay amount mismatch never finalizes SimplyBook", async () => {
  await seedPayment();
  const provider = providerFixture({ wrongAmount: true });
  await recover();
  assert.equal((await row()).state, "manual_review");
  assert.equal((await row()).reason, "hitpay_mismatch_amount");
  assert.equal(provider.writes(), 0);
});
test("HitPay claims serialize concurrent recovery and exhaust without reopening checkout", async () => {
  await seedPayment();
  await db
    .prepare("UPDATE hitpay_payments SET ready_ms=0 WHERE attempt_id=?")
    .bind(attemptId)
    .run();
  const claims = await Promise.all(
    Array.from({ length: 5 }, () =>
      mf.dispatchFetch(origin + "/test/claim").then((r) => r.json()),
    ),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await row()).tries, 1);
  await db
    .prepare(
      "UPDATE hitpay_payments SET ready_ms=0,tries=12 WHERE attempt_id=?",
    )
    .bind(attemptId)
    .run();
  assert.equal(
    await (await mf.dispatchFetch(origin + "/test/claim")).json(),
    null,
  );
  assert.equal((await row()).state, "manual_review");
});
test("HitPay creation persists intent before dispatch and never repeats an uncertain POST", async () => {
  let posts = 0;
  handler = async (request) => {
    assert.equal(new URL(request.url).hostname, "api.sandbox.hit-pay.com");
    assert.equal(request.method, "POST");
    posts++;
    assert.equal((await row()).reason, "creation_unknown");
    const body = await request.json();
    assert.equal(body.amount, "88.00");
    assert.equal(body.allow_repeated_payments, "false");
    assert.equal(body.send_sms, "false");
    assert.equal(body.send_email, "false");
    assert.equal(body.add_admin_fee, "false");
    assert.deepEqual(body.payment_methods, ["paynow_online", "card"]);
    assert.equal(
      body.redirect_url,
      origin + "/confirmation/?attempt=" + attemptId,
    );
    assert.equal(body.webhook, undefined);
    return new Response("unknown", { status: 503 });
  };
  assert.equal((await mf.dispatchFetch(origin + "/test/create")).status, 409);
  assert.equal((await mf.dispatchFetch(origin + "/test/create")).status, 409);
  assert.equal(posts, 1);
  assert.equal((await row()).request_id, null);
  assert.equal((await row()).reason, "hitpay_http_503_other");
});
test("HitPay creation recovery searches exact reference without another POST", async () => {
  let posts = 0,
    searches = 0;
  const reference = `soccerbot-dev-${attemptId}`;
  handler = async (request) => {
    if (request.method === "POST") {
      posts++;
      return new Response(null, { status: 503 });
    }
    if (new URL(request.url).search) {
      searches++;
      assert.equal(new URL(request.url).searchParams.get("search"), reference);
      return Response.json({
        data: [{ id: requestId, reference_number: reference }],
      });
    }
    return Response.json({
      ...paymentResponse(),
      reference_number: reference,
      status: "pending",
      payments: [],
    });
  };
  await mf.dispatchFetch(origin + "/test/create");
  await recover();
  assert.equal(posts, 1);
  assert.equal(searches, 1);
  assert.equal((await row()).request_id, requestId);
  assert.equal((await row()).state, "due");
});
test("HitPay late payment retains money evidence without recreating or finalizing expired bookings", async () => {
  await seedPayment({ expired: true });
  const provider = providerFixture();
  await recover();
  assert.equal((await row()).state, "manual_review");
  assert.equal((await row()).reason, "hitpay_late_payment_review");
  assert.equal((await row()).payment_id, paymentId);
  assert.equal(provider.writes(), 0);
});
test("HitPay cancelled booking stops finalisation", async () => {
  await seedPayment();
  const provider = providerFixture({ cancelled: true });
  await recover();
  assert.equal((await row()).state, "manual_review");
  assert.equal(provider.writes(), 0);
});

test("HitPay creation accepts only a bounded Singapore expiry and retains a single request", async () => {
  let posts = 0;
  handler = async (request) => {
    posts++;
    const body = await request.json();
    assert.match(body.expires_after, /^[1-4] mins$/);
    return Response.json({
      ...paymentResponse(),
      reference_number: body.reference_number,
      status: "pending",
      payments: [],
      expiry_date: new Date(Date.now() + 28800000 + 180000)
        .toISOString()
        .slice(0, 19),
    });
  };
  assert.equal((await mf.dispatchFetch(origin + "/test/create")).status, 200);
  assert.equal((await row()).request_id, requestId);
  assert.equal((await mf.dispatchFetch(origin + "/test/create")).status, 409);
  assert.equal(posts, 1);
});
test("HitPay protected confirmation queues stale booking proof without resetting recovery or leaking ownership", async () => {
  await seedPayment();
  const provider = providerFixture();
  await recover();
  const token = "a".repeat(64);
  await db
    .prepare(
      "INSERT INTO guest_access(capability_hash,owner_id,issued_ms,expires_ms) VALUES(?,?,?,?)",
    )
    .bind(
      createHash("sha256").update(token).digest("hex"),
      "synthetic-owner",
      Date.now() - 60000,
      Date.now() + 3600000,
    )
    .run();
  const date = new Date(intent.sessions[0].startMs + 28800000)
    .toISOString()
    .slice(0, 10);
  await db
    .prepare(
      "INSERT INTO native_checkout_grants(attempt_id,capability_hash,intent_hash,source_revision,contract_json,not_before_ms,expires_ms,starting_used,maximum_used,state,availability_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      attemptId,
      createHash("sha256").update(token).digest("hex"),
      scope.intentHash,
      "a".repeat(40),
      "{}",
      Date.now(),
      Date.now() + 600000,
      0,
      64,
      "complete",
      JSON.stringify({
        [date]: {
          date,
          observedAtMs: Date.now(),
          offers: [
            {
              serviceId: "12",
              instructorId: "14",
              serviceName: "Synthetic Session",
              instructorName: "Synthetic Trainer",
              startMs: intent.sessions[0].startMs,
              priceMinor: 8800,
              currency: "SGD",
            },
          ],
        },
      }),
    )
    .run();
  const endpoint = origin + `/api/attempts/${attemptId}/confirmation`;
  const headers = { cookie: `__Host-soccerbot-access=${token}` };
  assert.equal((await mf.dispatchFetch(endpoint)).status, 401);
  const original = await db
    .prepare("SELECT observation_json FROM attempts WHERE id=?")
    .bind(attemptId)
    .first();
  // The request began before reconciliation committed its evidence. Actual
  // decision time must follow the storage read, for polling, return and export.
  for (const route of ["confirmation", "checkout", "receipt"]) {
    const response = await mf.dispatchFetch(
      origin + "/test/request-start/" + route,
      { headers },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    if (route === "confirmation") assert.equal(result.status, "confirmed");
    else if (route === "checkout")
      assert.equal(result.confirmation.attemptId, attemptId);
    else assert.equal(result.attemptId, attemptId);
  }
  await db
    .prepare("UPDATE attempts SET confirmation_next_ms=0 WHERE id=?")
    .bind(attemptId)
    .run();
  const future = JSON.parse(original.observation_json);
  for (const proof of [...future.bookings, future.invoice])
    proof.observedAtMs = Date.now() + 60000;
  await db
    .prepare("UPDATE attempts SET observation_json=? WHERE id=?")
    .bind(JSON.stringify(future), attemptId)
    .run();
  const rejected = await mf.dispatchFetch(
    origin + "/test/request-start/confirmation",
    { headers },
  );
  assert.equal((await rejected.json()).reason, "observation_time_invalid");
  assert.equal(
    (
      await mf.dispatchFetch(origin + "/test/request-start/receipt", {
        headers,
      })
    ).status,
    409,
  );
  await db
    .prepare("UPDATE attempts SET confirmation_next_ms=0 WHERE id=?")
    .bind(attemptId)
    .run();
  const observation = JSON.parse(original.observation_json);
  for (const proof of [...observation.bookings, observation.invoice])
    proof.observedAtMs = Date.now() - 30000;
  await db
    .prepare("UPDATE attempts SET observation_json=? WHERE id=?")
    .bind(JSON.stringify(observation), attemptId)
    .run();
  const before = await row();
  const response = await mf.dispatchFetch(endpoint, { headers });
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).reason,
    "payment_received_booking_pending",
  );
  assert.equal((await row()).state, "due");
  assert.equal((await row()).tries, before.tries);
  assert.equal((await row()).recovery_end_ms, before.recovery_end_ms);
  await recover();
  assert.equal((await row()).state, "complete");
  assert.equal(provider.writes(), 1);
  assert.equal(provider.reads(), 2);
  // A later protected return preserves recorded payment without reopening checks.
  const deadline = (
    await db
      .prepare("SELECT deadline_ms FROM attempts WHERE id=?")
      .bind(attemptId)
      .first()
  ).deadline_ms;
  const checkout = origin + `/api/attempts/${attemptId}/checkout`;
  assert.equal((await mf.dispatchFetch(checkout)).status, 401);
  const saved = await row();
  const callsBefore = outbound;
  const context = await mf.dispatchFetch(origin + "/test/late-checkout", {
    headers,
  });
  assert.equal(context.status, 200);
  const body = await context.json();
  assert.deepEqual(body.payment, {
    status: "recorded",
    paidAtMs: saved.paid_ms,
  });
  assert.equal(body.confirmation.attemptId, attemptId);
  assert.equal(body.confirmation.contact.name, "Synthetic Customer");
  assert.equal(body.confirmation.sessions.length, 1);
  assert.ok(body.confirmation.verifiedAtMs < Date.now() + 1200000);
  assert.deepEqual(body.checkout, { state: "unavailable" });
  assert.equal(body.checking.deadlineMs, deadline);
  assert.equal(outbound, callsBefore);
  assert.deepEqual(await row(), saved);
  const finalProof = await db
    .prepare("SELECT observation_json FROM attempts WHERE id=?")
    .bind(attemptId)
    .first();
  const stale = JSON.parse(finalProof.observation_json);
  for (const proof of [...stale.bookings, stale.invoice])
    proof.observedAtMs = Date.now() - 30000;
  await db
    .prepare("UPDATE attempts SET observation_json=? WHERE id=?")
    .bind(JSON.stringify(stale), attemptId)
    .run();
  const staleContext = await (
    await mf.dispatchFetch(checkout, { headers })
  ).json();
  assert.equal(
    staleContext.confirmation.verifiedAtMs,
    stale.invoice.observedAtMs,
  );
  assert.equal(
    (
      await mf.dispatchFetch(origin + `/api/attempts/${attemptId}/receipt`, {
        headers,
      })
    ).status,
    409,
  );
  stale.bookings[0].status = "cancelled";
  await db
    .prepare("UPDATE attempts SET observation_json=? WHERE id=?")
    .bind(JSON.stringify(stale), attemptId)
    .run();
  assert.equal(
    (await (await mf.dispatchFetch(checkout, { headers })).json()).confirmation,
    undefined,
  );
  await db
    .prepare("UPDATE attempts SET observation_json=? WHERE id=?")
    .bind(finalProof.observation_json, attemptId)
    .run();
  assert.equal(outbound, callsBefore);
  const foreignToken = "f".repeat(64);
  await db
    .prepare(
      "INSERT INTO guest_access(capability_hash,owner_id,issued_ms,expires_ms) VALUES(?,?,?,?)",
    )
    .bind(
      createHash("sha256").update(foreignToken).digest("hex"),
      "foreign-owner",
      Date.now() - 1000,
      Date.now() + 3600000,
    )
    .run();
  assert.equal(
    (
      await mf.dispatchFetch(checkout, {
        headers: { cookie: `__Host-soccerbot-access=${foreignToken}` },
      })
    ).status,
    404,
  );
  assert.equal(
    (await mf.dispatchFetch(origin + "/test/foreign-checkout", { headers }))
      .status,
    409,
  );
  await db
    .prepare(
      "UPDATE hitpay_payments SET state='manual_review' WHERE attempt_id=?",
    )
    .bind(attemptId)
    .run();
  assert.equal(
    (await (await mf.dispatchFetch(checkout, { headers })).json()).payment,
    undefined,
  );

  const exitUrl = origin + `/api/attempts/${attemptId}/dismiss`;
  const exitHeaders = { ...headers, origin };
  assert.equal(
    (await mf.dispatchFetch(exitUrl, { method: "POST", headers: exitHeaders }))
      .status,
    409,
  );
  await db
    .prepare("UPDATE hitpay_payments SET state='complete' WHERE attempt_id=?")
    .bind(attemptId)
    .run();
  await db
    .prepare("UPDATE native_checkout_grants SET ongoing=1 WHERE attempt_id=?")
    .bind(attemptId)
    .run();
  const originalGrant = await db
    .prepare("SELECT * FROM native_checkout_grants WHERE attempt_id=?")
    .bind(attemptId)
    .first();
  const originalPayment = await row();
  const originalAttempt = await db
    .prepare("SELECT * FROM attempts WHERE id=?")
    .bind(attemptId)
    .first();
  assert.equal(
    (await mf.dispatchFetch(exitUrl, { method: "POST", headers: { origin } }))
      .status,
    401,
  );
  assert.equal(
    (
      await mf.dispatchFetch(exitUrl, {
        method: "POST",
        headers: { origin, cookie: `__Host-soccerbot-access=${foreignToken}` },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await mf.dispatchFetch(exitUrl, {
        method: "POST",
        headers: { ...headers, origin: "https://foreign.test" },
      })
    ).status,
    403,
  );
  const exits = await Promise.all(
    [1, 2].map(() =>
      mf.dispatchFetch(exitUrl, { method: "POST", headers: exitHeaders }),
    ),
  );
  assert.deepEqual(
    exits.map((r) => r.status),
    [200, 200],
  );
  assert.deepEqual(
    await db
      .prepare(
        "SELECT * FROM completed_native_checkout_grants WHERE attempt_id=?",
      )
      .bind(attemptId)
      .first(),
    originalGrant,
  );
  assert.equal(
    await db
      .prepare("SELECT * FROM native_checkout_grants WHERE attempt_id=?")
      .bind(attemptId)
      .first(),
    null,
  );
  assert.deepEqual(await row(), originalPayment);
  assert.deepEqual(
    await db
      .prepare("SELECT * FROM attempts WHERE id=?")
      .bind(attemptId)
      .first(),
    originalAttempt,
  );
  assert.deepEqual(
    await (
      await mf.dispatchFetch(origin + "/api/booking/current", { headers })
    ).json(),
    { state: "empty" },
  );
  assert.equal(
    (await (await mf.dispatchFetch(checkout, { headers })).json()).confirmation
      .attemptId,
    attemptId,
  );
  assert.equal(outbound, callsBefore);
  // A delayed duplicate exit for the old booking must not clear its successor.
  const nextGrant = {
    ...originalGrant,
    attempt_id: null,
    intent_hash: null,
    state: "granted",
    result_json: null,
  };
  await db
    .prepare(
      `INSERT INTO native_checkout_grants(${Object.keys(nextGrant).join(",")}) VALUES(${Object.keys(
        nextGrant,
      )
        .map(() => "?")
        .join(",")})`,
    )
    .bind(...Object.values(nextGrant))
    .run();
  assert.equal(
    (await mf.dispatchFetch(exitUrl, { method: "POST", headers: exitHeaders }))
      .status,
    200,
  );
  assert.deepEqual(
    await db
      .prepare("SELECT * FROM native_checkout_grants WHERE capability_hash=?")
      .bind(originalGrant.capability_hash)
      .first(),
    nextGrant,
  );
  await assert.rejects(
    db
      .prepare(
        "DELETE FROM completed_native_checkout_grants WHERE attempt_id=?",
      )
      .bind(attemptId)
      .run(),
    /completed_native_preserve/,
  );
});

async function seedHold(expires = Date.now() + 300000) {
  const token = "b".repeat(64);
  await db
    .prepare(
      "INSERT INTO guest_access(capability_hash,owner_id,issued_ms,expires_ms) VALUES(?,?,?,?)",
    )
    .bind(
      createHash("sha256").update(token).digest("hex"),
      "synthetic-owner",
      Date.now() - 60000,
      Date.now() + 600000,
    )
    .run();
  await db
    .prepare("INSERT INTO hitpay_holds VALUES(?,?,?,?,?)")
    .bind(
      attemptId,
      JSON.stringify({
        attemptId,
        companyLogin: scope.companyLogin,
        timezone: "Asia/Singapore",
      }),
      scope.associationJson,
      scope.intentHash,
      expires,
    )
    .run();
  return {
    method: "POST",
    headers: {
      origin,
      cookie: `__Host-soccerbot-access=${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accepted: true }),
  };
}
test("HitPay holding appointment payment uses its existing invoice without availability or another booking", async () => {
  const options = await seedHold();
  const provider = providerFixture();
  const existing = handler;
  let posts = 0;
  handler = async (request) => {
    if (
      new URL(request.url).hostname === "api.sandbox.hit-pay.com" &&
      request.method === "POST"
    ) {
      posts++;
      const body = await request.json();
      return Response.json({
        ...paymentResponse(),
        reference_number: body.reference_number,
        status: "pending",
        payments: [],
        expiry_date: new Date(Date.now() + 28800000 + 180000)
          .toISOString()
          .slice(0, 19),
      });
    }
    // The fixture rejects all availability and booking creation operations.
    return existing(request);
  };
  const endpoint = origin + `/api/booking/hitpay/${attemptId}`;
  assert.equal(
    (
      await mf.dispatchFetch(endpoint, {
        ...options,
        body: JSON.stringify({ accepted: false }),
      })
    ).status,
    400,
  );
  const result = await mf.dispatchFetch(endpoint, options);
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.equal((await result.json()).paymentAvailable, true);
  assert.equal(provider.writes(), 0);
  assert.equal(posts, 1);
  assert.equal((await mf.dispatchFetch(endpoint, options)).status, 200);
  assert.equal(posts, 1);
});
test("HitPay holding appointment expiry blocks payment without querying availability", async () => {
  const options = await seedHold(Date.now() - 1);
  const result = await mf.dispatchFetch(
    origin + `/api/booking/hitpay/${attemptId}`,
    options,
  );
  assert.equal(result.status, 409);
  assert.equal(outbound, 0);
  assert.equal(await row(), null);
});

test("HitPay preexisting invoice payment requires review without another external write", async () => {
  await seedPayment();
  const provider = providerFixture({ initialPaid: true });
  await recover();
  assert.equal((await row()).state, "manual_review");
  assert.equal((await row()).reason, "invoice_already_paid_review");
  assert.equal(provider.writes(), 0);
});

test("HitPay novel webhooks reopen recoverable manual review within a bounded unchanged deadline", async () => {
  await seedPayment();
  const initial = await row();
  await db
    .prepare(
      "UPDATE hitpay_payments SET state='manual_review',reason='recovery_exhausted',tries=12 WHERE attempt_id=?",
    )
    .bind(attemptId)
    .run();
  assert.equal((await send()).status, 202);
  let saved = await row();
  assert.equal(saved.state, "due");
  assert.equal(saved.tries, 12);
  assert.equal(saved.retry_limit, 13);
  assert.equal(saved.recovery_end_ms, initial.recovery_end_ms);
  // The same receipt cannot reopen a later terminal decision.
  await db
    .prepare(
      "UPDATE hitpay_payments SET state='manual_review',reason='recovery_exhausted',tries=13 WHERE attempt_id=?",
    )
    .bind(attemptId)
    .run();
  await send();
  assert.equal((await row()).state, "manual_review");
  // A distinct authenticated event permits the next bounded read.
  await send(
    JSON.stringify({
      id: requestId,
      reference_number: "synthetic-reference",
      status: "completed",
    }),
  );
  assert.equal((await row()).retry_limit, 14);
  const provider = providerFixture();
  await recover();
  saved = await row();
  assert.equal(saved.state, "complete", saved.reason);
  assert.equal(provider.writes(), 1);
  assert.equal(provider.reads(), 1);
  await send();
  await recover();
  assert.equal(provider.writes(), 1);
  assert.equal((await row()).recovery_end_ms, initial.recovery_end_ms);
});
test("HitPay webhook reopening retains security decisions and exhausted retry limits", async () => {
  await seedPayment();
  for (const [reason, tries] of [
    ["hitpay_association_mismatch", 1],
    ["hitpay_paid_booking_invalid", 1],
    ["hitpay_late_payment_review", 1],
    ["recovery_exhausted", 16],
  ]) {
    await db
      .prepare(
        "UPDATE hitpay_payments SET state='manual_review',reason=?,tries=? WHERE attempt_id=?",
      )
      .bind(reason, tries, attemptId)
      .run();
    const before = await row();
    await send(
      JSON.stringify({
        id: requestId,
        reference_number: "synthetic-reference",
        status: reason,
      }),
    );
    assert.deepEqual(await row(), before);
  }
  assert.equal(outbound, 0);
});

test("HitPay webhook cannot extend an expired financial recovery deadline", async () => {
  await seedPayment({ recoveryExpired: true });
  await db
    .prepare(
      "UPDATE hitpay_payments SET state='manual_review',reason='recovery_exhausted' WHERE attempt_id=?",
    )
    .bind(attemptId)
    .run();
  const before = await row();
  assert.equal((await send()).status, 202);
  assert.deepEqual(await row(), before);
  assert.equal(outbound, 0);
});

test("HitPay webhook arriving during a claim is reconciled after its older terminal read", async () => {
  await seedPayment();
  let entered, release;
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  handler = async () => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = recover();
  await reading;
  assert.equal((await row()).state, "claimed");
  assert.equal((await send()).status, 202);
  release(
    Response.json({ ...paymentResponse(), status: "failed", payments: [] }),
  );
  await pending;
  assert.equal((await row()).state, "due");
  assert.equal((await row()).reason, "webhook_recheck_pending");
  const provider = providerFixture();
  await recover();
  assert.equal((await row()).state, "complete", (await row()).reason);
  assert.equal(provider.writes(), 1);
  await send();
  assert.equal((await row()).state, "complete");
});

test("HitPay terminal persistence failure retains a reclaimable lease and durable webhook", async () => {
  await seedPayment();
  // Exercise the last ordinary attempt: the pending receipt must retain its
  // bounded extra reconciliation even when the failed lease is exhausted.
  await db
    .prepare("UPDATE hitpay_payments SET tries=11 WHERE attempt_id=?")
    .bind(attemptId)
    .run();
  let entered, release;
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  handler = async () => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = recover();
  await reading;
  assert.equal((await send()).status, 202);
  await db.exec(
    "CREATE TRIGGER synthetic_reopen_failure BEFORE UPDATE ON hitpay_payments WHEN NEW.reason='webhook_recheck_pending' BEGIN SELECT RAISE(ABORT,'synthetic_storage_failure'); END;",
  );
  release(
    Response.json({ ...paymentResponse(), status: "failed", payments: [] }),
  );
  assert.equal((await pending).status, 500);
  assert.equal((await row()).state, "claimed");
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS count FROM hitpay_receipts").first())
      .count,
    1,
  );
  await db.exec("DROP TRIGGER synthetic_reopen_failure;");
  const provider = providerFixture();
  assert.equal((await recover()).status, 200);
  assert.equal((await row()).state, "complete");
  assert.equal(provider.writes(), 1);
});

test("HitPay creation mismatch retains only a redacted field diagnostic and never repeats creation", async () => {
  let creates = 0;
  handler = async () => {
    creates++;
    return Response.json({
      ...paymentResponse(),
      reference_number: "soccerbot-dev-" + attemptId,
      status: "pending",
      payments: [],
      url: "https://unexpected.invalid/private-token",
    });
  };
  assert.equal((await mf.dispatchFetch(origin + "/test/create")).status, 409);
  let saved = await row();
  assert.equal(saved.reason, "hitpay_mismatch_checkout_url_format");
  assert.equal(saved.request_id, null);
  assert.equal(saved.checkout_url, null);
  assert.equal(saved.external_state, "none");
  assert.equal(JSON.stringify(saved).includes("private-token"), false);
  assert.equal((await mf.dispatchFetch(origin + "/test/create")).status, 409);
  saved = await row();
  assert.equal(saved.reason, "hitpay_mismatch_checkout_url_format");
  assert.equal(creates, 1);
});

async function seedCustomerProgress(createdAtMs = Date.now() - 1000) {
  const date = new Date(intent.sessions[0].startMs + 28800000)
    .toISOString()
    .slice(0, 10);
  await db
    .prepare(
      "INSERT INTO checkout_progress(attempt_id,booking_created_ms) VALUES(?,?)",
    )
    .bind(attemptId, createdAtMs)
    .run();
  await db
    .prepare("UPDATE attempts SET state='observed' WHERE id=?")
    .bind(attemptId)
    .run();
  await db
    .prepare(
      "INSERT INTO native_checkout_grants(attempt_id,capability_hash,intent_hash,source_revision,contract_json,not_before_ms,expires_ms,starting_used,maximum_used,state,availability_json,ongoing) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)",
    )
    .bind(
      attemptId,
      createHash("sha256").update("b".repeat(64)).digest("hex"),
      scope.intentHash,
      "a".repeat(40),
      "{}",
      Date.now() - 1000,
      Date.now() + 600000,
      0,
      64,
      "complete",
      JSON.stringify({
        [date]: {
          date,
          observedAtMs: Date.now(),
          offers: [
            {
              serviceId: "12",
              instructorId: "14",
              serviceName: "Synthetic Session",
              instructorName: "Synthetic Trainer",
              startMs: intent.sessions[0].startMs,
              priceMinor: 8800,
              currency: "SGD",
            },
          ],
        },
      }),
    )
    .run();
}

for (const legacy of [false, true]) {
  test(
    legacy
      ? "legacy customer snapshot remains hidden until current booking reconciliation"
      : "verified HitPay payment waits for current booking and invoice evidence before customer confirmation",
    async () => {
      const options = await seedHold();
      await seedCustomerProgress();
      await seedPayment();
      const provider = providerFixture();
      const previous = handler;
      let release, entered;
      const gate = new Promise((r) => {
        release = r;
      });
      const reading = new Promise((r) => {
        entered = r;
      });
      handler = async (request) => {
        const body = await request
          .clone()
          .json()
          .catch(() => null);
        if (body?.method === "getBookingDetails") {
          entered();
          await gate;
        }
        return previous(request);
      };
      if (legacy) {
        // A legacy early-payment snapshot must not bypass the new evidence gate.
        const details = await (
          await mf.dispatchFetch(
            origin + `/api/attempts/${attemptId}/checkout`,
            {
              headers: { ...options.headers, "X-Booking-Details": "1" },
            },
          )
        ).json();
        assert.equal(details.details.attemptId, attemptId);
        await db
          .prepare(
            "UPDATE checkout_progress SET confirmation_json=? WHERE attempt_id=?",
          )
          .bind(
            JSON.stringify({
              ...details.details,
              verifiedAtMs: Date.now() - 1000,
            }),
            attemptId,
          )
          .run();
      }
      const work = recover();
      try {
        await reading;
        const headers = options.headers;
        const context = await (
          await mf.dispatchFetch(
            origin + `/api/attempts/${attemptId}/checkout`,
            {
              headers,
            },
          )
        ).json();
        assert.equal(context.customerConfirmation, undefined);
        assert.equal(context.confirmation, undefined);
        assert.equal((await row()).state, "claimed");
        assert.equal(provider.writes(), 0);
        assert.equal(
          (
            await mf.dispatchFetch(
              origin + `/api/attempts/${attemptId}/receipt`,
              {
                headers,
              },
            )
          ).status,
          409,
        );
        const decision = await (
          await mf.dispatchFetch(
            origin + `/api/attempts/${attemptId}/confirmation`,
            { headers },
          )
        ).json();
        assert.equal(decision.status, "pending");
        assert.deepEqual(
          decision.customerConfirmation,
          context.customerConfirmation,
        );
        release();
        await work;
        assert.equal(provider.writes(), 1);
        assert.equal((await row()).state, "complete");
        assert.equal(
          (
            await mf.dispatchFetch(
              origin + `/api/attempts/${attemptId}/expire`,
              {
                method: "POST",
                headers,
              },
            )
          ).status,
          409,
        );
        const saved = await (
          await mf.dispatchFetch(
            origin + `/api/attempts/${attemptId}/checkout`,
            {
              headers,
            },
          )
        ).json();
        assert.equal(saved.customerConfirmation.attemptId, attemptId);
        const revisit = await (
          await mf.dispatchFetch(
            origin + `/api/attempts/${attemptId}/checkout`,
            {
              headers,
            },
          )
        ).json();
        assert.deepEqual(
          revisit.customerConfirmation,
          saved.customerConfirmation,
        );
        assert.equal(
          (
            await mf.dispatchFetch(
              origin + `/api/attempts/${attemptId}/receipt`,
              {
                headers,
              },
            )
          ).status,
          200,
        );
      } finally {
        release();
        await work;
      }
    },
  );
}

for (const failure of ["cancelled", "read-failure"]) {
  test(`current booking ${failure} with verified payment never publishes customer success`, async () => {
    const options = await seedHold();
    await seedCustomerProgress();
    await seedPayment();
    const provider = providerFixture({ cancelled: failure === "cancelled" });
    const previous = handler;
    handler = async (request) => {
      const body = await request
        .clone()
        .json()
        .catch(() => null);
      if (failure === "read-failure" && body?.method === "getBookingDetails")
        return new Response("synthetic read unavailable", { status: 503 });
      return previous(request);
    };
    await recover();
    assert.equal(provider.writes(), 0);
    assert.equal((await row()).payment_id, paymentId);
    const context = await (
      await mf.dispatchFetch(origin + `/api/attempts/${attemptId}/checkout`, {
        headers: options.headers,
      })
    ).json();
    assert.equal(context.customerConfirmation, undefined);
    assert.equal(context.confirmation, undefined);
    assert.equal(
      (
        await mf.dispatchFetch(origin + `/api/attempts/${attemptId}/receipt`, {
          headers: options.headers,
        })
      ).status,
      409,
    );
  });
}

test("expired unpaid hold releases only its active grant and retains immutable creation and booking history", async () => {
  const options = await seedHold(Date.now() - 1000);
  await seedCustomerProgress(Date.now() - 600001);
  assert.deepEqual(
    await db
      .prepare(
        "SELECT payment_window_ms,hold_window_ms FROM checkout_progress WHERE attempt_id=?",
      )
      .bind(attemptId)
      .first(),
    { payment_window_ms: 300000, hold_window_ms: 600000 },
  );
  const endpoint = origin + `/api/attempts/${attemptId}/expire`;
  assert.equal(
    (await mf.dispatchFetch(endpoint, { method: "POST", headers: { origin } }))
      .status,
    401,
  );
  assert.equal(
    (
      await mf.dispatchFetch(endpoint, {
        method: "POST",
        headers: { ...options.headers, origin: "https://foreign.test" },
      })
    ).status,
    403,
  );
  const before = await db
    .prepare("SELECT * FROM native_checkout_grants WHERE attempt_id=?")
    .bind(attemptId)
    .first();
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await mf.dispatchFetch(endpoint, {
          method: "POST",
          headers: options.headers,
        })
      ).status,
      200,
    );
  assert.equal(
    await db
      .prepare("SELECT 1 FROM native_checkout_grants WHERE attempt_id=?")
      .bind(attemptId)
      .first(),
    null,
  );
  assert.deepEqual(
    await db
      .prepare(
        "SELECT * FROM expired_native_checkout_grants WHERE attempt_id=?",
      )
      .bind(attemptId)
      .first(),
    before,
  );
  assert.ok(
    await db
      .prepare("SELECT 1 FROM hitpay_holds WHERE attempt_id=?")
      .bind(attemptId)
      .first(),
  );
  assert.ok(
    await db
      .prepare("SELECT 1 FROM attempts WHERE id=?")
      .bind(attemptId)
      .first(),
  );
  await assert.rejects(
    db
      .prepare(
        "UPDATE checkout_progress SET booking_created_ms=? WHERE attempt_id=?",
      )
      .bind(Date.now(), attemptId)
      .run(),
    /checkout_creation_immutable/,
  );
  await assert.rejects(
    db
      .prepare("DELETE FROM expired_native_checkout_grants WHERE attempt_id=?")
      .bind(attemptId)
      .run(),
    /expired_native_preserve/,
  );
});

test("expired checkout retains dispatched payment even after expired status and webhook reconciliation", async () => {
  const options = await seedHold(Date.now() - 1000);
  await seedCustomerProgress(Date.now() - 780001);
  await seedPayment({ expired: true });
  const endpoint = origin + `/api/attempts/${attemptId}/expire`;
  const expire = () =>
    mf.dispatchFetch(endpoint, { method: "POST", headers: options.headers });
  assert.equal((await expire()).status, 409);
  await db
    .prepare(
      "UPDATE hitpay_payments SET state='manual_review',reason='hitpay_payment_expired' WHERE attempt_id=?",
    )
    .bind(attemptId)
    .run();
  await db
    .prepare("INSERT INTO hitpay_receipts VALUES(?,?,?)")
    .bind("new-receipt", attemptId, Date.now())
    .run();
  assert.equal((await expire()).status, 409);
  await db
    .prepare(
      "UPDATE hitpay_payments SET receipt_checkpoint=(SELECT MAX(rowid) FROM hitpay_receipts) WHERE attempt_id=?",
    )
    .bind(attemptId)
    .run();
  assert.equal((await expire()).status, 409);
  assert.ok(
    await db
      .prepare("SELECT 1 FROM native_checkout_grants WHERE attempt_id=?")
      .bind(attemptId)
      .first(),
  );
  assert.ok(await row());
});

test("late verified payment cannot confirm an expired hold or release it for another booking", async () => {
  const options = await seedHold(Date.now() - 500);
  await seedCustomerProgress();
  await seedPayment({ expired: true });
  const provider = providerFixture();
  await recover();
  assert.equal((await row()).reason, "hitpay_late_payment_review");
  assert.equal(provider.writes(), 0);
  const context = await (
    await mf.dispatchFetch(origin + `/api/attempts/${attemptId}/checkout`, {
      headers: options.headers,
    })
  ).json();
  assert.equal(context.customerConfirmation, undefined);
  assert.equal(context.expired, false);
  assert.equal(
    (
      await mf.dispatchFetch(origin + `/api/attempts/${attemptId}/expire`, {
        method: "POST",
        headers: options.headers,
      })
    ).status,
    409,
  );
});

test("on-time HitPay payment reconciles after payment expiry only within the original hold", async () => {
  await seedHold();
  await seedPayment({ expired: true });
  await db
    .prepare(
      "UPDATE hitpay_payments SET paid_ms=?,payment_id=? WHERE attempt_id=?",
    )
    .bind(Date.now() - 60000, paymentId, attemptId)
    .run();
  const provider = providerFixture();
  await recover();
  assert.equal((await row()).state, "complete");
  assert.equal(provider.writes(), 1);
});

test("on-time HitPay payment cannot finalize after the original hold expires", async () => {
  await seedHold(Date.now() - 1000);
  await seedCustomerProgress();
  await seedPayment({ expired: true });
  await db
    .prepare(
      "UPDATE hitpay_payments SET paid_ms=?,payment_id=? WHERE attempt_id=?",
    )
    .bind(Date.now() - 60000, paymentId, attemptId)
    .run();
  const provider = providerFixture();
  await recover();
  assert.equal((await row()).state, "manual_review");
  assert.equal((await row()).reason, "hitpay_late_payment_review");
  assert.equal((await row()).payment_id, paymentId);
  assert.equal(provider.writes(), 0);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT confirmation_json FROM checkout_progress WHERE attempt_id=?",
        )
        .bind(attemptId)
        .first()
    ).confirmation_json,
    null,
  );
});

test("HitPay upstream HTTP diagnostics retain only status and representation without replaying creation", async () => {
  let creates = 0;
  handler = async () => {
    creates++;
    return new Response(
      "<html>private-token synthetic@example.test https://private.invalid/checkout</html>",
      {
        status: 403,
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          Location: "https://private.invalid/checkout",
        },
      },
    );
  };
  const response = await mf.dispatchFetch(origin + "/test/create");
  assert.equal(response.status, 409);
  const saved = await row();
  assert.equal(saved.reason, "hitpay_http_403_html");
  const diagnostic = logs
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find((line) => line?.event === "hitpay_transport_failure");
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "correlationId",
    "event",
    "operation",
    "representation",
    "status",
  ]);
  assert.equal(diagnostic.status, 403);
  assert.equal(diagnostic.operation, "create");
  assert.equal(diagnostic.representation, "html");
  assert.equal(JSON.stringify(logs).includes("private-token"), false);
  assert.equal(JSON.stringify(logs).includes("private.invalid"), false);
  assert.equal(saved.state, "due");
  assert.equal(saved.request_id, null);
  assert.equal(saved.external_state, "none");
  assert.equal(saved.paid_ms, null);
  assert.equal(JSON.stringify(saved).includes("private-token"), false);
  assert.equal(JSON.stringify(saved).includes("private.invalid"), false);
  await mf.dispatchFetch(origin + "/test/create");
  assert.equal(creates, 1);
  assert.deepEqual(await row(), saved);
});

test("HitPay validation diagnostics retain only allowlisted fields without replaying creation", async () => {
  let creates = 0;
  handler = async () => {
    creates++;
    return Response.json(
      {
        message: "private-token",
        errors: {
          expires_after: ["private-token"],
          email: ["synthetic@example.test"],
          "payment_methods.0": ["private-token"],
          "private-token": ["private-token"],
        },
      },
      { status: 422 },
    );
  };
  await mf.dispatchFetch(origin + "/test/create");
  const diagnostic = logs
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find((line) => line?.event === "hitpay_transport_failure");
  assert.deepEqual(diagnostic.validationFields, [
    "payment_methods",
    "expires_after",
    "email",
  ]);
  assert.equal(diagnostic.status, 422);
  assert.equal(JSON.stringify(logs).includes("private-token"), false);
  assert.equal(JSON.stringify(logs).includes("synthetic@example.test"), false);
  assert.equal((await row()).reason, "hitpay_http_422_json");
  assert.equal((await row()).request_id, null);
  await mf.dispatchFetch(origin + "/test/create");
  assert.equal(creates, 1);
});

for (const boundary of ["payment", "booking"]) {
  test(`HitPay recovery rejects a replaced claim after ${boundary} response without accounting or success`, async () => {
    await seedPayment();
    const provider = providerFixture();
    const respond = handler;
    let replaced = false;
    handler = async (request) => {
      const url = new URL(request.url);
      const body =
        request.method === "POST" ? await request.clone().json() : null;
      const response = await respond(request);
      const match =
        boundary === "payment"
          ? url.hostname === "api.sandbox.hit-pay.com"
          : body?.method === "getBookingDetails";
      if (match && !replaced) {
        replaced = true;
        await db
          .prepare(
            "UPDATE hitpay_payments SET generation=generation+1 WHERE attempt_id=? AND state='claimed'",
          )
          .bind(attemptId)
          .run();
      }
      return response;
    };
    await recover();
    assert.equal(replaced, true);
    assert.equal(provider.writes(), 0);
    assert.equal((await row()).state, "claimed");
    assert.equal((await row()).external_state, "none");
    assert.equal(
      (
        await db
          .prepare(
            "SELECT confirmation_json FROM checkout_progress WHERE attempt_id=?",
          )
          .bind(attemptId)
          .first()
      )?.confirmation_json ?? null,
      null,
    );
  });
}
