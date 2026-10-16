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
        contact: {
          name: "Synthetic Test Guest",
          email: "guest@example.invalid",
          phone: "00000000",
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
// Runtime orchestration needs a future synthetic slot; historical parser cases
// above retain their fixed 8 October receipt clock and unchanged sample times.
function runtimeSlot(data, startMs) {
  data.scope.intent.sessions[0].startMs = startMs;
  const wall = (ms) =>
    new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
  for (const booking of [data.booking, data.creation.bookings[0]]) {
    booking.start_date_time = wall(startMs);
    booking.end_date_time = wall(startMs + 50 * 60000);
  }
  for (const invoice of [data.invoice, data.creation.invoice]) {
    invoice.lines[0].bookings[0].start_datetime = wall(startMs);
    invoice.lines[0].bookings[0].end_datetime = wall(startMs + 50 * 60000);
  }
}
async function prepared(multi = false, guest = false, finite = false) {
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
  runtimeSlot(
    data,
    Math.floor(data.now / 86400000) * 86400000 + 3 * 86400000 + 3600000,
  );
  if (multi) addSecondSession(data);
  if (guest) {
    data.scope.intent.customerMode = "booking-contact";
    data.scope.intent.customerId = owner;
    data.association.nativeCustomerId = "51";
    for (const booking of data.creation.bookings)
      booking.client_hash = "synthetic-client-hash";
  }
  if (finite) data.scope.intent.accountId = config.vars.DEPLOYMENT_ACCOUNT_ID;
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
        kind: "booking-cancel",
        bookingId: "701",
        signature: "a".repeat(32),
        evidenceObservedAtMs: Date.now(),
      },
      "cancelBooking",
      [701, "a".repeat(32)],
    ],
    [
      {
        kind: "book",
        serviceId: "12",
        instructorId: "14",
        date: "2026-10-10",
        time: "09:00:00",
        client: {
          name: "Synthetic Test Guest",
          email: "guest@example.invalid",
          phone: "00000000",
        },
        additional: { handle_invoice: true },
      },
      "book",
      [
        12,
        14,
        "2026-10-10",
        "09:00:00",
        {
          name: "Synthetic Test Guest",
          email: "guest@example.invalid",
          phone: "00000000",
        },
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
  const validBook = {
    kind: "book",
    serviceId: "12",
    instructorId: "14",
    date: "2026-10-10",
    time: "09:00:00",
    client: {
      name: "Synthetic Test Guest",
      email: "guest@example.invalid",
      phone: "00000000",
    },
    additional: { handle_invoice: true },
  };
  for (const patch of [
    { client: { ...validBook.client, players: 1 } },
    { client: { ...validBook.client, email: "invalid" } },
    { client: { name: "Synthetic" } },
    { additional: { handle_invoice: false } },
    { additional: { handle_invoice: true, consent: true } },
    { additional: {} },
  ]) {
    const before = calls.length;
    const rejected = await call("transport", {
      operation: { ...validBook, ...patch },
    });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.reserved, 0);
    assert.equal(calls.length, before);
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
  assert.deepEqual(result.sent[0].client, {
    name: data.scope.intent.contact.name,
    email: data.scope.intent.contact.email,
    phone: data.scope.intent.contact.phone,
  });
  const again = await call("orchestrate", data);
  assert.equal(again.requests, 0);
  const lost = await prepared();
  const failure = await call("orchestrate", { ...lost, scenario: "lost" });
  assert.equal(failure.result.state, "recovery_required");
  assert.equal(failure.requests, 1);
  assert.equal((await call("orchestrate", lost)).requests, 0);
});
test("native creation requires an immutable contact snapshot and rejects changed contact before dispatch", async () => {
  const missing = await prepared();
  delete missing.scope.intent.contact;
  const denied = await call("orchestrate", missing);
  assert.equal(denied.error, "native_contact_snapshot_unavailable");
  assert.equal(denied.requests, 0);
  for (const field of ["name", "phone", "academy"]) {
    const changed = await prepared();
    changed.scope.intent.contact[field] =
      field === "phone" ? "11111111" : "Changed Synthetic";
    const result = await call("orchestrate", changed);
    assert.equal(result.result.state, "prerequisites_unavailable");
    assert.equal(result.requests, 0);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM session_effects WHERE attempt_id=?",
          )
          .bind(changed.scope.attemptId)
          .first()
      ).n,
      0,
    );
  }
});
test("native link effect preserves one capability on reopen and never regenerates lost replies", async () => {
  const now = Date.parse("2026-10-08T01:00:00+08:00");
  const timing = {
    invoiceId: "901",
    dueDatetime: "2026-10-08 01:08:30",
    supervisionDeadlineMs: now + 1800000,
    handoffAtMs: now,
  };
  for (const dueDatetime of [
    timing.dueDatetime,
    "2026-10-08T01:08:30+08:00",
    "2026-10-07T17:08:30Z",
    "2026-10-07T12:08:30-05:00",
  ])
    assert.equal(
      (await call("deadline", { now, value: { ...timing, dueDatetime } }))
        .result,
      Date.parse("2026-10-08T01:08:00+08:00"),
    );
  for (const dueDatetime of [
    null,
    "",
    "2026-02-30 01:08:30",
    "2026-10-08 01:00:00",
    "2026-10-08 01:02:59",
    "2026-10-08T01:08:30+25:00",
  ])
    assert.equal(
      (await call("deadline", { now, value: { ...timing, dueDatetime } }))
        .status,
      409,
    );
  assert.equal(
    (
      await call("deadline", {
        now,
        value: { ...timing, supervisionDeadlineMs: now + 180000 },
      })
    ).result,
    now + 180000,
  );
  assert.equal(
    (
      await call("deadline", {
        now,
        value: { ...timing, dueDatetime: "2026-10-08 02:00:00" },
      })
    ).result,
    now + 600000,
  );
  assert.equal(
    (
      await call("deadline", {
        now,
        value: { ...timing, supervisionDeadlineMs: now + 179999 },
      })
    ).status,
    409,
  );
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
  data.booking = structuredClone(fixtures.bookingAfter);
  data.invoice = structuredClone(fixtures.invoiceAfter);
  runtimeSlot(data, data.scope.intent.sessions[0].startMs);
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

// Synthetic extension of the retained one-line shape; not provider batch acceptance.
function addSecondSession(data) {
  const startMs = data.scope.intent.sessions[0].startMs + 86400000;
  const wall = (value) =>
    new Date(value + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
  data.scope.intent.sessions.push({
    ...data.scope.intent.sessions[0],
    startMs,
    players: 4,
  });
  data.scope.intent.totalMinor *= 2;
  data.association.bookingIds.push("702");
  const b = {
    ...data.booking,
    id: "702",
    start_date_time: wall(startMs),
    end_date_time: wall(startMs + 3000000),
    invoice_line_id: "802",
    invoice_amount: "176.0000",
  };
  data.booking.invoice_amount = "176.0000";
  data.booking = [data.booking, b];
  data.creation.bookings.push({
    ...data.creation.bookings[0],
    id: "702",
    start_date_time: wall(startMs),
    end_date_time: wall(startMs + 3000000),
    hash: "synthetic-second-hash",
  });
  for (const invoice of [data.invoice, data.creation.invoice]) {
    invoice.amount = 176;
    invoice.deposit = 176;
    const line = structuredClone(invoice.lines[0]);
    line.id = "802";
    line.booking_ids = [702];
    line.bookings[0].id = 702;
    line.bookings[0].start_datetime = wall(startMs);
    line.bookings[0].end_datetime = wall(startMs + 3000000);
    invoice.lines.push(line);
  }
  return data;
}
test("native multi-session invoice joins every booking irrespective of provider response order", async () => {
  const data = addSecondSession(input());
  data.invoice.lines.reverse();
  data.creation.bookings.reverse();
  data.booking.reverse();
  const normalized = await call("normalize", data);
  assert.equal(normalized.status, 200);
  assert.equal(normalized.result.decision.status, "confirmed");
  assert.equal(normalized.result.observation.invoice.money.totalMinor, 17600);
  const created = await call("creation", data);
  assert.equal(created.status, 200);
  assert.deepEqual(created.result.association.bookingIds, ["701", "702"]);
});
test("native multi-session rejects missing duplicate foreign and financially inconsistent invoice lines", async () => {
  for (const mutate of [
    (d) => d.invoice.lines.pop(),
    (d) => {
      d.invoice.lines[1] = structuredClone(d.invoice.lines[0]);
    },
    (d) => {
      d.invoice.lines[1].bookings[0].client_id = "52";
    },
    (d) => {
      d.invoice.lines[1].amount = 87;
    },
    (d) => {
      d.booking[1].invoice_line_id = "801";
    },
    (d) => {
      d.booking[1].event_buffertime_after = "0";
    },
    (d) => {
      d.invoice.lines[1].qty = 2;
    },
    (d) => {
      d.invoice.amount = 88;
    },
  ]) {
    const data = addSecondSession(input());
    mutate(data);
    assert.equal((await call("normalize", data)).status, 409);
  }
});
test("native batch closure validates the complete invoice independently of allocation envelope fields", async () => {
  for (const bookings of [{ 701: true, 702: true }, undefined]) {
    const data = await prepared(true);
    data.batchClosure = {
      bookings,
      invoice: structuredClone(data.creation.invoice),
    };
    const first = await call("orchestrate", data);
    assert.equal(first.result.state, "associated", JSON.stringify(first));
    assert.deepEqual(
      first.sent.map((x) => x.kind),
      ["batch-create", "book", "book", "batch-close"],
    );
    const row = await db
      .prepare("SELECT association_json FROM attempts WHERE id=?")
      .bind(data.scope.attemptId)
      .first();
    assert.deepEqual(JSON.parse(row.association_json).bookingIds, [
      "701",
      "702",
    ]);
    const second = await call("orchestrate", data);
    assert.equal(second.sent.length, 0);
  }
});
test("native batch closure rejects incomplete foreign changed unpaid and confirmation evidence without replay", async () => {
  for (const mutate of [
    (c) => {
      c.invoice = null;
    },
    (c) => {
      c.invoice.lines.pop();
    },
    (c) => {
      c.invoice.lines[1] = structuredClone(c.invoice.lines[0]);
    },
    (c) => {
      c.invoice.lines[1].bookings[0].client_id = "52";
    },
    (c) => {
      c.invoice.lines[1].bookings[0].service_id = "99";
    },
    (c) => {
      c.invoice.lines[1].bookings[0].start_datetime = "2026-10-12 09:00:00";
    },
    (c) => {
      c.invoice.lines[1].bookings[0].is_confirmed = false;
    },
    (c) => {
      c.invoice.lines[1].amount = 87;
    },
    (c) => {
      c.invoice.amount = 88;
    },
    (c) => {
      c.invoice.currency = "USD";
    },
    (c) => {
      c.invoice.status = "paid";
      c.invoice.payment_received = true;
      c.invoice.payment_processor = "hitpay";
    },
    (c) => {
      c.require_confirm = true;
    },
    (c) => {
      c.require_confirm = "invalid";
    },
  ]) {
    const data = await prepared(true);
    data.batchClosure = {
      bookings: { 701: true, 702: true },
      invoice: structuredClone(data.creation.invoice),
    };
    mutate(data.batchClosure);
    const result = await call("orchestrate", data);
    assert.equal(result.result.state, "recovery_required");
    assert.equal(result.sent.filter((x) => x.kind === "batch-close").length, 1);
    assert.equal(
      result.sent.filter((x) => x.kind === "payment-link").length,
      0,
    );
    const row = await db
      .prepare("SELECT association_json FROM attempts WHERE id=?")
      .bind(data.scope.attemptId)
      .first();
    assert.equal(row.association_json, null);
    assert.equal((await call("orchestrate", data)).sent.length, 0);
  }
});
test("native batch reserves once finalizes all sessions and cannot repeat across adapter instances", async () => {
  const data = await prepared(true);
  const first = await call("orchestrate", data);
  assert.equal(first.result.state, "associated");
  assert.deepEqual(
    first.sent.map((x) => x.kind),
    ["batch-create", "book", "book", "batch-close"],
  );
  assert.equal(first.sent[1].batchId, "601");
  assert.equal(first.sent[2].batchId, "601");
  const effects = (
    await db
      .prepare(
        "SELECT step,outcome FROM session_effects WHERE attempt_id=? ORDER BY step",
      )
      .bind(data.scope.attemptId)
      .all()
  ).results;
  assert.deepEqual(
    effects.map((x) => x.step),
    [
      "finalize",
      "native-batch",
      "native-booking-key:0",
      "native-booking-key:1",
      "session:0",
      "session:1",
    ],
  );
  assert.ok(effects.every((x) => x.outcome === "observed"));
  assert.equal((await call("orchestrate", data)).requests, 0);
  assert.equal((await call("stored-signature", data)).status, 200);
});
test("native batch receipts select the unique new booking from the complete unordered retained set", async () => {
  for (const reverse of [false, true]) {
    const data = await prepared(true, true);
    const batchReceipts = data.creation.bookings.map((booking, index) => ({
      require_confirm: true,
      invoice: null,
      batch_hash: "synthetic-batch-hash",
      bookings: structuredClone(data.creation.bookings.slice(0, index + 1)),
    }));
    if (reverse) batchReceipts[1].bookings.reverse();
    const result = await call("orchestrate", { ...data, batchReceipts });
    assert.equal(result.result.state, "associated", JSON.stringify(result));
    assert.deepEqual(
      result.sent.map((request) => request.kind),
      ["batch-create", "book", "book", "batch-close"],
    );
    const row = await db
      .prepare("SELECT association_json FROM attempts WHERE id=?")
      .bind(data.scope.attemptId)
      .first();
    assert.deepEqual(JSON.parse(row.association_json).bookingIds, [
      "701",
      "702",
    ]);
    for (const [index, id] of [
      [0, "701"],
      [1, "702"],
    ]) {
      const effect = await db
        .prepare(
          "SELECT reference_id FROM session_effects WHERE attempt_id=? AND step=?",
        )
        .bind(data.scope.attemptId, `native-booking-key:${index}`)
        .first();
      assert.equal(JSON.parse(effect.reference_id).bookingId, id);
    }
    assert.equal(
      (await call("orchestrate", { ...data, batchReceipts })).requests,
      0,
    );
  }
});

test("native batch receipt sets reject absent duplicate foreign changed and premature members without replay", async () => {
  for (const failure of [
    "empty",
    "only-prior",
    "duplicate-prior",
    "duplicate-new",
    "foreign-prior",
    "extra",
    "prior-hash",
    "prior-customer",
    "prior-time",
    "current-time",
    "premature",
  ]) {
    const data = await prepared(true, true);
    const batchReceipts = data.creation.bookings.map((booking, index) => ({
      require_confirm: true,
      invoice: null,
      batch_hash: "synthetic-batch-hash",
      bookings: structuredClone(data.creation.bookings.slice(0, index + 1)),
    }));
    const receipts = batchReceipts[1].bookings;
    if (failure === "empty") batchReceipts[1].bookings = [];
    if (failure === "only-prior") batchReceipts[1].bookings = [receipts[0]];
    if (failure === "duplicate-prior")
      receipts[1] = structuredClone(receipts[0]);
    if (failure === "duplicate-new") receipts[0] = structuredClone(receipts[1]);
    if (failure === "foreign-prior") receipts[0].id = "799";
    if (failure === "extra") receipts.push({ ...receipts[1], id: "799" });
    if (failure === "prior-hash") receipts[0].hash = "synthetic-changed-hash";
    if (failure === "prior-customer") receipts[0].client_id = "52";
    if (failure === "prior-time")
      receipts[0].start_date_time = receipts[1].start_date_time;
    if (failure === "current-time")
      receipts[1].start_date_time = receipts[0].start_date_time;
    if (failure === "premature")
      batchReceipts[0].bookings = structuredClone(receipts);
    const result = await call("orchestrate", { ...data, batchReceipts });
    assert.equal(result.result.state, "recovery_required", failure);
    assert.equal(result.result.paymentAvailable, false, failure);
    assert.equal(
      result.sent.filter((request) => request.kind === "batch-close").length,
      0,
      failure,
    );
    const row = await db
      .prepare("SELECT association_json FROM attempts WHERE id=?")
      .bind(data.scope.attemptId)
      .first();
    assert.equal(row.association_json, null, failure);
    if (
      ["prior-hash", "prior-customer", "prior-time", "current-time"].includes(
        failure,
      )
    ) {
      const retained = await db
        .prepare(
          "SELECT reference_id FROM session_effects WHERE attempt_id=? AND step='native-booking-key:1'",
        )
        .bind(data.scope.attemptId)
        .first();
      assert.equal(JSON.parse(retained.reference_id).bookingId, "702", failure);
    }
    assert.equal(
      (await call("orchestrate", { ...data, batchReceipts })).requests,
      0,
      failure,
    );
  }
});

test("native missing batch echoes retain the created ID signature and exact final booking set", async () => {
  for (const echo of ["missing", null]) {
    for (const finalState of [
      "valid",
      "foreign-ids",
      "missing-invoice",
      "wrong-total",
      "requires-confirmation",
    ]) {
      const data = await prepared(true, true);
      const batchReceipts = data.creation.bookings.map((booking) => {
        const receipt = {
          require_confirm: true,
          invoice: null,
          batch_hash: "synthetic-batch-hash",
          bookings: [structuredClone(booking)],
        };
        if (echo === null) receipt.batch_id = null;
        return receipt;
      });
      if (finalState === "foreign-ids") {
        for (const booking of data.creation.bookings)
          booking.id = String(Number(booking.id) + 100);
        for (const line of data.creation.invoice.lines) {
          line.booking_ids = line.booking_ids.map((id) => Number(id) + 100);
          for (const booking of line.bookings)
            booking.id = Number(booking.id) + 100;
        }
      }
      if (finalState === "missing-invoice") data.creation.invoice = null;
      if (finalState === "wrong-total") data.creation.invoice.amount = 88;
      if (finalState === "requires-confirmation")
        data.creation.require_confirm = true;
      const result = await call("orchestrate", { ...data, batchReceipts });
      assert.deepEqual(
        result.sent.map((r) => r.kind),
        ["batch-create", "book", "book", "batch-close"],
        JSON.stringify(result),
      );
      for (const request of result.sent.filter(
        (r) => r.kind === "book" || r.kind === "batch-close",
      ))
        assert.equal(request.batchId, "601");
      assert.equal(
        result.sent.at(-1).signature,
        createHash("md5")
          .update("601synthetic-batch-hashsynthetic-signing-secret")
          .digest("hex"),
      );
      assert.equal(
        result.result.state,
        finalState === "valid" ? "associated" : "recovery_required",
      );
      assert.equal(result.result.paymentAvailable, false);
      const row = await db
        .prepare("SELECT association_json FROM attempts WHERE id=?")
        .bind(data.scope.attemptId)
        .first();
      assert.equal(row.association_json !== null, finalState === "valid");
      assert.equal(
        (await call("orchestrate", { ...data, batchReceipts })).requests,
        0,
      );
    }
  }
});

test("native missing batch echo still requires a valid unchanged batch hash before closure", async () => {
  for (const failure of ["missing", "malformed", "changed"]) {
    const data = await prepared(true, true);
    const batchReceipts = data.creation.bookings.map((booking) => ({
      require_confirm: true,
      invoice: null,
      batch_hash: "synthetic-batch-hash",
      bookings: [structuredClone(booking)],
    }));
    if (failure === "missing") delete batchReceipts[0].batch_hash;
    if (failure === "malformed") batchReceipts[0].batch_hash = {};
    if (failure === "changed")
      batchReceipts[1].batch_hash = "synthetic-foreign-hash";
    const result = await call("orchestrate", { ...data, batchReceipts });
    assert.equal(result.result.state, "recovery_required");
    assert.equal(result.result.paymentAvailable, false);
    assert.deepEqual(result.validation, {
      field: "creation.batch_hash",
      problem: failure === "changed" ? "mismatch" : failure,
    });
    assert.equal(result.sent.filter((r) => r.kind === "batch-close").length, 0);
    assert.equal(
      (await call("orchestrate", { ...data, batchReceipts })).requests,
      0,
    );
  }
});

test("native lost batch closure keeps all original references and withholds payment without replay", async () => {
  const data = await prepared(true);
  const first = await call("orchestrate", {
    ...data,
    scenario: "batch-close-lost",
  });
  assert.equal(first.result.state, "recovery_required");
  assert.equal(first.result.paymentAvailable, false);
  const effects = (
    await db
      .prepare(
        "SELECT step,outcome,reference_id FROM session_effects WHERE attempt_id=? ORDER BY step",
      )
      .bind(data.scope.attemptId)
      .all()
  ).results;
  assert.equal(effects.find((x) => x.step === "finalize").outcome, "unknown");
  assert.equal(effects.find((x) => x.step === "session:0").reference_id, "701");
  assert.equal(effects.find((x) => x.step === "session:1").reference_id, "702");
  assert.equal((await call("orchestrate", data)).requests, 0);
});

test("native guest batch binds only the new client receipt and signs later sessions without a directory lookup", async () => {
  const data = await prepared(true, true);
  const first = await call("orchestrate", data);
  assert.equal(first.result.state, "associated");
  const books = first.sent.filter((x) => x.kind === "book");
  assert.equal(books[0].client.client_id, undefined);
  assert.equal(books[0].client.client_sign, undefined);
  assert.equal(books[1].client.client_id, "51");
  assert.match(books[1].client.client_sign, /^[a-f0-9]{32}$/);
  const row = await db
    .prepare("SELECT association_json FROM attempts WHERE id=?")
    .bind(data.scope.attemptId)
    .first();
  assert.equal(JSON.parse(row.association_json).nativeCustomerId, "51");
  assert.deepEqual(
    first.sent.map((x) => x.kind),
    ["batch-create", "book", "book", "batch-close"],
  );
  assert.equal(
    (await call("normalize", data)).result.observation.invoice.customerId,
    data.scope.intent.customerId,
  );
});

test("native guest creation rejects mixed client receipts and retains a known booking when its client hash is missing", async () => {
  const data = await prepared(true, true);
  const mixed = structuredClone(data);
  mixed.creation.bookings[1].client_id = "52";
  assert.equal((await call("creation", mixed)).status, 409);
  delete data.creation.bookings[0].client_hash;
  const result = await call("orchestrate", data);
  assert.equal(result.result.state, "recovery_required");
  assert.equal(result.requests, 2);
  const key = await db
    .prepare(
      "SELECT reference_id FROM session_effects WHERE attempt_id=? AND step='native-booking-key:0'",
    )
    .bind(data.scope.attemptId)
    .first();
  assert.equal(JSON.parse(key.reference_id).bookingId, "701");
  assert.equal((await call("orchestrate", data)).requests, 0);
});

async function grantNative(data, overrides = {}) {
  const attempt = await db
    .prepare("SELECT intent_hash,deadline_ms FROM attempts WHERE id=?")
    .bind(data.scope.attemptId)
    .first();
  const contract = {
    accountId: config.vars.DEPLOYMENT_ACCOUNT_ID,
    environmentId: "developer",
    companyLogin: "synthetic-developer",
    serviceId: "12",
    priceMinor: 8800,
    currency: "SGD",
    taxMinor: 0,
    durationMinutes: 40,
    bufferAfterMinutes: 10,
    clientLoginRequired: false,
    providerSchedules: "non-overlapping",
    confirmedAtMs: Date.now() - 1000,
    expiresAtMs: attempt.deadline_ms,
  };
  const grant = {
    intentHash: attempt.intent_hash,
    revision: "c".repeat(40),
    expires: attempt.deadline_ms - 1000,
    ...overrides,
  };
  await db
    .prepare(
      "INSERT INTO native_checkout_grants(attempt_id,capability_hash,intent_hash,source_revision,contract_json,not_before_ms,expires_ms,starting_used,maximum_used,state,result_json) VALUES(?,?,?,?,?,?,?,?,?,'granted',NULL)",
    )
    .bind(
      data.scope.attemptId,
      createHash("sha256").update(data.cookie.split("=")[1]).digest("hex"),
      grant.intentHash,
      grant.revision,
      JSON.stringify(contract),
      Date.now() - 1000,
      grant.expires,
      grant.startingUsed ?? 15,
      grant.maximumUsed ?? 60,
    )
    .run();
}

test("native finite grant rejects absent wrong revision changed intent and expired authority before provider dispatch", async () => {
  for (const overrides of [
    null,
    { revision: "d".repeat(40) },
    { intentHash: "e".repeat(64) },
    { expires: Date.now() + 1000 },
  ]) {
    const data = await prepared(false, true, true);
    if (overrides) await grantNative(data, overrides);
    const before = calls.length;
    const result = await call("finite-checkout", data);
    assert.equal(result.status, 409);
    assert.equal(result.reserved, 0);
    assert.equal(calls.length, before);
  }
});

function nativeProviderReply(data, wall) {
  return async (request, body) => {
    if (request.url.endsWith("/admin/auth"))
      return Response.json({ token: "synthetic-admin-token" });
    if (request.url.endsWith("/admin/company/info"))
      return Response.json({ login: "synthetic-developer" });
    if (request.url.endsWith("/admin/tariff/current"))
      return Response.json({
        limits: [{ key: "sheduler_limit", total: 100, rest: 100 }],
      });
    if (request.url.endsWith("/admin/invoices/901/payment-link"))
      return Response.json({
        link: "https://soccerbotstudiosg.simplybook.asia/v2/client/pay-later/id/synthetic-id/hash/synthetic-hash",
      });
    if (request.url.endsWith("/admin/invoices/901"))
      return Response.json(data.invoice);
    const results = {
      getToken: "synthetic-public-token",
      getEventList: {
        12: {
          id: 12,
          name: "Synthetic Session",
          duration: "40",
          is_active: "1",
          is_public: "1",
          is_recurring: "0",
          price: "88",
          currency: "SGD",
          unit_map: [14],
        },
      },
      getUnitList: {
        14: { id: 14, name: "Synthetic Trainer", is_active: "1" },
      },
      getAdditionalFields: [],
      getAvailableUnits: [14],
      getStartTimeMatrix: { [wall.slice(0, 10)]: [wall.slice(11, 19)] },
      book: data.creation,
      getBookingDetails: data.booking,
    };
    assert.ok(Object.hasOwn(results, body.method), body.method);
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: results[body.method],
    });
  };
}

test("native finite checkout composes fresh checks one booking protected payment and replay prevention", async () => {
  const data = await prepared(false, true, true);
  await grantNative(data);
  const wall = new Date(
    data.scope.intent.sessions[0].startMs + 8 * 3600000,
  ).toISOString();
  data.invoice.due_datetime = new Date(Date.now() + 600000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const before = calls.length;
  reply = nativeProviderReply(data, wall);
  try {
    const result = await call("finite-checkout", data);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.result.state, "associated", JSON.stringify(result));
    assert.equal(result.result.paymentAvailable, true);
    const sent = calls.slice(before);
    assert.equal(sent.filter((call) => call.body?.method === "book").length, 1);
    assert.equal(
      sent.filter((call) => call.url.endsWith("/payment-link")).length,
      1,
    );
    assert.ok(result.reserved <= 45);
    assert.equal(result.reserved, result.finished);
    const replay = await call("finite-checkout", data);
    assert.equal(replay.reserved, 0);
    assert.equal(calls.length, before + sent.length);
    assert.equal(
      (await call("protected-context", data)).result.checkout.state,
      "available",
    );
  } finally {
    reply = undefined;
  }
});

test("native forward reads refresh expired identity within accounting and fail closed on a wrong account", async () => {
  for (const wrongAccount of [false, true]) {
    const data = await prepared(false, true, true);
    await grantNative(data);
    const wall = new Date(
      data.scope.intent.sessions[0].startMs + 8 * 3600000,
    ).toISOString();
    data.invoice.due_datetime = new Date(Date.now() + 600000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const standard = nativeProviderReply(data, wall);
    let identities = 0;
    const before = calls.length;
    reply = async (request, body) => {
      if (request.url.endsWith("/admin/company/info")) {
        identities++;
        if (wrongAccount && identities === 2)
          return Response.json({ login: "synthetic-foreign-account" });
      }
      return standard(request, body);
    };
    try {
      // Four identity/auth requests, then the service read crosses the five-second identity TTL.
      const response = await call("finite-checkout", {
        ...data,
        fixtureExpireAfter: 5,
      });
      assert.equal(response.status, 200);
      assert.equal(
        response.result.state,
        wrongAccount ? "prerequisites_unavailable" : "associated",
        JSON.stringify(response),
      );
      assert.equal(response.result.paymentAvailable, !wrongAccount);
      assert.equal(identities, 2);
      assert.equal(response.reserved, response.finished);
      assert.equal(response.reserved, calls.length - before);
      assert.equal(
        calls.slice(before).filter((v) => v.body?.method === "book").length,
        wrongAccount ? 0 : 1,
      );
      const replay = await call("finite-checkout", data);
      assert.equal(replay.reserved, 0);
      assert.equal(calls.length - before, response.reserved);
    } finally {
      reply = undefined;
    }
  }
});

test("native generic reads reject expired identity without spending recovery calls on refresh", async () => {
  const data = input(false);
  const before = calls.length;
  reply = nativeProviderReply(data, "");
  try {
    const response = await call("session-expired", {
      ...data,
      fixtureExpireAfter: 0,
    });
    assert.equal(response.status, 409);
    assert.equal(response.error, "provider_identity_expired");
    assert.equal(response.reserved, 4);
    assert.equal(response.finished, 4);
    assert.equal(calls.length - before, 4);
  } finally {
    reply = undefined;
  }
});

test("native prerequisite diagnostics retain safe private evidence without writes or customer disclosure", async () => {
  for (const scenario of ["eligibility", "required-fields", "allowance"]) {
    const data = await prepared(false, true, true);
    await grantNative(data);
    const wall = new Date(
      data.scope.intent.sessions[0].startMs + 8 * 3600000,
    ).toISOString();
    const standard = nativeProviderReply(data, wall);
    const before = calls.length;
    reply = async (request, body) => {
      if (
        scenario === "allowance" &&
        request.url.endsWith("/admin/tariff/current")
      )
        return Response.json({
          limits: [{ key: "sheduler_limit", total: 100, rest: 0 }],
        });
      if (scenario === "eligibility" && body?.method === "getAvailableUnits")
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { private_customer_value: "must-not-be-retained" },
        });
      if (
        scenario === "required-fields" &&
        body?.method === "getAdditionalFields"
      )
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: [{ secret: "must-not-be-retained" }],
        });
      return standard(request, body);
    };
    try {
      const response = await call("finite-checkout", data);
      assert.equal(response.status, 200);
      assert.equal(response.result.state, "prerequisites_unavailable");
      assert.equal(response.result.paymentAvailable, false);
      assert.equal(Object.hasOwn(response.result, "diagnostic"), false);
      const row = await db
        .prepare(
          "SELECT result_json,state FROM native_checkout_grants WHERE attempt_id=?",
        )
        .bind(data.scope.attemptId)
        .first();
      const diagnostic = JSON.parse(row.result_json).diagnostic;
      assert.equal(row.state, "blocked");
      assert.equal(diagnostic.sessionIndex, 0);
      assert.equal(
        diagnostic.stage,
        scenario === "allowance" ? "allowance" : "prebooking",
      );
      assert.equal(
        diagnostic.code,
        scenario === "allowance"
          ? "native_booking_allowance_unavailable"
          : scenario === "eligibility"
            ? "eligibility_representation_unavailable"
            : "native_prebooking_unavailable",
      );
      if (scenario !== "allowance") {
        assert.equal(
          diagnostic.operation,
          scenario === "eligibility"
            ? "eligible-instructors"
            : "required-fields",
        );
        assert.deepEqual(diagnostic.representation, {
          kind: scenario === "eligibility" ? "object" : "array",
          count: 1,
        });
      }
      assert.doesNotMatch(
        row.result_json,
        /must-not-be-retained|private_customer_value|secret|synthetic-admin-token|synthetic-public-token/,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) n FROM session_effects WHERE attempt_id=?",
            )
            .bind(data.scope.attemptId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        calls
          .slice(before)
          .some(
            (x) =>
              ["book", "createBatch", "closeBatch"].includes(x.body?.method) ||
              x.url.endsWith("/payment-link"),
          ),
        false,
      );
      const sent = calls.length;
      const replay = await call("finite-checkout", data);
      assert.equal(replay.reserved, 0);
      assert.equal(calls.length, sent);
      assert.equal(Object.hasOwn(replay.result, "diagnostic"), false);
    } finally {
      reply = undefined;
    }
  }
});

test("native extended grant needs the exact approved ceiling and retains the carried counter", async () => {
  for (const [fixtureCeiling, startingUsed, maximumUsed, allowed] of [
    ["80", 33, 112, false],
    ["128", 33, 112, true],
    ["129", 33, 112, false],
    ["80", 90, 176, false],
    ["128", 90, 176, false],
    ["192", 90, 176, true],
    ["193", 90, 176, false],
    ["192", 162, 208, false],
    ["224", 162, 208, true],
    ["225", 162, 208, false],
    ["224", 196, 240, false],
    ["256", 196, 240, true],
    ["257", 196, 240, false],
    ["256", 238, 302, false],
    ["512", 238, 302, true],
    ["513", 238, 302, false],
    ["640", 567, 624, true],
    ["704", 567, 624, true],
    ["705", 567, 624, false],
    ["640", 618, 658, false],
    ["704", 618, 658, true],
    ["704", 618, 688, true],
  ]) {
    const data = await prepared(false, true, true);
    await grantNative(data, { startingUsed, maximumUsed });
    const wall = new Date(
      data.scope.intent.sessions[0].startMs + 8 * 3600000,
    ).toISOString();
    const standard = nativeProviderReply(data, wall);
    reply = (request, body) =>
      request.url.endsWith("/admin/tariff/current")
        ? Response.json({
            limits: [{ key: "sheduler_limit", total: 100, rest: 0 }],
          })
        : standard(request, body);
    try {
      const result = await call("finite-checkout", {
        ...data,
        fixtureCeiling,
        fixtureUsed: startingUsed,
      });
      assert.equal(result.result?.paymentAvailable ?? false, false);
      if (allowed) {
        assert.equal(result.status, 200);
        assert.equal(result.result.state, "prerequisites_unavailable");
        assert.ok(result.reserved > 0);
        const row = await db
          .prepare(
            "SELECT result_json FROM native_checkout_grants WHERE attempt_id=?",
          )
          .bind(data.scope.attemptId)
          .first();
        assert.equal(
          JSON.parse(row.result_json).diagnostic.providerUsed,
          startingUsed + result.reserved,
        );
      } else {
        assert.equal(result.status, 409);
        assert.equal(result.reserved, 0);
      }
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) n FROM session_effects WHERE attempt_id=?",
            )
            .bind(data.scope.attemptId)
            .first()
        ).n,
        0,
      );
    } finally {
      reply = undefined;
    }
  }
});

test("native batch rechecks guest revocation after reservation before creating a booking", async () => {
  const data = await prepared(true, true);
  const result = await call("orchestrate", {
    ...data,
    scenario: "revoke-after-batch",
  });
  assert.equal(result.result.state, "recovery_required");
  assert.deepEqual(
    result.sent.map((request) => request.kind),
    ["batch-create"],
  );
  const effects = (
    await db
      .prepare("SELECT * FROM session_effects WHERE attempt_id=?")
      .bind(data.scope.attemptId)
      .all()
  ).results;
  assert.equal(
    effects.find((effect) => effect.step === "native-batch").reference_id,
    "601",
  );
  assert.equal(
    effects.find((effect) => effect.step === "session:0").outcome,
    "unknown",
  );
});

test("native batch accepts pending cart receipts but requires a complete invoice at finalization", async () => {
  for (const finalState of [
    "valid",
    "missing-invoice",
    "requires-confirmation",
    "wrong-total",
  ]) {
    const data = await prepared(true, true);
    if (finalState === "missing-invoice") data.creation.invoice = null;
    if (finalState === "requires-confirmation")
      data.creation.require_confirm = true;
    if (finalState === "wrong-total") data.creation.invoice.amount = 88;
    const result = await call("orchestrate", {
      ...data,
      batchRequiresConfirm: true,
    });
    assert.deepEqual(
      result.sent.map((r) => r.kind),
      ["batch-create", "book", "book", "batch-close"],
      JSON.stringify(result),
    );
    assert.equal(
      result.result.state,
      finalState === "valid" ? "associated" : "recovery_required",
    );
    assert.equal(result.result.paymentAvailable, false);
    const row = await db
      .prepare("SELECT association_json FROM attempts WHERE id=?")
      .bind(data.scope.attemptId)
      .first();
    assert.equal(row.association_json !== null, finalState === "valid");
    assert.equal(
      (await call("orchestrate", { ...data, batchRequiresConfirm: true }))
        .requests,
      0,
    );
  }
});

test("native batch permits unavailable interim payment flags only with strict finalization", async () => {
  for (const interim of ["missing", null]) {
    for (const finalState of [
      "valid",
      "missing",
      null,
      "missing-invoice",
      "requires-confirmation",
      "wrong-total",
    ]) {
      const data = await prepared(true, true);
      const batchReceipts = data.creation.bookings.map((value) => {
        const booking = structuredClone(value);
        if (interim === "missing") delete booking.require_payment;
        else booking.require_payment = interim;
        return {
          require_confirm: true,
          invoice: null,
          batch_id: 601,
          batch_hash: "synthetic-batch-hash",
          bookings: [booking],
        };
      });
      // Closure payment evidence belongs to its complete invoice, while
      // allocation flags remain validated only on the book endpoint.
      if (finalState === "missing")
        delete data.creation.invoice.payment_received;
      if (finalState === null) data.creation.invoice.payment_received = null;
      if (finalState === "missing-invoice") data.creation.invoice = null;
      if (finalState === "requires-confirmation")
        data.creation.require_confirm = true;
      if (finalState === "wrong-total") data.creation.invoice.amount = 88;
      const result = await call("orchestrate", { ...data, batchReceipts });
      assert.deepEqual(
        result.sent.map((r) => r.kind),
        ["batch-create", "book", "book", "batch-close"],
        JSON.stringify(result),
      );
      assert.equal(
        result.result.state,
        finalState === "valid" ? "associated" : "recovery_required",
      );
      assert.equal(result.result.paymentAvailable, false);
      const row = await db
        .prepare("SELECT association_json FROM attempts WHERE id=?")
        .bind(data.scope.attemptId)
        .first();
      assert.equal(row.association_json !== null, finalState === "valid");
      assert.equal(
        (await call("orchestrate", { ...data, batchReceipts })).requests,
        0,
      );
    }
  }
});

test("native batch rejects malformed non-null interim payment flags without further writes", async () => {
  for (const value of ["unknown", "", 2, {}, []]) {
    const data = await prepared(true, true);
    data.creation.bookings[0].require_payment = value;
    const result = await call("orchestrate", data);
    assert.equal(result.result.state, "recovery_required");
    assert.equal(result.result.paymentAvailable, false);
    assert.deepEqual(
      result.sent.map((r) => r.kind),
      ["batch-create", "book"],
    );
    assert.equal((await call("orchestrate", data)).requests, 0);
  }
});

test("native pending cart receipt still rejects invalid flags and foreign session evidence", async () => {
  for (const mismatch of [
    "flag",
    "client",
    "service",
    "time",
    "inactive",
    "hash",
  ]) {
    const data = await prepared(true, true);
    const booking = data.creation.bookings[1];
    if (mismatch === "client") booking.client_id = "99";
    if (mismatch === "service") booking.event_id = "99";
    if (mismatch === "time") booking.start_date_time = "2026-01-01 09:00:00";
    if (mismatch === "inactive") booking.is_confirmed = "0";
    if (mismatch === "hash") delete booking.hash;
    const result = await call("orchestrate", {
      ...data,
      batchRequiresConfirm: mismatch === "flag" ? "unknown" : true,
    });
    assert.equal(result.result.state, "recovery_required");
    assert.equal(result.result.paymentAvailable, false);
    assert.equal(result.sent.filter((r) => r.kind === "batch-close").length, 0);
    assert.equal((await call("orchestrate", data)).requests, 0);
  }
});

test("native lost batch finalization reconciles all retained IDs without replay and rejects invoice conflicts", async () => {
  for (const mismatch of [false, true]) {
    const data = await prepared(true, true);
    assert.equal(
      (await call("orchestrate", { ...data, scenario: "batch-close-lost" }))
        .result.state,
      "recovery_required",
    );
    if (mismatch) data.booking[1].invoice_id = "902";
    const result = await call("recover-association", data);
    if (mismatch) {
      assert.equal(result.status, 409);
      assert.equal(result.requests, 2);
      const row = await db
        .prepare("SELECT association_json FROM attempts WHERE id=?")
        .bind(data.scope.attemptId)
        .first();
      assert.equal(row.association_json, null);
    } else {
      assert.equal(result.result.state, "associated");
      assert.equal(result.result.reads, 3);
      assert.deepEqual(
        result.sent.map((request) => request.kind),
        ["booking-read", "booking-read", "invoice-read"],
      );
      const row = await db
        .prepare("SELECT association_json FROM attempts WHERE id=?")
        .bind(data.scope.attemptId)
        .first();
      assert.deepEqual(JSON.parse(row.association_json), {
        invoiceId: "901",
        nativeCustomerId: "51",
        bookingIds: ["701", "702"],
      });
      assert.equal((await call("recover-association", data)).requests, 0);
      assert.equal((await call("orchestrate", data)).requests, 0);
    }
  }
});

test("native malformed creation retains its reference for strict readback without accepting or replaying it", async () => {
  for (const foreignRead of [false, true]) {
    const data = await prepared(false, true);
    data.creation.bookings[0].unit_id = "99";
    const first = await call("orchestrate", data);
    assert.equal(first.result.state, "recovery_required");
    assert.equal(first.result.paymentAvailable, false);
    const effects = (
      await db
        .prepare(
          "SELECT step,outcome,reference_id FROM session_effects WHERE attempt_id=? ORDER BY step",
        )
        .bind(data.scope.attemptId)
        .all()
    ).results;
    assert.equal(
      effects.find((effect) => effect.step === "session:0").reference_id,
      "701",
    );
    assert.equal(
      JSON.parse(
        effects.find((effect) => effect.step === "native-booking-key")
          .reference_id,
      ).bookingId,
      "701",
    );
    assert.equal((await call("stored-signature", data)).status, 409);
    assert.equal((await call("orchestrate", data)).requests, 0);
    if (foreignRead) data.booking.unit_id = "99";
    const recovered = await call("recover-association", data);
    assert.equal(recovered.requests, 2);
    const row = await db
      .prepare("SELECT state,association_json FROM attempts WHERE id=?")
      .bind(data.scope.attemptId)
      .first();
    if (foreignRead) {
      assert.equal(recovered.status, 409);
      assert.equal(row.association_json, null);
      assert.equal(row.state, "recovery_required");
    } else {
      assert.equal(recovered.result.state, "associated");
      assert.deepEqual(JSON.parse(row.association_json).bookingIds, ["701"]);
    }
    assert.equal((await call("orchestrate", data)).requests, 0);
  }
});

test("native recovery and compensation reject reassigned clients and previously bound invoice changes", async () => {
  const data = await prepared(false, true);
  data.creation.bookings[0].unit_id = "99";
  await call("orchestrate", data);
  data.booking.client_id = "52";
  data.invoice.client_id = "52";
  data.invoice.lines[0].bookings[0].client_id = "52";
  assert.equal((await call("recover-association", data)).status, 409);
  const rejected = await call("compensate", data);
  assert.equal(rejected.status, 409);
  assert.ok(
    rejected.sent.every((request) => request.kind !== "booking-cancel"),
  );
  const associated = await prepared(false, true);
  await call("orchestrate", associated);
  await db
    .prepare(
      "UPDATE attempts SET state='recovery_required',version=version+1 WHERE id=?",
    )
    .bind(associated.scope.attemptId)
    .run();
  associated.booking.invoice_id = "902";
  associated.invoice.id = 902;
  associated.invoice.lines[0].invoice_id = 902;
  const changed = await call("compensate", associated);
  assert.equal(changed.status, 409);
  assert.equal(changed.error, "native_cleanup_association_changed");
  assert.ok(changed.sent.every((request) => request.kind !== "booking-cancel"));
});

test("native missing signing keys and partial or duplicate references never authorize guessed recovery", async () => {
  for (const scenario of ["missing-key", "partial", "duplicate"]) {
    const data = await prepared(scenario !== "missing-key", true);
    if (scenario === "missing-key") delete data.creation.bookings[0].hash;
    if (scenario === "partial") data.creation.bookings[0].unit_id = "99";
    if (scenario === "duplicate")
      data.creation.bookings[1].id = data.creation.bookings[0].id;
    const first = await call("orchestrate", data);
    assert.equal(first.result.state, "recovery_required");
    const observed = await db
      .prepare(
        "SELECT reference_id FROM session_effects WHERE attempt_id=? AND step='session:0'",
      )
      .bind(data.scope.attemptId)
      .first();
    assert.equal(observed.reference_id, "701");
    const recovery = await call("recover-association", data);
    assert.equal(recovery.status, 409);
    assert.equal(recovery.requests, 0);
    assert.equal((await call("orchestrate", data)).requests, 0);
    const row = await db
      .prepare("SELECT association_json FROM attempts WHERE id=?")
      .bind(data.scope.attemptId)
      .first();
    assert.equal(row.association_json, null);
  }
});

test("native failed checkout handoff durably enters recovery and cannot regenerate its link", async () => {
  const data = await prepared(false, true, true);
  await grantNative(data);
  const wall = new Date(
    data.scope.intent.sessions[0].startMs + 8 * 3600000,
  ).toISOString();
  data.invoice.due_datetime = new Date(Date.now() + 600000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const normal = nativeProviderReply(data, wall);
  const before = calls.length;
  reply = (request, body) =>
    request.url.endsWith("/payment-link")
      ? Response.json({ link: "https://foreign.example.invalid/checkout" })
      : normal(request, body);
  try {
    const result = await call("finite-checkout", data);
    assert.equal(result.result.state, "recovery_required");
    assert.equal(result.result.paymentAvailable, false);
    const row = await db
      .prepare("SELECT state,association_json FROM attempts WHERE id=?")
      .bind(data.scope.attemptId)
      .first();
    assert.equal(row.state, "recovery_required");
    assert.deepEqual(JSON.parse(row.association_json).bookingIds, ["701"]);
    const effect = await db
      .prepare(
        "SELECT outcome,reference_id FROM session_effects WHERE attempt_id=? AND step='native-link'",
      )
      .bind(data.scope.attemptId)
      .first();
    assert.deepEqual(effect, { outcome: "unknown", reference_id: null });
    const sent = calls.length - before;
    assert.equal((await call("finite-checkout", data)).reserved, 0);
    assert.equal(calls.length - before, sent);
    assert.equal(
      (await call("protected-context", data)).result.checkout.state,
      "unavailable",
    );
  } finally {
    reply = undefined;
  }
});

test("native compensation cancels only the freshly unpaid retained subset and keeps missing replies unresolved", async () => {
  const data = await prepared(true, true);
  assert.equal(
    (await call("orchestrate", { ...data, scenario: "second-book-lost" }))
      .result.state,
    "recovery_required",
  );
  data.booking = [data.booking[0]];
  data.booking[0].invoice_amount = "88.0000";
  data.invoice.lines = [data.invoice.lines[0]];
  data.invoice.amount = 88;
  data.invoice.deposit = 88;
  data.now = Date.now();
  const result = await call("compensate", data);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.deepEqual(result.result, { state: "incomplete", cancelled: 1 });
  assert.deepEqual(
    result.sent.map((request) => request.kind),
    [
      "booking-read",
      "invoice-read",
      "booking-cancel",
      "booking-read",
      "invoice-read",
    ],
  );
  assert.equal(result.sent[2].bookingId, "701");
  const effects = (
    await db
      .prepare(
        "SELECT step,outcome,reference_id FROM session_effects WHERE attempt_id=? ORDER BY step",
      )
      .bind(data.scope.attemptId)
      .all()
  ).results;
  assert.deepEqual(
    effects.find((effect) => effect.step === "native-cancel:0"),
    { step: "native-cancel:0", outcome: "observed", reference_id: "701" },
  );
  assert.equal(
    effects.find((effect) => effect.step === "session:1").outcome,
    "unknown",
  );
  const row = await db
    .prepare(
      "SELECT state,intent_json,association_json FROM attempts WHERE id=?",
    )
    .bind(data.scope.attemptId)
    .first();
  assert.equal(JSON.parse(row.intent_json).sessions.length, 2);
  assert.equal(row.association_json, null);
  assert.equal(row.state, "recovery_required");
  assert.equal((await call("compensate", data)).requests, 0);
  assert.equal((await call("orchestrate", data)).requests, 0);
});

test("native compensation verifies every cancellation and accepts only an explicitly unpaid cancelled invoice", async () => {
  for (const cancelledInvoice of [false, true]) {
    const data = await prepared(!cancelledInvoice, true);
    if (cancelledInvoice) data.creation.bookings[0].unit_id = "99";
    await call("orchestrate", {
      ...data,
      scenario: cancelledInvoice ? undefined : "batch-close-lost",
    });
    data.now = Date.now();
    const result = await call("compensate", {
      ...data,
      scenario: cancelledInvoice ? "cancelled-invoice" : undefined,
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.deepEqual(result.result, {
      state: "cancelled",
      cancelled: cancelledInvoice ? 1 : 2,
    });
    assert.equal(
      result.sent.filter((request) => request.kind === "booking-cancel").length,
      cancelledInvoice ? 1 : 2,
    );
    assert.equal(result.requests, cancelledInvoice ? 5 : 14);
  }
});

test("native checkout diagnostics retain receipt collection kinds and counts without values", async () => {
  for (const kind of [
    "missing",
    "null",
    "object",
    "primitive",
    "empty",
    "multiple",
  ]) {
    const data = await prepared(false, true, true);
    await grantNative(data);
    const receipt = structuredClone(data.creation.bookings[0]);
    receipt.private_marker = "private-value-must-not-leak";
    if (kind === "missing") delete data.creation.bookings;
    if (kind === "null") data.creation.bookings = null;
    if (kind === "object")
      data.creation.bookings = {
        private_marker: "private-value-must-not-leak",
      };
    if (kind === "primitive")
      data.creation.bookings = "private-value-must-not-leak";
    if (kind === "empty") data.creation.bookings = [];
    if (kind === "multiple")
      data.creation.bookings = [receipt, { ...receipt, id: "702" }];
    const wall = new Date(
      data.scope.intent.sessions[0].startMs + 8 * 3600000,
    ).toISOString();
    reply = nativeProviderReply(data, wall);
    try {
      const result = await call("finite-checkout", data);
      assert.deepEqual(result.result, {
        attemptId: data.scope.attemptId,
        state: "recovery_required",
        paymentAvailable: false,
      });
      const row = await db
        .prepare(
          "SELECT result_json FROM native_checkout_grants WHERE attempt_id=?",
        )
        .bind(data.scope.attemptId)
        .first();
      const saved = JSON.parse(row.result_json);
      assert.deepEqual(
        saved.diagnostic.representation.bookings,
        kind === "empty"
          ? { kind: "array", count: 0 }
          : kind === "multiple"
            ? { kind: "array", count: 2 }
            : kind === "object"
              ? { kind: "object", count: 1 }
              : { kind },
      );
      assert.equal(saved.diagnostic.validation.field, "creation.bookings");
      assert.doesNotMatch(
        row.result_json,
        /private_marker|private-value|synthetic-booking-hash|guest@example/,
      );
      const count = calls.length;
      assert.equal((await call("finite-checkout", data)).reserved, 0);
      assert.equal(calls.length, count);
    } finally {
      reply = undefined;
    }
  }
});

test("native checkout retains independent execution and cleanup failures privately without replay", async () => {
  const data = await prepared(false, true, true);
  await grantNative(data);
  await db
    .prepare(
      "UPDATE native_checkout_grants SET cleanup_allowed=1 WHERE attempt_id=?",
    )
    .bind(data.scope.attemptId)
    .run();
  data.creation.bookings[0].unit_id = "99";
  delete data.booking.invoice_id;
  const wall = new Date(
    data.scope.intent.sessions[0].startMs + 8 * 3600000,
  ).toISOString();
  const before = calls.length;
  reply = nativeProviderReply(data, wall);
  try {
    const result = await call("finite-checkout", data);
    assert.deepEqual(result.result, {
      attemptId: data.scope.attemptId,
      state: "recovery_required",
      paymentAvailable: false,
    });
    const row = await db
      .prepare(
        "SELECT result_json FROM native_checkout_grants WHERE attempt_id=?",
      )
      .bind(data.scope.attemptId)
      .first();
    const saved = JSON.parse(row.result_json);
    assert.equal(saved.diagnostic.stage, "execution");
    assert.equal(saved.diagnostic.sessionIndex, 0);
    assert.equal(saved.diagnostic.operation, "book");
    assert.equal(saved.cleanupDiagnostic.stage, "cleanup");
    assert.equal(saved.cleanupDiagnostic.operation, "booking-read");
    assert.equal(saved.diagnostic.code, "native_representation_unverified");
    assert.deepEqual(saved.diagnostic.validation, {
      field: "creation.booking.unit_id",
      problem: "mismatch",
    });
    assert.deepEqual(saved.diagnostic.representation, {
      kind: "object",
      count: Object.keys(data.creation).length,
      bookings: { kind: "array", count: 1 },
    });
    assert.deepEqual(saved.cleanupDiagnostic.validation, {
      field: "booking.invoice_id",
      problem: "missing",
    });
    assert.ok(!row.result_json.includes("synthetic-booking-hash"));
    const count = calls.length;
    assert.equal((await call("finite-checkout", data)).reserved, 0);
    assert.equal(calls.length, count);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT result_json FROM native_checkout_grants WHERE attempt_id=?",
          )
          .bind(data.scope.attemptId)
          .first()
      ).result_json,
      row.result_json,
    );
    assert.equal(
      calls.slice(before).filter((c) => c.body?.method === "book").length,
      1,
    );
    assert.equal(
      calls.slice(before).filter((c) => c.body?.method === "cancelBooking")
        .length,
      0,
    );
  } finally {
    reply = undefined;
  }
});

test("native residual cleanup requires exact current operator scope after customer expiry", async () => {
  for (const scenario of [
    "none",
    "wrong-id",
    "expired",
    "cleanup-revoked",
    "allowed",
  ]) {
    const data = await prepared(false, true);
    data.creation.bookings[0].unit_id = "99";
    await call("orchestrate", data);
    const deadline = (
      await db
        .prepare("SELECT deadline_ms FROM attempts WHERE id=?")
        .bind(data.scope.attemptId)
        .first()
    ).deadline_ms;
    const fixtureClockOffset = deadline - Date.now() + 1000;
    const virtualNow = Date.now() + fixtureClockOffset;
    const operatorRecovery =
      scenario === "none"
        ? undefined
        : {
            expiresMs:
              scenario === "expired" ? virtualNow - 1 : virtualNow + 120000,
            expectedBookingIds: scenario === "wrong-id" ? ["702"] : ["701"],
          };
    const result = await call("compensate", {
      ...data,
      now: virtualNow,
      scenario,
      operatorRecovery,
      fixtureClockOffset,
    });
    if (scenario === "allowed")
      assert.equal(result.result.state, "cancelled", JSON.stringify(result));
    else
      assert.equal(
        result.sent.filter((r) => r.kind === "booking-cancel").length,
        0,
        scenario,
      );
    assert.equal(
      (
        await db
          .prepare("SELECT deadline_ms FROM attempts WHERE id=?")
          .bind(data.scope.attemptId)
          .first()
      ).deadline_ms,
      deadline,
    );
  }
});

test("native finite compensation is separately granted and never exposes payment or replays writes", async () => {
  for (const allowed of [false, true]) {
    const data = await prepared(false, true, true);
    await grantNative(data);
    if (allowed)
      await db
        .prepare(
          "UPDATE native_checkout_grants SET cleanup_allowed=1 WHERE attempt_id=?",
        )
        .bind(data.scope.attemptId)
        .run();
    data.creation.bookings[0].unit_id = "99";
    const wall = new Date(
      data.scope.intent.sessions[0].startMs + 8 * 3600000,
    ).toISOString();
    const normal = nativeProviderReply(data, wall);
    const before = calls.length;
    reply = (request, body) => {
      if (body?.method === "cancelBooking") {
        data.booking.status = "cancelled";
        data.booking.is_confirmed = "0";
        data.invoice.lines[0].bookings[0].is_confirmed = false;
        return Response.json({ jsonrpc: "2.0", id: body.id, result: true });
      }
      return normal(request, body);
    };
    try {
      const result = await call("finite-checkout", data);
      assert.equal(result.result.state, "recovery_required");
      assert.equal(result.result.paymentAvailable, false);
      const requests = calls.slice(before);
      assert.equal(
        requests.filter((value) => value.body?.method === "cancelBooking")
          .length,
        allowed ? 1 : 0,
      );
      assert.equal(
        requests.filter((value) => value.body?.method === "book").length,
        1,
      );
      assert.equal(
        requests.filter((value) => value.url.endsWith("/payment-link")).length,
        0,
      );
      const effect = await db
        .prepare(
          "SELECT outcome FROM session_effects WHERE attempt_id=? AND step='native-cancel:0'",
        )
        .bind(data.scope.attemptId)
        .first();
      assert.deepEqual(effect, allowed ? { outcome: "observed" } : null);
      assert.equal((await call("finite-checkout", data)).reserved, 0);
      assert.equal(calls.length - before, requests.length);
    } finally {
      reply = undefined;
    }
  }
});

test("native compensation preserves paid foreign stale and potentially handed-off bookings", async () => {
  for (const scenario of [
    "paid",
    "foreign",
    "stale",
    "link",
    "cleanup-revoked",
  ]) {
    const data = await prepared(false, true);
    data.creation.bookings[0].unit_id = "99";
    await call("orchestrate", data);
    data.now = Date.now();
    if (scenario === "paid") {
      Object.assign(data.invoice, {
        status: "paid",
        payment_received: true,
        payment_processor: "hitpay",
      });
      Object.assign(data.booking, {
        invoice_status: "paid",
        invoice_payment_received: true,
        invoice_payment_processor: "hitpay",
      });
    }
    if (scenario === "foreign")
      data.booking.company_login = "foreign-developer";
    if (scenario === "stale") data.now -= 16000;
    if (scenario === "link")
      await db
        .prepare(
          "INSERT INTO session_effects(attempt_id,step,outcome) VALUES(?,'native-link','unknown')",
        )
        .bind(data.scope.attemptId)
        .run();
    const result = await call("compensate", { ...data, scenario });
    assert.equal(result.status, 409, scenario);
    assert.ok(
      result.sent.every((request) => request.kind !== "booking-cancel"),
      scenario,
    );
    if (scenario === "link" || scenario === "cleanup-revoked")
      assert.equal(result.requests, 0);
    assert.equal(
      await db
        .prepare(
          "SELECT 1 FROM session_effects WHERE attempt_id=? AND step LIKE 'native-cancel:%'",
        )
        .bind(data.scope.attemptId)
        .first(),
      null,
    );
  }
});

test("native cancellation loss and payment race retain unknown effects without retry or refund", async () => {
  for (const scenario of ["cancel-lost", "paid-after-cancel"]) {
    const data = await prepared(false, true);
    data.creation.bookings[0].unit_id = "99";
    await call("orchestrate", data);
    data.now = Date.now();
    const result = await call("compensate", { ...data, scenario });
    assert.equal(result.status, 409);
    assert.equal(
      result.sent.filter((request) => request.kind === "booking-cancel").length,
      1,
    );
    assert.ok(
      result.sent.every((request) =>
        ["booking-read", "invoice-read", "booking-cancel"].includes(
          request.kind,
        ),
      ),
    );
    const effect = await db
      .prepare(
        "SELECT outcome,reference_id FROM session_effects WHERE attempt_id=? AND step='native-cancel:0'",
      )
      .bind(data.scope.attemptId)
      .first();
    assert.deepEqual(effect, { outcome: "unknown", reference_id: null });
    assert.equal((await call("compensate", data)).requests, 0);
    assert.equal((await call("orchestrate", data)).requests, 0);
  }
});

test("native cancellation dispatch rejects evidence that expired before the physical request", async () => {
  const before = calls.length;
  const result = await call("transport", {
    operation: {
      kind: "booking-cancel",
      bookingId: "701",
      signature: "a".repeat(32),
      evidenceObservedAtMs: Date.now() - 16000,
    },
  });
  assert.equal(result.status, 409);
  assert.equal(result.error, "native_cleanup_evidence_expired");
  assert.equal(calls.length, before);
  assert.equal(result.reserved, 1);
  assert.equal(result.finished, 1);
});

test("native customer preparation binds one immutable cart and restores only the authenticated snapshot", async () => {
  const data = await prepared(false, true, true);
  await grantNative(data);
  const selected = data.scope.intent.sessions[0];
  const date = new Date(selected.startMs + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const offer = {
    serviceId: "12",
    serviceName: "Native Session",
    instructorId: "14",
    instructorName: "Native Trainer",
    startMs: selected.startMs,
    priceMinor: 8800,
    currency: "SGD",
  };
  await db
    .prepare(
      "UPDATE native_checkout_grants SET attempt_id=NULL,intent_hash=NULL,available_dates_json=?,availability_json=? WHERE attempt_id=?",
    )
    .bind(
      JSON.stringify([date]),
      JSON.stringify({
        [date]: { date, observedAtMs: Date.now(), offers: [offer] },
      }),
      data.scope.attemptId,
    )
    .run();
  const value = {
    key: crypto.randomUUID(),
    contact: data.scope.intent.contact,
    accepted: true,
    sessions: [
      {
        serviceId: "12",
        instructorId: "14",
        startMs: selected.startMs,
        players: 4,
        totalMinor: 8800,
      },
    ],
  };
  const first = await call("customer-prepare", { ...data, value });
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(first.reserved, 0);
  const replay = await call("customer-prepare", {
    ...data,
    value: { ...value, key: crypto.randomUUID() },
  });
  assert.equal(replay.result.attemptId, first.result.attemptId);
  assert.equal(replay.reserved, 0);
  assert.equal(
    (
      await call("customer-prepare", {
        ...data,
        value: { ...value, contact: { ...value.contact, name: "Changed" } },
      })
    ).status,
    409,
  );
  const current = await call("customer-current", data);
  assert.equal(current.result.attemptId, first.result.attemptId);
  assert.equal(current.result.sessions[0].players, 4);
  assert.equal(current.result.sessions[0].instructorName, "Native Trainer");
  const other = await prepared(false, true, true);
  assert.deepEqual((await call("customer-current", other)).result, {
    state: "empty",
  });
  assert.equal(current.reserved, 0);
});

test("native customer preparation rejects price drift unapproved dates and incomplete contact without provider effects", async () => {
  const data = await prepared(false, true, true);
  await grantNative(data);
  const selected = data.scope.intent.sessions[0];
  const date = new Date(selected.startMs + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  await db
    .prepare(
      "UPDATE native_checkout_grants SET attempt_id=NULL,intent_hash=NULL,available_dates_json=? WHERE attempt_id=?",
    )
    .bind(JSON.stringify([date]), data.scope.attemptId)
    .run();
  const base = {
    key: crypto.randomUUID(),
    contact: data.scope.intent.contact,
    accepted: true,
    sessions: [
      {
        serviceId: "12",
        instructorId: "14",
        startMs: selected.startMs,
        players: 1,
        totalMinor: 8800,
      },
    ],
  };
  for (const value of [
    { ...base, sessions: [{ ...base.sessions[0], totalMinor: 9900 }] },
    {
      ...base,
      sessions: [{ ...base.sessions[0], startMs: selected.startMs + 86400000 }],
    },
    { ...base, contact: { ...base.contact, phone: "" } },
    { ...base, accepted: false },
  ]) {
    const rejected = await call("customer-prepare", { ...data, value });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.reserved, 0);
  }
  assert.deepEqual((await call("customer-current", data)).result, {
    state: "empty",
  });
});

test("native customer window retains first private rejection without admitting provider calls or exposing diagnostics", async () => {
  for (const [field, value, failed] of [
    ["source_revision", "d".repeat(40), "source"],
    ["maximum_used", 112, "ceiling"],
    ["not_before_ms", Date.now() + 120000, "start"],
    ["expires_ms", Date.now() + 100000, "remaining"],
    ["expires_ms", Date.now() + 700000, "end"],
  ]) {
    const data = await prepared(false, true, true);
    await grantNative(data);
    await db
      .prepare(
        `UPDATE native_checkout_grants SET ${field}=? WHERE attempt_id=?`,
      )
      .bind(value, data.scope.attemptId)
      .run();
    const before = calls.length;
    const rejected = await call("customer-availability", {
      ...data,
      value: { date: "2026-10-15", serviceId: "12" },
    });
    assert.equal(rejected.error, "native_customer_window_unavailable");
    assert.equal(rejected.reserved, 0);
    assert.equal(calls.length, before);
    const row = await db
      .prepare(
        "SELECT state,result_json FROM native_checkout_grants WHERE attempt_id=?",
      )
      .bind(data.scope.attemptId)
      .first();
    assert.equal(row.state, "granted");
    const diagnostic = JSON.parse(row.result_json).diagnostic;
    assert.deepEqual(Object.keys(diagnostic).sort(), ["failedChecks", "stage"]);
    assert.equal(diagnostic.stage, "customer_window");
    assert.ok(diagnostic.failedChecks.includes(failed));
    assert.doesNotMatch(JSON.stringify(rejected), /diagnostic|failedChecks/);
    await db
      .prepare(
        "UPDATE native_checkout_grants SET maximum_used=112 WHERE attempt_id=?",
      )
      .bind(data.scope.attemptId)
      .run();
    await call("customer-availability", {
      ...data,
      value: { date: "2026-10-15", serviceId: "12" },
    });
    assert.equal(
      (
        await db
          .prepare(
            "SELECT result_json FROM native_checkout_grants WHERE attempt_id=?",
          )
          .bind(data.scope.attemptId)
          .first()
      ).result_json,
      row.result_json,
    );
    assert.equal(calls.length, before);
  }
});

test("native customer availability preserves provider offers caches bounded reads and rejects foreign dates", async () => {
  const data = await prepared(false, true, true);
  await grantNative(data);
  const wall = new Date(
    data.scope.intent.sessions[0].startMs + 8 * 3600000,
  ).toISOString();
  const date = wall.slice(0, 10);
  await db
    .prepare(
      "UPDATE native_checkout_grants SET attempt_id=NULL,intent_hash=NULL,available_dates_json=? WHERE attempt_id=?",
    )
    .bind(JSON.stringify([date]), data.scope.attemptId)
    .run();
  const before = calls.length;
  reply = nativeProviderReply(data, wall);
  try {
    const first = await call("customer-availability", {
      ...data,
      value: { date, serviceId: "12" },
    });
    assert.equal(first.status, 200, JSON.stringify(first));
    assert.equal(first.result.offers.length, 1);
    assert.deepEqual(first.result.offers[0], {
      serviceId: "12",
      serviceName: "Synthetic Session",
      instructorId: "14",
      instructorName: "Synthetic Trainer",
      startMs: data.scope.intent.sessions[0].startMs,
      priceMinor: 8800,
      currency: "SGD",
    });
    assert.ok(first.reserved > 0 && first.reserved <= 13);
    assert.equal(first.reserved, first.finished);
    const sent = calls.slice(before);
    assert.ok(
      sent.every(
        (item) =>
          !["book", "createBatch", "closeBatch"].includes(item.body?.method),
      ),
    );
    const cached = await call("customer-availability", {
      ...data,
      value: { date, serviceId: "12" },
    });
    assert.deepEqual(cached.result, first.result);
    assert.equal(cached.reserved, 0);
    for (const value of [
      { date: "2026-01-01", serviceId: "12" },
      { date, serviceId: "99" },
    ]) {
      const rejected = await call("customer-availability", { ...data, value });
      assert.equal(rejected.status, 409);
      assert.equal(rejected.reserved, 0);
    }
    assert.equal(calls.length, before + sent.length);
  } finally {
    reply = undefined;
  }
});

test("native creation diagnostics distinguish missing malformed and mismatched fields without provider values", async () => {
  const cases = [
    ["require_confirm", undefined, "creation.require_confirm", "missing"],
    [
      "require_confirm",
      "sensitive-marker",
      "creation.require_confirm",
      "malformed",
    ],
    ["require_confirm", true, "creation.require_confirm", "mismatch"],
    ["bookings", null, "creation.bookings", "missing"],
    ["bookings", "sensitive-marker", "creation.bookings", "malformed"],
    ["bookings", [], "creation.bookings", "mismatch"],
    [
      "bookings.0.require_payment",
      undefined,
      "creation.booking.require_payment",
      "missing",
    ],
    [
      "bookings.0.require_payment",
      "sensitive-marker",
      "creation.booking.require_payment",
      "malformed",
    ],
    [
      "bookings.0.is_confirmed",
      false,
      "creation.booking.is_confirmed",
      "mismatch",
    ],
    ["bookings.0.client_id", "52", "creation.booking.client_id", "mismatch"],
    ["bookings.0.event_id", "13", "creation.booking.event_id", "mismatch"],
    ["bookings.0.unit_id", undefined, "creation.booking.unit_id", "missing"],
    [
      "bookings.0.unit_id",
      "sensitive-marker",
      "creation.booking.unit_id",
      "malformed",
    ],
    ["bookings.0.unit_id", "15", "creation.booking.unit_id", "mismatch"],
    [
      "bookings.0.start_date_time",
      "2026-10-10 09:01:00",
      "creation.booking.start_date_time",
      "mismatch",
    ],
    [
      "bookings.0.start_date_time",
      "2026-02-30 09:00:00",
      "creation.booking.start_date_time",
      "malformed",
    ],
    [
      "bookings.0.end_date_time",
      "2026-10-10 09:40:00",
      "creation.booking.end_date_time",
      "mismatch",
    ],
    ["bookings.0.hash", undefined, "creation.booking.hash", "missing"],
    [
      "bookings.0.hash",
      { secret: "sensitive-marker" },
      "creation.booking.hash",
      "malformed",
    ],
    ["bookings.0.id", undefined, "creation.booking.id", "missing"],
    ["bookings.0.id", "sensitive-marker", "creation.booking.id", "malformed"],
  ];
  for (const [path, value, field, problem] of cases) {
    const data = input(false);
    const parts = path.split(".");
    const target = parts.slice(0, -1).reduce((o, key) => o[key], data.creation);
    if (value === undefined) delete target[parts.at(-1)];
    else target[parts.at(-1)] = value;
    data.creation["sensitive-marker"] = { password: "sensitive-marker" };
    const result = await call("session", data);
    assert.equal(result.status, 409, path);
    assert.equal(result.error, "native_representation_unverified", path);
    assert.deepEqual(result.validation, { field, problem }, path);
    assert.equal(result.requests, 0);
    assert.doesNotMatch(
      JSON.stringify(result),
      /sensitive-marker|synthetic-booking-hash|guest@example/,
    );
  }
});

test("native invoice and readback diagnostics identify exact financial ownership time and set predicates", async () => {
  const cases = [
    ["invoice", null, "invoice", "missing"],
    ["invoice.amount", undefined, "invoice.amount", "missing"],
    ["invoice.amount", "sensitive-marker", "invoice.amount", "malformed"],
    ["invoice.amount", 89, "invoice.amount", "mismatch"],
    ["invoice.client_id", "52", "invoice.client_id", "mismatch"],
    ["invoice.currency", "USD", "invoice.currency", "mismatch"],
    ["invoice.rest_amount", 1, "invoice.rest_amount", "mismatch"],
    ["invoice.taxes", {}, "invoice.taxes", "malformed"],
    ["invoice.lines", [], "invoice.lines", "mismatch"],
    ["invoice.lines.0.booking_ids", [], "invoice.line.booking_ids", "mismatch"],
    [
      "invoice.lines.0.bookings.0.client_id",
      "52",
      "invoice.line.booking.client_id",
      "mismatch",
    ],
    [
      "invoice.lines.0.bookings.0.end_datetime",
      "2026-10-10 09:40:00",
      "invoice.line.booking.end_datetime",
      "mismatch",
    ],
    ["invoice.lines.0.qty", 2, "invoice.line.qty", "mismatch"],
    [
      "invoice.lines.0.discount_ratio",
      1,
      "invoice.line.discount_ratio",
      "mismatch",
    ],
    ["invoice.lines.0.tickets", null, "invoice.line.tickets", "missing"],
    ["booking.invoice_id", undefined, "booking.invoice_id", "missing"],
    ["booking.invoice_id", "902", "booking.invoice_id", "mismatch"],
    ["booking.unit_id", "15", "booking.unit_id", "mismatch"],
    [
      "booking.company_login",
      "sensitive-marker",
      "booking.company_login",
      "mismatch",
    ],
    [
      "booking.event_buffertime_after",
      0,
      "booking.event_buffertime_after",
      "mismatch",
    ],
    [
      "booking.end_date_time",
      "2026-10-10 09:40:00",
      "booking.end_date_time",
      "mismatch",
    ],
    [
      "booking.is_confirmed",
      "sensitive-marker",
      "booking.is_confirmed",
      "malformed",
    ],
    [
      "booking.invoice_payment_received",
      undefined,
      "booking.invoice_payment_received",
      "missing",
    ],
  ];
  for (const [path, value, field, problem] of cases) {
    const data = input(false);
    const parts = path.split(".");
    const target = parts.slice(0, -1).reduce((o, key) => o[key], data);
    if (value === undefined) delete target[parts.at(-1)];
    else target[parts.at(-1)] = value;
    const result = await call("normalize", data);
    assert.equal(result.error, "native_representation_unverified", path);
    assert.deepEqual(result.validation, { field, problem }, path);
    assert.equal(result.requests, 0);
    assert.doesNotMatch(
      JSON.stringify(result),
      /sensitive-marker|synthetic-booking-hash|guest@example/,
    );
  }
});

test("native batch and client metadata diagnostics retain known effects without finalization or replay", async () => {
  for (const [field, value, problem] of [
    ["client_hash", null, "missing"],
    ["client_hash", { secret: "sensitive-marker" }, "malformed"],
    ["batch_id", "sensitive-marker", "malformed"],
    ["batch_id", 602, "mismatch"],
    ["batch_hash", null, "missing"],
    ["batch_hash", { secret: "sensitive-marker" }, "malformed"],
  ]) {
    const data = await prepared(true, true);
    const receipt = {
      require_confirm: true,
      invoice: null,
      batch_id: 601,
      batch_hash: "synthetic-batch-hash",
      bookings: [structuredClone(data.creation.bookings[0])],
    };
    if (field === "client_hash") receipt.bookings[0][field] = value;
    else receipt[field] = value;
    const result = await call("orchestrate", {
      ...data,
      batchReceipt: receipt,
    });
    assert.equal(result.result.state, "recovery_required");
    assert.deepEqual(result.validation, {
      field:
        field === "client_hash"
          ? "creation.booking.client_hash"
          : `creation.${field}`,
      problem,
    });
    assert.deepEqual(
      result.sent.map((r) => r.kind),
      ["batch-create", "book"],
    );
    assert.doesNotMatch(
      JSON.stringify(result.validation),
      /sensitive-marker|synthetic-/,
    );
    const row = await db
      .prepare("SELECT association_json FROM attempts WHERE id=?")
      .bind(data.scope.attemptId)
      .first();
    assert.equal(row.association_json, null);
    const key = await db
      .prepare(
        "SELECT reference_id FROM session_effects WHERE attempt_id=? AND step='native-booking-key:0'",
      )
      .bind(data.scope.attemptId)
      .first();
    assert.equal(JSON.parse(key.reference_id).bookingId, "701");
    assert.equal((await call("orchestrate", data)).requests, 0);
  }
});

test("native finalization diagnostics keep confirmation invoice and complete-set guards strict", async () => {
  for (const [mutate, field, problem] of [
    [
      (d) => {
        d.creation.require_confirm = true;
      },
      "creation.require_confirm",
      "mismatch",
    ],
    [
      (d) => {
        d.creation.invoice = null;
      },
      "creation.invoice",
      "missing",
    ],
    [
      (d) => {
        d.creation.invoice.amount = 1;
      },
      "invoice.amount",
      "mismatch",
    ],
    [
      (d) => {
        d.creation.invoice.lines.pop();
      },
      "invoice.lines",
      "mismatch",
    ],
    [
      (d) => {
        d.creation.invoice.lines[1] = structuredClone(
          d.creation.invoice.lines[0],
        );
      },
      "invoice.lines.booking_set",
      "mismatch",
    ],
  ]) {
    const data = await prepared(true, true);
    mutate(data);
    const result = await call("orchestrate", data);
    assert.equal(result.result.state, "recovery_required");
    assert.deepEqual(result.validation, { field, problem });
    assert.deepEqual(
      result.sent.map((r) => r.kind),
      ["batch-create", "book", "book", "batch-close"],
    );
    assert.equal(
      (
        await db
          .prepare("SELECT association_json FROM attempts WHERE id=?")
          .bind(data.scope.attemptId)
          .first()
      ).association_json,
      null,
    );
    assert.equal((await call("orchestrate", data)).requests, 0);
  }
});

test("native private validation reason stops at RPC while its permanent failure code survives", async () => {
  const data = input(false);
  data.creation.invoice.amount = "sensitive-marker";
  const response = await call("validation-rpc", data);
  assert.deepEqual(response.result, {
    ok: false,
    error: { status: 503, code: "native_representation_unverified" },
  });
  assert.doesNotMatch(
    JSON.stringify(response),
    /validation|sensitive-marker|invoice.amount/,
  );
  const candidate = await prepared();
  await call("orchestrate", candidate);
  candidate.invoice.amount = "sensitive-marker";
  await db
    .prepare("UPDATE recovery_work SET ready_ms=? WHERE attempt_id=?")
    .bind(Date.now() - 1, candidate.scope.attemptId)
    .run();
  const read = await call("readback", candidate);
  assert.equal(read.result.reads, 2);
  assert.equal(read.result.outcomes[0].reason, "reconciliation_unsupported");
  assert.equal(read.result.outcomes[0].state, "manual_review");
  assert.equal((await call("readback", candidate)).requests, 0);
});

test("native residual diagnostic names missing invoice evidence without cancelling an unfinished cart", async () => {
  const data = await prepared(false, true);
  data.creation.bookings[0].unit_id = "99";
  await call("orchestrate", data);
  delete data.booking.invoice_id;
  data.now = Date.now();
  const result = await call("residual-diagnostic", data);
  assert.equal(result.result.state, "recovery_required");
  assert.deepEqual(result.result.diagnostic.validation, {
    field: "booking.invoice_id",
    problem: "missing",
  });
  assert.equal(
    result.result.diagnostic.code,
    "native_representation_unverified",
  );
  assert.equal(result.result.diagnostic.operation, "booking-read");
  assert.equal(
    result.result.diagnostic.representation.invoiceReference,
    "missing",
  );
  assert.deepEqual(
    result.sent.map((r) => r.kind),
    ["booking-read"],
  );
  assert.doesNotMatch(
    JSON.stringify(result.result),
    /synthetic-booking-hash|synthetic-signing-secret|guest@example/,
  );
});

test("native inspection reports every independent predicate despite missing invoice and never changes the attempt", async () => {
  const data = await prepared(false, true);
  data.creation.bookings[0].unit_id = "99";
  await call("orchestrate", data);
  delete data.booking.invoice_id;
  delete data.booking.event_id;
  data.booking.unit_id = "99";
  data.booking.event_price = "private-contact-marker";
  data.booking.end_date_time =
    data.booking.start_date_time.slice(0, 14) + "40:00";
  data.booking["private-property-marker"] = "private-value-marker";
  data.now = Date.now();
  const before = await db
    .prepare("SELECT * FROM attempts WHERE id=?")
    .bind(data.scope.attemptId)
    .first();
  const effects = await db
    .prepare("SELECT * FROM session_effects WHERE attempt_id=? ORDER BY step")
    .bind(data.scope.attemptId)
    .all();
  const response = await call("inspect-diagnostic", data);
  assert.equal(response.result.state, "inspected", JSON.stringify(response));
  const report = response.result.inspection;
  assert.equal(report.fields["booking.event_id"].result, "missing");
  assert.equal(report.fields["booking.unit_id"].result, "mismatch");
  assert.equal(report.fields["booking.event_price"].result, "malformed");
  assert.equal(report.fields["booking.end_date_time"].result, "mismatch");
  assert.equal(report.fields["booking.client_id"].result, "match");
  assert.deepEqual(report.fields["booking.invoice_id"], {
    representation: "absent",
    result: "requires-invoice-evidence",
  });
  assert.equal(report.endInterval, "play");
  assert.equal(report.creationEnvelope, "unavailable");
  assert.equal(report.invoiceComparison, "not-requested");
  assert.deepEqual(
    response.sent.map((r) => r.kind),
    ["booking-read"],
  );
  assert.doesNotMatch(
    JSON.stringify(response.result),
    /private-|synthetic-booking-hash|synthetic-signing-secret|guest@example/,
  );
  assert.deepEqual(
    await db
      .prepare("SELECT * FROM attempts WHERE id=?")
      .bind(data.scope.attemptId)
      .first(),
    before,
  );
  assert.deepEqual(
    (
      await db
        .prepare(
          "SELECT * FROM session_effects WHERE attempt_id=? ORDER BY step",
        )
        .bind(data.scope.attemptId)
        .all()
    ).results,
    effects.results,
  );
});

test("native date-scoped owner exception reaches fresh availability and exact two-date preparation only", async () => {
  const anchor = Date.parse("2026-10-12T23:40:00+08:00");
  for (const enabled of [false, true]) {
    const data = await prepared(false, true, true);
    await grantNative(data);
    const cap = createHash("sha256")
      .update(data.cookie.split("=")[1])
      .digest("hex");
    const row = await db
      .prepare(
        "SELECT contract_json FROM native_checkout_grants WHERE capability_hash=?",
      )
      .bind(cap)
      .first();
    const contract = {
      ...JSON.parse(row.contract_json),
      serviceId: "2",
      confirmedAtMs: anchor - 1000,
      expiresAtMs: anchor + 599000,
      ...(enabled ? { trialLeadTimeException: "owner-2026-10-14-15" } : {}),
    };
    await db
      .prepare(
        "UPDATE guest_access SET issued_ms=?,expires_ms=? WHERE capability_hash=?",
      )
      .bind(anchor - 1000, anchor + 600000, cap)
      .run();
    await db
      .prepare(
        "UPDATE native_checkout_grants SET attempt_id=NULL,intent_hash=NULL,contract_json=?,not_before_ms=?,expires_ms=?,available_dates_json=? WHERE capability_hash=?",
      )
      .bind(
        JSON.stringify(contract),
        anchor - 1000,
        anchor + 590000,
        JSON.stringify(["2026-10-14", "2026-10-15"]),
        cap,
      )
      .run();
    const standard = nativeProviderReply(data, "");
    reply = (request, body) => {
      const replies = {
        getEventList: {
          2: {
            id: 2,
            name: "Synthetic Session",
            duration: 40,
            is_active: 1,
            is_public: 1,
            is_recurring: 0,
            price: "88.0000",
            currency: "SGD",
            unit_map: [3],
          },
        },
        getUnitList: { 3: { id: 3, name: "Synthetic Trainer", is_active: 1 } },
      };
      if (body?.method in replies)
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: replies[body.method],
        });
      if (body?.method === "getStartTimeMatrix")
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { [body.params[0]]: ["09:00:00"] },
        });
      return standard(request, body);
    };
    const invoke = (action, value) =>
      call(action, { ...data, value, fixtureClockOffset: anchor - Date.now() });
    try {
      const first = await invoke("customer-availability", {
        date: "2026-10-14",
        serviceId: "2",
      });
      assert.equal(first.status, 200, JSON.stringify(first));
      assert.equal(first.result.offers.length, enabled ? 1 : 0);
      assert.equal(first.reserved, first.finished);
      if (!enabled) continue;
      const second = await invoke("customer-availability", {
        date: "2026-10-15",
        serviceId: "2",
      });
      assert.equal(second.result.offers.length, 1);
      const sessions = [first.result.offers[0], second.result.offers[0]].map(
        (v) => ({
          serviceId: v.serviceId,
          instructorId: v.instructorId,
          startMs: v.startMs,
          players: 1,
          totalMinor: v.priceMinor,
        }),
      );
      const value = {
        key: crypto.randomUUID(),
        accepted: true,
        contact: data.scope.intent.contact,
        sessions,
      };
      for (const rejected of [
        { ...value, sessions: sessions.slice(0, 1) },
        { ...value, sessions: [sessions[0], sessions[0]] },
        {
          ...value,
          sessions: sessions.map((v) => ({ ...v, instructorId: "2" })),
        },
        { ...value, trialLeadTimeException: "owner-2026-10-14-15" },
      ]) {
        const out = await invoke("customer-prepare", rejected);
        assert.equal(out.status, 409);
        assert.equal(out.reserved, 0);
      }
      const before = calls.length;
      const preparedResult = await invoke("customer-prepare", value);
      assert.equal(preparedResult.status, 200, JSON.stringify(preparedResult));
      assert.equal(preparedResult.reserved, 0);
      const replay = await invoke("customer-prepare", value);
      assert.equal(replay.result.attemptId, preparedResult.result.attemptId);
      assert.equal(calls.length, before);
    } finally {
      reply = undefined;
    }
  }
});

test("native calendar scopes range reads to granted dates and retains fresh continuation checks", async () => {
  const data = await prepared(false, true, true);
  await grantNative(data);
  const wall = new Date(
    data.scope.intent.sessions[0].startMs + 8 * 3600000,
  ).toISOString();
  const date = wall.slice(0, 10);
  await db
    .prepare(
      "UPDATE native_checkout_grants SET attempt_id=NULL,intent_hash=NULL,available_dates_json=? WHERE attempt_id=?",
    )
    .bind(JSON.stringify([date]), data.scope.attemptId)
    .run();
  reply = nativeProviderReply(data, wall);
  try {
    const result = await call("customer-calendar", {
      ...data,
      value: { month: date.slice(0, 7), serviceId: "12" },
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.result.dates.length, 1);
    assert.equal(result.result.dates[0].date, date);
    assert.equal(result.result.dates[0].offers.length, 1);
    const cached = await call("customer-availability", {
      ...data,
      value: { date, serviceId: "12" },
    });
    assert.equal(cached.status, 200);
    assert.equal(cached.reserved, 0);
    const fresh = await call("customer-availability", {
      ...data,
      value: { date, serviceId: "12", fresh: true },
    });
    assert.equal(fresh.status, 200);
    assert.ok(fresh.reserved > 0);
    const foreign = await call("customer-calendar", {
      ...data,
      value: { month: date.slice(0, 7), serviceId: "99" },
    });
    assert.notEqual(foreign.status, 200);
    assert.equal(foreign.reserved, 0);
  } finally {
    reply = undefined;
  }
});

test("Review booking creates one HitPay holding appointment without payment or post-reservation availability", async () => {
  const data = await prepared(false, true, true);
  await grantNative(data);
  const wall = new Date(
    data.scope.intent.sessions[0].startMs + 28800000,
  ).toISOString();
  data.invoice.due_datetime = new Date(Date.now() + 600000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const before = calls.length;
  reply = nativeProviderReply(data, wall);
  try {
    const result = await call("finite-checkout", {
      ...data,
      scenario: "hitpay-hold",
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.result.state, "associated", JSON.stringify(result));
    assert.equal(result.result.paymentAvailable, false);
    const sent = calls.slice(before);
    const index = sent.findIndex((c) => c.body?.method === "book");
    assert.ok(index >= 0);
    assert.equal(sent.filter((c) => c.body?.method === "book").length, 1);
    assert.equal(
      sent.some(
        (c) => c.url.includes("hit-pay.com") || c.url.endsWith("/payment-link"),
      ),
      false,
    );
    assert.equal(
      sent
        .slice(index + 1)
        .some((c) =>
          ["getStartTimeMatrix", "getAvailableUnits"].includes(c.body?.method),
        ),
      false,
    );
    assert.ok(
      await db
        .prepare("SELECT 1 FROM hitpay_holds WHERE attempt_id=?")
        .bind(data.scope.attemptId)
        .first(),
    );
    assert.equal(
      await db
        .prepare("SELECT 1 FROM hitpay_payments WHERE attempt_id=?")
        .bind(data.scope.attemptId)
        .first(),
      null,
    );
    assert.equal(
      (await call("finite-checkout", { ...data, scenario: "hitpay-hold" }))
        .reserved,
      0,
    );
    const date = wall.slice(0, 10);
    await db
      .prepare(
        "UPDATE native_checkout_grants SET availability_json=? WHERE attempt_id=?",
      )
      .bind(
        JSON.stringify({
          [date]: {
            date,
            observedAtMs: Date.now(),
            offers: [
              {
                serviceId: "12",
                serviceName: "Synthetic Session",
                instructorId: "14",
                instructorName: "Synthetic Trainer",
                startMs: data.scope.intent.sessions[0].startMs,
                priceMinor: 8800,
                currency: "SGD",
              },
            ],
          },
        }),
        data.scope.attemptId,
      )
      .run();
    const restored = await call("customer-current", data);
    assert.equal(restored.status, 200, JSON.stringify(restored));
    assert.equal(restored.result.state, "held");
  } finally {
    reply = undefined;
  }
});

test("HitPay hold rejection retains redacted creation flags and invoice joins before normalization without replay", async () => {
  for (const confirmed of [false, 0, "0", "private-marker"]) {
    const data = await prepared(false, true, true);
    await grantNative(data);
    data.creation.bookings[0].is_confirmed = confirmed;
    data.creation.bookings[0].status = "unconfirmed";
    data.creation.bookings[0].contact = "private-marker";
    data.creation.invoice.due_datetime = "2026-10-16 12:30:00";
    data.creation.invoice.contact = "private-marker";
    data.creation.invoice.lines[0].bookings[0].hash = "private-marker";
    const before = calls.length;
    const wall = new Date(
      data.scope.intent.sessions[0].startMs + 28800000,
    ).toISOString();
    reply = nativeProviderReply(data, wall);
    try {
      const result = await call("finite-checkout", {
        ...data,
        scenario: "hitpay-hold",
      });
      assert.equal(result.result.state, "recovery_required");
      const row = await db
        .prepare(
          "SELECT result_json FROM native_checkout_grants WHERE attempt_id=?",
        )
        .bind(data.scope.attemptId)
        .first();
      const saved = JSON.parse(row.result_json);
      assert.equal(
        saved.diagnostic.validation.field,
        "creation.booking.is_confirmed",
      );
      assert.equal(saved.holdEvidence.length, 1);
      const snapshot = saved.holdEvidence[0];
      assert.equal(snapshot.operation, "book");
      assert.equal(snapshot.bookings[0].status, "unconfirmed");
      assert.deepEqual(snapshot.bookings[0].isConfirmed, {
        kind: typeof confirmed,
        value: confirmed === "private-marker" ? null : false,
      });
      assert.equal(snapshot.invoice.id, "901");
      assert.deepEqual(snapshot.invoice.lines[0].bookingIds, ["701"]);
      assert.equal(snapshot.invoice.dueDatetime.value, "2026-10-16 12:30:00");
      assert.equal(snapshot.invoice.paymentReceived.value, false);
      assert.match(snapshot.correlationId, /^[a-f0-9-]{36}$/);
      assert.ok(Number.isSafeInteger(snapshot.observedAtMs));
      assert.doesNotMatch(
        row.result_json,
        /private-marker|synthetic-booking-hash|guest@example|contact|client_hash/,
      );
      assert.doesNotMatch(
        JSON.stringify(result.result),
        /holdEvidence|isConfirmed|correlationId/,
      );
      const count = calls.length;
      assert.equal(
        (await call("finite-checkout", { ...data, scenario: "hitpay-hold" }))
          .reserved,
        0,
      );
      assert.equal(calls.length, count);
      assert.equal(
        calls.slice(before).filter((c) => c.body?.method === "book").length,
        1,
      );
      assert.equal(
        calls.slice(before).some((c) => c.url.includes("hit-pay.com")),
        false,
      );
    } finally {
      reply = undefined;
    }
  }
});

test("HitPay hold readback evidence is durable before the next provider read and survives invoice rejection", async () => {
  const data = await prepared(false, true, true);
  await grantNative(data);
  data.invoice.status = "pending";
  data.invoice.due_datetime = "2026-10-16 12:30:00";
  data.invoice.client = { name: "private-marker", email: "private-marker" };
  const wall = new Date(
    data.scope.intent.sessions[0].startMs + 28800000,
  ).toISOString();
  const provider = nativeProviderReply(data, wall);
  let witnessed = false;
  reply = async (request, body) => {
    if (request.url.endsWith("/admin/invoices/901")) {
      const row = await db
        .prepare(
          "SELECT result_json FROM native_checkout_grants WHERE attempt_id=?",
        )
        .bind(data.scope.attemptId)
        .first();
      assert.deepEqual(
        JSON.parse(row.result_json).holdEvidence.map((e) => e.operation),
        ["book", "booking-read"],
      );
      witnessed = true;
    }
    return provider(request, body);
  };
  try {
    const result = await call("finite-checkout", {
      ...data,
      scenario: "hitpay-hold",
    });
    assert.equal(witnessed, true);
    assert.equal(result.result.state, "recovery_required");
    const row = await db
      .prepare(
        "SELECT result_json FROM native_checkout_grants WHERE attempt_id=?",
      )
      .bind(data.scope.attemptId)
      .first();
    const evidence = JSON.parse(row.result_json).holdEvidence;
    assert.deepEqual(
      evidence.map((e) => e.operation),
      ["book", "booking-read", "invoice-read"],
    );
    assert.equal(evidence[1].bookings[0].invoiceId, "901");
    assert.equal(evidence[2].invoice.status, "pending");
    assert.equal(
      evidence[2].invoice.dueDatetime.value,
      data.invoice.due_datetime,
    );
    assert.deepEqual(evidence[2].invoice.lines[0].bookingIds, ["701"]);
    assert.equal(evidence[2].invoice.lines[0].bookings[0].id, "701");
    assert.doesNotMatch(
      row.result_json,
      /private-marker|guest@example|synthetic-booking-hash/,
    );
  } finally {
    reply = undefined;
  }
});
