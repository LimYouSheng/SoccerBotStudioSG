import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
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
const fixtures = JSON.parse(
  readFileSync("worker/tests/native-fixtures.json", "utf8"),
).responses;
const origin = "https://soccerbot.test";
let mf,
  db,
  root,
  reply,
  calls = [];
before(async () => {
  const script = (
    await build({
      entryPoints: ["worker/tests/native-harness.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["cloudflare:workers", "node:async_hooks"],
    })
  ).outputFiles[0].text;
  root = mkdtempSync(path.join(tmpdir(), "soccerbot-native-"));
  mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "native-test",
      modules: true,
      script,
      cf: false,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      bindings: { ...config.vars, APP_ORIGIN: origin },
      d1Databases: { STATE: "synthetic-state" },
      durableObjects: {
        COORDINATOR: {
          className: "SoccerBotAccountCoordinator",
          useSQLite: true,
        },
      },
      serviceBindings: { ASSETS: () => new Response("synthetic") },
      outboundService: async (request) => {
        const body = request.method === "POST" ? await request.json() : null;
        calls.push({ url: request.url, method: request.method, body });
        return reply
          ? reply(request, body)
          : Response.json({
              result: body?.params,
              id: body?.id,
              jsonrpc: "2.0",
            });
      },
    }),
    resourcePersistencePath: root,
    isolatedResourcePersistencePath: root,
  });
  await mf.ready;
  db = await mf.getD1Database("STATE");
  for (const name of readdirSync("migrations")
    .filter((name) => !name.startsWith("0005"))
    .sort())
    await db.exec(
      readFileSync(`migrations/${name}`, "utf8")
        .replace(/^--.*$/gm, "")
        .replace(/\n/g, " "),
    );
  await seedFoundation(mf, db, config);
});
after(async () => {
  await mf?.dispose();
  if (root) rmSync(root, { recursive: true, force: true });
});
function input(paid = true) {
  const now = Date.parse("2026-10-08T01:00:30Z");
  return {
    now,
    scope: {
      attemptId: crypto.randomUUID(),
      companyLogin: "synthetic-developer",
      timezone: "Asia/Singapore",
      intent: {
        accountId: "synthetic-account",
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
      },
    },
    association: { bookingIds: ["701"], invoiceId: "901" },
    booking: structuredClone(
      paid ? fixtures.bookingAfter : fixtures.bookingBefore,
    ),
    invoice: structuredClone(
      paid ? fixtures.invoiceAfter : fixtures.invoiceBefore,
    ),
    creation: structuredClone(fixtures.creation),
  };
}
async function call(action, values = {}) {
  const response = await mf.dispatchFetch(origin + "/test", {
    method: "POST",
    body: JSON.stringify({ ...input(), ...values, action }),
  });
  return { status: response.status, ...(await response.json()) };
}
async function prepared() {
  const res = await mf.dispatchFetch(origin + "/api/access", {
    method: "POST",
    headers: { origin },
  });
  assert.equal(res.status, 201);
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const owner = (
    await db
      .prepare("SELECT owner_id FROM guest_access WHERE capability_hash=?")
      .bind(createHash("sha256").update(cookie.split("=")[1]).digest("hex"))
      .first()
  ).owner_id;
  const data = input(false);
  data.now = Date.now();
  const a = await call("prepare", { ...data, owner });
  assert.equal(a.status, 200);
  data.scope.attemptId = a.result.id;
  return { ...data, cookie };
}
test("native supplied unpaid and paid shapes use stable invoice identity and canonical decisions", async () => {
  const unpaid = await call("normalize", input(false));
  assert.equal(unpaid.status, 200);
  assert.equal(unpaid.result.decision.reason, "payment_pending");
  const paid = await call("normalize");
  assert.equal(paid.status, 200);
  assert.equal(paid.result.decision.status, "confirmed");
  assert.equal(
    paid.result.observation.invoice.invoiceId,
    unpaid.result.observation.invoice.invoiceId,
  );
  assert.equal(paid.result.observation.invoice.lines[0].bookingId, "701");
  assert.equal(
    paid.result.observation.bookings[0].session.playEndMs -
      paid.result.observation.bookings[0].session.startMs,
    2400000,
  );
  assert.equal(
    paid.result.observation.bookings[0].session.occupiedEndMs -
      paid.result.observation.bookings[0].session.startMs,
    3000000,
  );
});
test("native scalar normalization rejects truthiness rounding malformed and unsafe values", async () => {
  for (const [value, expected] of [
    ["88.0000", 8800],
    ["0", 0],
    [88, 8800],
    ["1.01", 101],
    ["1.001", null],
    ["1e2", null],
    ["-1", null],
    ["01", null],
    ["900719925474099.99", null],
  ])
    assert.equal((await call("scalar", { value })).result.money, expected);
  for (const [value, expected] of [
    ["0", false],
    ["1", true],
    [0, false],
    [true, true],
    ["false", null],
    ["true", null],
    [null, null],
  ])
    assert.equal((await call("scalar", { value })).result.flag, expected);
});
test("native creation does not treat require_payment false as paid and uses complete returned invoice", async () => {
  const result = await call("creation");
  assert.equal(result.status, 200);
  assert.equal(result.result.invoice.status, "unpaid");
  assert.equal(result.result.retainedHash, true);
  assert.deepEqual(result.result.association, {
    bookingIds: ["701"],
    invoiceId: "901",
  });
  const data = input();
  data.creation.bookings[0].client_id = "[REDACTED]";
  assert.equal((await call("creation", data)).status, 409);
});
test("native normalization rejects missing foreign extra duplicate and nested associations", async () => {
  for (const mutate of [
    (i) => delete i.lines,
    (i) => (i.lines[0].booking_ids = []),
    (i) => (i.lines[0].booking_ids = [702]),
    (i) => (i.lines[0].booking_ids = [701, 702]),
    (i) => i.lines.push(structuredClone(i.lines[0])),
    (i) => (i.lines[0].bookings[0].id = 702),
    (i) => (i.lines[0].invoice_id = 902),
    (i) => (i.client_id = "[REDACTED]"),
    (i) => (i.lines[0].bookings[0].client_id = "52"),
  ]) {
    const data = input();
    mutate(data.invoice);
    assert.equal((await call("normalize", data)).status, 409);
  }
});
test("native money mismatches and unsupported deposit tax refund semantics fail closed", async () => {
  for (const mutate of [
    (i) => (i.amount = 89),
    (i) => (i.tax_amount = 1),
    (i) => (i.currency = "USD"),
    (i) => (i.lines[0].amount = 87),
    (i) => (i.lines[0].tax_amount = 1),
    (i) => (i.rest_amount = 1),
    (i) => (i.is_with_deposit_amount = true),
    (i) => (i.refund_datetime = "2026-10-08"),
    (i) => (i.lines[0].qty = 2),
    (i) => (i.recurring_profile_id = "synthetic-profile"),
    (i) => (i.deposit_parent_invoice = "synthetic-parent"),
    (i) => (i.require_recurring_payment_method = true),
    (i) => (i.lines[0].recurring_price_without_tax = 88),
    (i) => (i.tip = 1),
  ]) {
    const data = input();
    mutate(data.invoice);
    assert.equal((await call("normalize", data)).status, 409);
  }
  const data = input();
  data.scope.intent.totalMinor = 9900;
  data.scope.intent.sessions[0].totalMinor = 9900;
  for (const k of ["amount", "deposit"]) data.invoice[k] = 99;
  for (const k of [
    "amount",
    "deposit",
    "price",
    "price_without_tax",
    "final_price",
  ])
    data.invoice.lines[0][k] = 99;
  for (const k of ["event_price", "invoice_amount", "invoice_line_amount"])
    data.booking[k] = "99.0000";
  assert.equal(
    (await call("normalize", data)).result.decision.status,
    "confirmed",
  );
});
test("native paid invalid booking and contradictory or unknown payment never confirm", async () => {
  const data = input();
  data.booking.status = "cancelled";
  data.booking.is_confirmed = "0";
  data.invoice.lines[0].bookings[0].is_confirmed = false;
  assert.equal(
    (await call("normalize", data)).result.decision.reason,
    "paid_booking_invalid",
  );
  for (const mutate of [
    (i) => (i.status = "future-state"),
    (i) => (i.payment_received = false),
    (i) => (i.payment_processor = "other"),
  ]) {
    const d = input();
    mutate(d.invoice);
    assert.notEqual(
      (await call("normalize", d)).result.decision.status,
      "confirmed",
    );
  }
});
test("native trusted booking timezone and receipt clocks reject invalid times and stale reads", async () => {
  assert.equal(
    (await call("time", { value: "2026-10-10 09:00:00" })).result,
    Date.parse("2026-10-10T01:00:00Z"),
  );
  for (const value of [
    "2026-02-30 09:00:00",
    "2026-10-10T09:00:00Z",
    "2026-10-10 25:00:00",
  ])
    assert.equal((await call("time", { value })).status, 409);
  assert.equal(
    (await call("time", { value: "2026-10-10 09:00:00", scenario: "UTC" }))
      .status,
    409,
  );
  const data = input();
  data.bookingAt = data.now - 15001;
  assert.equal(
    (await call("normalize", data)).result.decision.reason,
    "stale_observation",
  );
  data.bookingAt = data.now + 1;
  assert.equal(
    (await call("normalize", data)).result.decision.reason,
    "observation_time_invalid",
  );
});
test("native destination accepts only supplied fixed path and rejects absent policy", async () => {
  const link =
    "https://soccerbotstudiosg.simplybook.asia/v2/client/pay-later/id/synthetic-id/hash/synthetic-hash";
  assert.equal((await call("link", { value: { link } })).result, link);
  for (const v of [
    fixtures.link,
    { link: link + "?x=y" },
    { link: link + "#paid" },
    { link: link.replace("https:", "http:") },
    { link: link.replace(".asia/", ".asia.evil.test/") },
    { link: link.replace("/hash/", "/hash/%2f") },
  ])
    assert.equal((await call("link", { value: v })).status, 409);
  assert.equal(
    (await call("link", { value: { link }, scenario: "unconfigured" })).status,
    409,
  );
});
test("native fixed requests reserve each dispatch and reject malformed signatures and RPC errors", async () => {
  calls = [];
  reply = null;
  const result = await call("transport", {
    operation: {
      kind: "availability",
      serviceId: "12",
      instructorId: "14",
      date: "2026-10-10",
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.reserved, 1);
  assert.equal(result.finished, 1);
  assert.equal(calls[0].url, "https://user-api.simplybook.me/");
  assert.equal(calls[0].body.method, "getStartTimeMatrix");
  assert.deepEqual(calls[0].body.params, [
    "2026-10-10",
    "2026-10-10",
    12,
    14,
    1,
  ]);
  for (const [operation, method, params] of [
    [{ kind: "required-fields", serviceId: "12" }, "getAdditionalFields", [12]],
    [
      { kind: "booking-read", bookingId: "701", signature: "a".repeat(32) },
      "getBookingDetails",
      ["701", "a".repeat(32)],
    ],
    [
      {
        kind: "book",
        serviceId: "12",
        instructorId: "14",
        date: "2026-10-10",
        time: "09:00:00",
        client: { synthetic: true },
        intake: { handle_invoice: false },
      },
      "book",
      [
        12,
        14,
        "2026-10-10",
        "09:00:00",
        { synthetic: true },
        { handle_invoice: true },
        1,
        null,
        null,
      ],
    ],
  ]) {
    assert.equal((await call("transport", { operation })).status, 200);
    assert.equal(calls.at(-1).body.method, method);
    assert.deepEqual(calls.at(-1).body.params, params);
  }
  for (const kind of ["invoice-read", "payment-link"]) {
    assert.equal(
      (await call("transport", { operation: { kind, invoiceId: "901" } }))
        .status,
      200,
    );
    assert.equal(
      calls.at(-1).url,
      "https://user-api-v2.simplybook.me/admin/invoices/901" +
        (kind === "payment-link" ? "/payment-link" : ""),
    );
    assert.equal(calls.at(-1).method, "GET");
  }
  const bad = await call("transport", {
    operation: { kind: "booking-read", bookingId: "701", signature: "invalid" },
  });
  assert.equal(bad.status, 409);
  assert.equal(bad.reserved, 0);
  reply = () => Response.json({ result: [], id: "wrong" });
  assert.equal(
    (
      await call("transport", {
        operation: { kind: "required-fields", serviceId: "12" },
      })
    ).status,
    409,
  );
  reply = null;
});
test("native signed read matches the retained legacy signature contract", async () => {
  const result = await call("signature");
  assert.equal(
    result.result,
    createHash("md5")
      .update("701synthetic-booking-hashsynthetic-signing-secret")
      .digest("hex"),
  );
});
test("native closed session admission performs no reservation or provider execution", async () => {
  const before = calls.length;
  for (const operation of [
    { kind: "invoice-read", invoiceId: "901" },
    { kind: "book", serviceId: "12" },
  ]) {
    const result = await call("session-closed", { operation });
    assert.equal(result.error, "provider_access_disabled");
    assert.equal(result.reserved, 0);
  }
  assert.equal(calls.length, before);
});
test("native orchestration consumes one booking response and cannot replay lost writes", async () => {
  const data = await prepared();
  const result = await call("orchestrate", data);
  assert.equal(result.result.state, "associated");
  assert.equal(result.requests, 1);
  const again = await call("orchestrate", data);
  assert.equal(again.requests, 0);
  const lost = await prepared();
  const failure = await call("orchestrate", { ...lost, scenario: "lost" });
  assert.equal(failure.result.state, "recovery_required");
  assert.equal(failure.requests, 1);
  assert.equal((await call("orchestrate", lost)).requests, 0);
});
test("native link effect preserves one capability on reopen and never regenerates lost replies", async () => {
  const data = await prepared();
  await call("orchestrate", data);
  data.value = {
    link: "https://soccerbotstudiosg.simplybook.asia/v2/client/pay-later/id/synthetic-id/hash/synthetic-hash",
  };
  const unknownExpiry = await call("prepare-link", {
    ...data,
    scenario: "expiry-unknown",
  });
  assert.equal(unknownExpiry.status, 409);
  assert.equal(unknownExpiry.requests, 0);
  assert.equal((await call("prepare-link", data)).status, 200);
  const first = await call("stored-link", data),
    second = await call("stored-link", data);
  assert.deepEqual(first.result, second.result);
  assert.equal(first.result.state, "available");
  assert.equal(first.requests, 0);
  assert.equal((await call("prepare-link", data)).requests, 0);
  assert.equal(
    (await call("stored-link", { ...data, now: data.now + 300001 })).result
      .state,
    "unavailable",
  );
  const lost = await prepared();
  await call("orchestrate", lost);
  assert.equal(
    (await call("prepare-link", { ...lost, scenario: "lost" })).requests,
    1,
  );
  assert.equal((await call("prepare-link", lost)).requests, 0);
});
test("native targeted readback persists canonical evidence and leaves other due work untouched", async () => {
  const data = await prepared(),
    other = await prepared();
  await call("orchestrate", data);
  await call("orchestrate", other);
  for (const a of [data, other])
    await db
      .prepare("UPDATE recovery_work SET ready_ms=? WHERE attempt_id=?")
      .bind(Date.now() - 1, a.scope.attemptId)
      .run();
  const snapshot = await db
    .prepare("SELECT * FROM recovery_work WHERE attempt_id=?")
    .bind(other.scope.attemptId)
    .first();
  data.booking = fixtures.bookingAfter;
  data.invoice = fixtures.invoiceAfter;
  data.now = Date.now();
  const result = await call("readback", data);
  assert.equal(result.status, 200);
  assert.equal(result.result.reads, 2);
  assert.equal(result.result.outcomes[0].reason, "verified_terminal");
  assert.deepEqual(
    await db
      .prepare("SELECT * FROM recovery_work WHERE attempt_id=?")
      .bind(other.scope.attemptId)
      .first(),
    snapshot,
  );
  assert.equal((await call("readback", data)).requests, 0);
  assert.equal(
    (await call("readback", { ...other, scenario: "closed" })).error,
    "native_readback_closed",
  );
});

test("native durable signing key and checkout capability stay attempt-owned and revocable", async () => {
  const data = await prepared();
  await call("orchestrate", data);
  assert.equal(
    (await call("stored-signature", data)).result,
    createHash("md5")
      .update("701synthetic-booking-hashsynthetic-signing-secret")
      .digest("hex"),
  );
  assert.equal(
    (await call("stored-signature", { ...data, scenario: "foreign" })).status,
    409,
  );
  data.value = {
    link: "https://soccerbotstudiosg.simplybook.asia/v2/client/pay-later/id/synthetic-id/hash/synthetic-hash",
  };
  await call("prepare-link", data);
  assert.equal(
    (await call("protected-context", data)).result.checkout.state,
    "available",
  );
  const other = await prepared();
  assert.equal(
    (await call("protected-context", { ...data, cookie: other.cookie })).status,
    409,
  );
  await db
    .prepare("UPDATE guest_access SET revoked_ms=? WHERE capability_hash=?")
    .bind(
      Date.now(),
      createHash("sha256").update(data.cookie.split("=")[1]).digest("hex"),
    )
    .run();
  assert.equal((await call("protected-context", data)).status, 409);
});
test("native lost readback stops the pair without replaying booking or link effects", async () => {
  const data = await prepared();
  await call("orchestrate", data);
  await db
    .prepare("UPDATE recovery_work SET ready_ms=? WHERE attempt_id=?")
    .bind(Date.now() - 1, data.scope.attemptId)
    .run();
  const before = (
    await db
      .prepare("SELECT * FROM dispatches WHERE attempt_id=?")
      .bind(data.scope.attemptId)
      .all()
  ).results;
  const result = await call("readback", { ...data, scenario: "lost" });
  assert.equal(result.result.reads, 1);
  assert.equal(result.result.outcomes[0].reason, "read_deferred");
  assert.deepEqual(
    (
      await db
        .prepare("SELECT * FROM dispatches WHERE attempt_id=?")
        .bind(data.scope.attemptId)
        .all()
    ).results,
    before,
  );
  assert.equal((await call("readback", data)).requests, 0);
});
