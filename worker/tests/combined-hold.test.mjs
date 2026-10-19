import { test } from "node:test";
import assert from "node:assert/strict";
import { createBookingMechanism } from "./booking-mechanism-fixture.mjs";

async function customer(m) {
  const access = await m.mf.dispatchFetch(m.origin + "/api/access", {
    method: "POST",
    headers: { origin: m.origin },
  });
  assert.equal(access.status, 201);
  const headers = {
    origin: m.origin,
    cookie: access.headers.get("set-cookie").split(";")[0],
    "content-type": "application/json",
  };
  const key = crypto.randomUUID();
  const input = {
    key,
    holding: true,
    accepted: false,
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
        startMs: m.startMs,
        players: 2,
        totalMinor: 8800,
      },
    ],
  };
  return {
    headers,
    input,
    send: (value = input) =>
      m.mf.dispatchFetch(m.origin + `/api/booking/hold/${key}`, {
        method: "POST",
        headers,
        body: JSON.stringify(value),
      }),
  };
}

test("combined hold performs one preflight and preserves immutable identity across concurrent requests and restoration", async () => {
  const m = await createBookingMechanism();
  try {
    const c = await customer(m);
    c.input.contact.contactMethod = "sms";
    const responses = await Promise.all([c.send(), c.send()]);
    for (const response of responses)
      assert.equal(response.status, 200, await response.clone().text());
    const results = await Promise.all(
      responses.map((response) => response.json()),
    );
    assert.ok(results.some((result) => result.state === "associated"));
    const timing = await m.db
      .prepare(
        "SELECT c.booking_created_ms,c.payment_window_ms,c.hold_window_ms,h.expires_ms FROM checkout_progress c JOIN hitpay_holds h USING(attempt_id) WHERE attempt_id=?",
      )
      .bind(c.input.key)
      .first();
    assert.equal(timing.payment_window_ms, 480000);
    assert.equal(timing.hold_window_ms, 900000);
    await assert.rejects(
      m.db
        .prepare(
          "UPDATE checkout_progress SET payment_window_ms=300000 WHERE attempt_id=?",
        )
        .bind(c.input.key)
        .run(),
      /checkout_windows_immutable/,
    );
    assert.ok(timing.booking_created_ms <= Date.now());
    assert.ok(timing.expires_ms <= timing.booking_created_ms + 900000);
    assert.ok(timing.expires_ms > timing.booking_created_ms);
    assert.ok(timing.expires_ms > timing.booking_created_ms + 840000);

    assert.ok(results.every((result) => result.attemptId === c.input.key));
    for (const method of [
      "getEventList",
      "getUnitList",
      "getAdditionalFields",
      "getAvailableUnits",
      "getStartTimeMatrix",
      "book",
      "getBookingDetails",
    ])
      assert.equal(
        m.calls.filter((call) => call.body?.method === method).length,
        1,
        method,
      );
    assert.equal(
      m.calls.filter((call) => call.url.endsWith("/admin/invoices/901")).length,
      1,
    );
    assert.equal(
      m.calls.some((call) => call.url.includes("hit-pay.com")),
      false,
    );
    assert.match(
      m.calls.find((call) => call.url.endsWith("/comment")).body.comment,
      /Preferred communication: SMS/,
    );
    const creation = m.calls.findIndex((call) => call.body?.method === "book");
    assert.equal(
      m.calls
        .slice(creation + 1)
        .some((call) =>
          ["getStartTimeMatrix", "getAvailableUnits"].includes(
            call.body?.method,
          ),
        ),
      false,
    );
    const current = await m.mf.dispatchFetch(
      m.origin + "/api/booking/current",
      { headers: c.headers },
    );
    assert.equal(current.status, 200, await current.clone().text());
    assert.equal((await current.json()).state, "held");
    const before = await m.db
      .prepare("SELECT id,intent_hash,intent_json FROM attempts")
      .first();
    assert.equal(before.id, c.input.key);
    const changed = await c.send({
      ...c.input,
      contact: { ...c.input.contact, name: "Changed" },
    });
    assert.equal(changed.status, 409);
    assert.deepEqual(
      await m.db
        .prepare("SELECT id,intent_hash,intent_json FROM attempts")
        .first(),
      before,
    );
    assert.equal(
      m.calls.filter((call) => call.body?.method === "book").length,
      1,
    );
    const checkout = await m.mf.dispatchFetch(
      m.origin + `/api/booking/hitpay/${c.input.key}`,
      {
        method: "POST",
        headers: c.headers,
        body: JSON.stringify({ accepted: true }),
      },
    );
    assert.equal(checkout.status, 200, await checkout.clone().text());
    const payment = await m.db
      .prepare("SELECT expires_ms FROM hitpay_payments WHERE attempt_id=?")
      .bind(c.input.key)
      .first();
    assert.equal(
      payment.expires_ms,
      Math.min(timing.expires_ms, timing.booking_created_ms + 480000),
    );
    const creates = m.calls.filter(
      (call) =>
        call.url.endsWith("/v1/payment-requests") && call.method === "POST",
    );
    assert.equal(creates.length, 1);
    assert.match(creates[0].body.expires_after, /^[1-7] mins$/);
    assert.deepEqual(m.unexpected, []);
  } finally {
    await m.close();
  }
});

test("combined hold rejects changed price and unavailable selection before creation without deleting attempt evidence", async () => {
  const m = await createBookingMechanism({
    respond: async (call) =>
      call.body?.method === "getAvailableUnits"
        ? Response.json({ jsonrpc: "2.0", id: call.body.id, result: [] })
        : undefined,
  });
  try {
    const c = await customer(m);
    const invalid = await c.send({
      ...c.input,
      sessions: [{ ...c.input.sessions[0], totalMinor: 1 }],
    });
    assert.equal(invalid.status, 409);
    assert.equal(m.calls.length, 0);
    const response = await c.send();
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).state, "selection_unavailable");
    assert.equal(
      m.calls.some((call) => call.body?.method === "book"),
      false,
    );
    assert.equal(
      (
        await m.db
          .prepare("SELECT state FROM attempts WHERE id=?")
          .bind(c.input.key)
          .first()
      ).state,
      "prepared",
    );
    assert.equal(
      (await m.db.prepare("SELECT COUNT(*) AS n FROM session_effects").first())
        .n,
      0,
    );
  } finally {
    await m.close();
  }
});

test("combined hold retains an unknown provider creation and never replays it after a lost response", async () => {
  let providerCreations = 0;
  const m = await createBookingMechanism({
    respond: async (call) => {
      if (call.body?.method === "book") {
        providerCreations++;
        return new Response(null, { status: 503 });
      }
    },
  });
  try {
    const c = await customer(m);
    const response = await c.send();
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).state, "recovery_required");
    const row = await m.db
      .prepare("SELECT id,intent_hash,state FROM attempts")
      .first();
    assert.equal(row.id, c.input.key);
    assert.equal(row.state, "recovery_required");
    assert.ok(
      await m.db
        .prepare(
          "SELECT 1 FROM session_effects WHERE attempt_id=? AND outcome='unknown'",
        )
        .bind(c.input.key)
        .first(),
    );
    await c.send();
    assert.equal(providerCreations, 1);
    assert.deepEqual(
      await m.db.prepare("SELECT id,intent_hash,state FROM attempts").first(),
      row,
    );
    const current = await m.mf.dispatchFetch(
      m.origin + "/api/booking/current",
      { headers: c.headers },
    );
    assert.equal((await current.json()).state, "checking");
  } finally {
    await m.close();
  }
});

test("combined hold rechecks revocation at the write boundary and preserves created references on readback failure", async () => {
  for (const fault of ["revoke", "readback"]) {
    let m;
    m = await createBookingMechanism({
      respond: async (call) => {
        if (fault === "revoke" && call.body?.method === "getStartTimeMatrix")
          await m.db
            .prepare("UPDATE guest_access SET revoked_ms=?")
            .bind(Date.now())
            .run();
        if (fault === "readback" && call.body?.method === "getBookingDetails")
          return new Response(null, { status: 503 });
      },
    });
    try {
      const c = await customer(m);
      await c.send();
      assert.equal(
        m.calls.filter((call) => call.body?.method === "book").length,
        fault === "revoke" ? 0 : 1,
      );
      const row = await m.db
        .prepare("SELECT id,intent_hash,association_json FROM attempts")
        .first();
      assert.equal(row.id, c.input.key);
      if (fault === "readback") {
        assert.ok(row.association_json);
        await c.send();
        assert.equal(
          m.calls.filter((call) => call.body?.method === "book").length,
          1,
        );
        assert.deepEqual(
          await m.db
            .prepare("SELECT id,intent_hash,association_json FROM attempts")
            .first(),
          row,
        );
        assert.equal(
          (await m.db.prepare("SELECT COUNT(*) AS n FROM hitpay_holds").first())
            .n,
          0,
        );
      }
    } finally {
      await m.close();
    }
  }
});

test("combined hold serializes competing customers and rejects the second slot without duplicate creation", async () => {
  const m = await createBookingMechanism();
  try {
    const first = await customer(m),
      second = await customer(m);
    const responses = await Promise.all([first.send(), second.send()]);
    const results = await Promise.all(
      responses.map((response) => response.json()),
    );
    assert.equal(
      results.filter((result) => result.state === "associated").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.state === "selection_unavailable")
        .length,
      1,
    );
    assert.equal(
      m.calls.filter((call) => call.body?.method === "book").length,
      1,
    );
    assert.equal(
      (await m.db.prepare("SELECT COUNT(*) AS n FROM attempts").first()).n,
      2,
    );
    assert.equal(
      (await m.db.prepare("SELECT COUNT(*) AS n FROM hitpay_holds").first()).n,
      1,
    );
    const denied = await m.mf.dispatchFetch(
      m.origin + `/api/booking/hold/${first.input.key}`,
      {
        method: "POST",
        headers: second.headers,
        body: JSON.stringify(first.input),
      },
    );
    assert.equal(denied.status, 409);
    assert.equal(
      m.calls.filter((call) => call.body?.method === "book").length,
      1,
    );
  } finally {
    await m.close();
  }
});

test("combined batch hold uses one validation per item and retains partial or unknown creation without payment", async () => {
  for (const fault of ["none", "conflict", "unknown"]) {
    let books = 0;
    const m = await createBookingMechanism({
      batch: true,
      respond: async (call) => {
        if (call.body?.method === "book") {
          books++;
          if (fault === "unknown" && books === 2)
            return new Response(null, { status: 503 });
        }
        if (
          fault === "conflict" &&
          books === 1 &&
          call.body?.method === "getAvailableUnits"
        )
          return Response.json({
            jsonrpc: "2.0",
            id: call.body.id,
            result: [],
          });
        return undefined;
      },
    });
    try {
      const c = await customer(m);
      c.input.sessions.push({
        ...c.input.sessions[0],
        startMs: m.startMs + 3000000,
      });
      const response = await c.send();
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(
        (await response.json()).state,
        fault === "none" ? "associated" : "recovery_required",
      );
      assert.equal(
        m.calls.filter((call) => call.body?.method === "getAvailableUnits")
          .length,
        2,
      );
      assert.equal(
        m.calls.filter((call) => call.body?.method === "closeBatch").length,
        fault === "none" ? 1 : 0,
      );
      assert.equal(books, fault === "conflict" ? 1 : 2);
      assert.equal(
        (await m.db.prepare("SELECT COUNT(*) AS n FROM hitpay_holds").first())
          .n,
        fault === "none" ? 1 : 0,
      );
      const before = books;
      const restored = await m.mf.dispatchFetch(
        m.origin + "/api/booking/current",
        { headers: c.headers },
      );
      assert.equal(restored.status, 200, await restored.clone().text());
      const current = await restored.json();
      assert.equal(current.attemptId, c.input.key);
      assert.equal(current.state, fault === "none" ? "held" : "checking");
      assert.equal(current.sessions.length, 2);
      assert.equal(current.sessions[1].startMs, m.startMs + 3000000);
      if (fault === "conflict")
        assert.equal(current.sessions[1].serviceName, "Requested session");
      assert.equal(books, before);
      await c.send();
      assert.equal(books, before);
      assert.deepEqual(m.unexpected, []);
    } finally {
      await m.close();
    }
  }
});

test("single hold exposes creation progress while independent readbacks are pending and payment remains blocked", async () => {
  let releaseBook, releaseComment, bookStarted, commentStarted;
  const bookGate = new Promise((resolve) => {
    releaseBook = resolve;
  });
  const commentGate = new Promise((resolve) => {
    releaseComment = resolve;
  });
  const booking = new Promise((resolve) => {
    bookStarted = resolve;
  });
  const commenting = new Promise((resolve) => {
    commentStarted = resolve;
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let both;
  const entered = new Promise((resolve) => {
    both = resolve;
  });
  const reads = new Set();
  const m = await createBookingMechanism({
    respond: async (call) => {
      if (call.body?.method === "book") {
        bookStarted();
        await bookGate;
      }
      if (call.url.endsWith("/comment")) {
        commentStarted();
        await commentGate;
      }
      const kind =
        call.body?.method === "getBookingDetails"
          ? "booking"
          : call.url.endsWith("/admin/invoices/901")
            ? "invoice"
            : null;
      if (kind) {
        reads.add(kind);
        if (reads.size === 2) both();
        await gate;
      }
    },
  });
  let holding;
  try {
    const c = await customer(m);
    holding = c.send();
    await booking;
    const beforeCreation = await m.mf.dispatchFetch(
      m.origin + `/api/booking/native/${c.input.key}`,
      { headers: c.headers },
    );
    assert.deepEqual(await beforeCreation.json(), {
      attemptId: c.input.key,
      state: "reviewing",
      paymentAvailable: false,
    });
    releaseBook();
    await commenting;
    const beforeComment = await m.mf.dispatchFetch(
      m.origin + `/api/booking/native/${c.input.key}`,
      { headers: c.headers },
    );
    assert.deepEqual(await beforeComment.json(), {
      attemptId: c.input.key,
      state: "verifying",
      paymentAvailable: false,
    });
    assert.equal(reads.size, 0);
    assert.equal(
      (await m.db.prepare("SELECT COUNT(*) AS n FROM hitpay_holds").first()).n,
      0,
    );
    releaseComment();
    await entered;
    const progress = await m.mf.dispatchFetch(
      m.origin + `/api/booking/native/${c.input.key}`,
      { headers: c.headers },
    );
    assert.deepEqual(await progress.json(), {
      attemptId: c.input.key,
      state: "verifying",
      paymentAvailable: false,
    });
    assert.equal(
      (await m.db.prepare("SELECT COUNT(*) AS n FROM hitpay_holds").first()).n,
      0,
    );
    const checkout = await m.mf.dispatchFetch(
      m.origin + `/api/attempts/${c.input.key}/checkout`,
      { headers: { ...c.headers, "X-Booking-Details": "1" } },
    );
    const pendingContext = await checkout.json();
    assert.notEqual(pendingContext.checkout?.state, "available");
    assert.equal(pendingContext.details.attemptId, c.input.key);
    assert.equal(pendingContext.details.sessions.length, 1);
    assert.equal(pendingContext.details.totalMinor, 8800);
    assert.equal("verifiedAtMs" in pendingContext.details, false);
    assert.equal(pendingContext.confirmation, undefined);
    const legacyContext = await m.mf.dispatchFetch(
      m.origin + `/api/attempts/${c.input.key}/checkout`,
      { headers: c.headers },
    );
    assert.equal((await legacyContext.json()).details, undefined);
    release();
    assert.equal((await (await holding).json()).state, "associated");
    assert.equal(
      m.calls.filter((call) => call.body?.method === "book").length,
      1,
    );
    assert.equal(
      m.calls.filter((call) => call.url.includes("hit-pay.com")).length,
      0,
    );
  } finally {
    releaseBook();
    releaseComment();
    release();
    await holding;
    await m.close();
  }
});

test("ongoing confirmation grants five fast stored-status checks while retaining the shared cap and deadline", async () => {
  const m = await createBookingMechanism();
  try {
    const c = await customer(m);
    await c.send();
    const original = await m.db
      .prepare("SELECT deadline_ms,intent_hash FROM attempts WHERE id=?")
      .bind(c.input.key)
      .first();
    const calls = m.calls.length;
    for (let i = 0; i < 6; i++) {
      await m.db
        .prepare("UPDATE attempts SET confirmation_next_ms=0 WHERE id=?")
        .bind(c.input.key)
        .run();
      const start = Date.now();
      const response = await m.mf.dispatchFetch(
        m.origin + `/api/attempts/${c.input.key}/confirmation`,
        { headers: c.headers },
      );
      assert.equal(response.status, 200);
      const next = Number(response.headers.get("X-Next-Check"));
      const delay = i < 5 ? 1000 : 5000;
      assert.ok(next >= start + delay && next <= Date.now() + delay);
      const repeated = await m.mf.dispatchFetch(
        m.origin + `/api/attempts/${c.input.key}/confirmation`,
        { headers: c.headers },
      );
      assert.equal(repeated.status, 429);
    }
    assert.equal(
      m.calls.length,
      calls,
      "status checks do not read the provider",
    );
    assert.deepEqual(
      await m.db
        .prepare("SELECT deadline_ms,intent_hash FROM attempts WHERE id=?")
        .bind(c.input.key)
        .first(),
      original,
    );
    assert.equal(
      (
        await m.db
          .prepare("SELECT confirmation_checks AS n FROM attempts WHERE id=?")
          .bind(c.input.key)
          .first()
      ).n,
      6,
    );
    await m.db
      .prepare(
        "UPDATE attempts SET confirmation_checks=120,confirmation_next_ms=0 WHERE id=?",
      )
      .bind(c.input.key)
      .run();
    const exhausted = await m.mf.dispatchFetch(
      m.origin + `/api/attempts/${c.input.key}/confirmation`,
      { headers: c.headers },
    );
    assert.equal(exhausted.status, 429);
  } finally {
    await m.close();
  }
});

test("single hold progress requires validated retained creation before comments without granting payment", async () => {
  const m = await createBookingMechanism();
  try {
    const c = await customer(m);
    assert.equal((await c.send()).status, 200);
    const saved = await m.db
      .prepare("SELECT * FROM attempts WHERE id=?")
      .bind(c.input.key)
      .first();
    const cases = [
      {
        outcome: "observed",
        reference: "701",
        finalized: true,
        state: "dispatching",
        batch: false,
        expected: "verifying",
      },
      {
        outcome: "unknown",
        reference: "701",
        finalized: true,
        state: "dispatching",
        batch: false,
        expected: "running",
      },
      {
        outcome: "observed",
        reference: "701",
        finalized: false,
        state: "dispatching",
        batch: false,
        expected: "running",
      },
      {
        outcome: "observed",
        reference: "701",
        finalized: true,
        state: "recovery_required",
        batch: false,
        expected: "running",
      },
      {
        outcome: "observed",
        reference: "701",
        finalized: true,
        state: "dispatching",
        batch: true,
        expected: "running",
      },
    ];
    // Seed independent intermediate snapshots; never rewrite immutable evidence.
    for (const scenario of cases) {
      const id = crypto.randomUUID();
      const intent = JSON.parse(saved.intent_json);
      if (scenario.batch)
        intent.sessions.push({
          ...intent.sessions[0],
          startMs: intent.sessions[0].startMs + 3000000,
        });
      if (scenario.batch) intent.totalMinor *= 2;
      const json = JSON.stringify(intent);
      const hash = Buffer.from(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json)),
      ).toString("hex");
      await m.db
        .prepare(
          "INSERT INTO attempts(id,owner_id,idempotency_key,intent_json,intent_hash,created_ms,deadline_ms,state) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          saved.owner_id,
          id,
          json,
          hash,
          saved.created_ms,
          saved.deadline_ms,
          scenario.state,
        )
        .run();
      await m.db
        .prepare(
          "UPDATE native_checkout_grants SET attempt_id=?,intent_hash=?,state='running' WHERE capability_hash=(SELECT capability_hash FROM guest_access WHERE owner_id=?)",
        )
        .bind(id, hash, saved.owner_id)
        .run();
      await m.db
        .prepare("INSERT INTO session_effects VALUES(?,'session:0',?,?)")
        .bind(id, scenario.outcome, scenario.reference)
        .run();
      if (scenario.finalized)
        await m.db
          .prepare(
            "INSERT INTO session_effects VALUES(?,'finalize','unknown',NULL)",
          )
          .bind(id)
          .run();
      const response = await m.mf.dispatchFetch(
        m.origin + `/api/booking/native/${id}`,
        { headers: c.headers },
      );
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(await response.json(), {
        attemptId: id,
        state: scenario.expected,
        paymentAvailable: false,
      });
      const anonymous = await m.mf.dispatchFetch(
        m.origin + `/api/booking/native/${id}`,
      );
      assert.equal(anonymous.status, 401);
      if (scenario.expected === "verifying") {
        const denied = await m.mf.dispatchFetch(
          m.origin + `/api/booking/hitpay/${id}`,
          {
            method: "POST",
            headers: c.headers,
            body: JSON.stringify({ accepted: true }),
          },
        );
        assert.notEqual(denied.status, 200);
      }
    }
    assert.equal(
      m.calls.some((call) => call.url.includes("hit-pay.com")),
      false,
    );
    assert.equal(
      m.calls.filter((call) => call.body?.method === "book").length,
      1,
    );
  } finally {
    await m.close();
  }
});

test(
  "combined preflight overlaps independent reads and drains them before one booking write",
  { timeout: 15000 },
  async () => {
    const fields = Promise.withResolvers();
    const slotEntered = Promise.withResolvers();
    let fieldsPending = false;
    const m = await createBookingMechanism({
      respond: async (call) => {
        if (call.body?.method === "getAdditionalFields") {
          fieldsPending = true;
          await fields.promise;
          fieldsPending = false;
        }
        if (call.body?.method === "getStartTimeMatrix") slotEntered.resolve();
        if (call.body?.method === "book") assert.equal(fieldsPending, false);
      },
    });
    let pending;
    try {
      const c = await customer(m);
      pending = c.send();
      await slotEntered.promise;
      assert.equal(
        fieldsPending,
        true,
        "availability starts while required fields are blocked",
      );
      assert.equal(
        m.calls.some((call) => call.body?.method === "book"),
        false,
      );
      const beforePreflight = await m.mf.dispatchFetch(
        m.origin + `/api/booking/native/${c.input.key}`,
        { headers: c.headers },
      );
      assert.deepEqual(await beforePreflight.json(), {
        attemptId: c.input.key,
        state: "running",
        paymentAvailable: false,
      });
      assert.equal(
        (
          await m.db
            .prepare("SELECT COUNT(*) AS n FROM checkout_review_progress")
            .first()
        ).n,
        0,
      );
      fields.resolve();
      const response = await pending;
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).state, "associated");
      assert.equal(
        m.calls.filter((call) => call.body?.method === "book").length,
        1,
      );
      assert.deepEqual(m.unexpected, []);
    } finally {
      fields.resolve();
      await pending;
      await m.close();
    }
  },
);

test(
  "concurrent preflight drains siblings and rejects revocation before creation",
  { timeout: 15000 },
  async () => {
    const fields = Promise.withResolvers();
    const slotEntered = Promise.withResolvers();
    const m = await createBookingMechanism({
      respond: async (call) => {
        if (call.body?.method === "getAdditionalFields") await fields.promise;
        if (call.body?.method === "getStartTimeMatrix") slotEntered.resolve();
      },
    });
    let pending;
    try {
      const c = await customer(m);
      pending = c.send();
      await slotEntered.promise;
      await m.db
        .prepare("UPDATE guest_access SET revoked_ms=?")
        .bind(Date.now())
        .run();
      fields.resolve();
      await pending;
      assert.equal(
        m.calls.some((call) => call.body?.method === "book"),
        false,
      );
      assert.equal(
        (await m.db.prepare("SELECT COUNT(*) AS n FROM attempts").first()).n,
        1,
      );
    } finally {
      fields.resolve();
      await pending;
      await m.close();
    }
  },
);

test(
  "combined preparation overlaps public and admin authentication without premature booking",
  { timeout: 15000 },
  async () => {
    const publicToken = Promise.withResolvers();
    const adminEntered = Promise.withResolvers();
    let publicPending = false;
    const m = await createBookingMechanism({
      respond: async (call) => {
        if (call.body?.method === "getToken") {
          publicPending = true;
          await publicToken.promise;
          publicPending = false;
        }
        if (call.url.endsWith("/admin/auth")) adminEntered.resolve();
      },
    });
    let pending;
    try {
      const c = await customer(m);
      pending = c.send();
      await adminEntered.promise;
      assert.equal(publicPending, true);
      assert.equal(
        m.calls.some((call) => call.body?.method === "book"),
        false,
      );
      publicToken.resolve();
      const response = await pending;
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).state, "associated");
      assert.equal(
        m.calls.filter((call) => call.body?.method === "getToken").length,
        1,
      );
      assert.equal(
        m.calls.filter((call) => call.url.endsWith("/admin/auth")).length,
        1,
      );
      assert.equal(
        m.calls.filter((call) => call.body?.method === "book").length,
        1,
      );
    } finally {
      publicToken.resolve();
      await pending;
      await m.close();
    }
  },
);

test("concurrent preflight attributes invalid fields correctly and creates no booking", async () => {
  const m = await createBookingMechanism({
    respond: async (call) =>
      call.body?.method === "getAdditionalFields"
        ? Response.json({ jsonrpc: "2.0", id: call.body.id, result: [{}] })
        : undefined,
  });
  try {
    const c = await customer(m);
    const response = await c.send();
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).state, "prerequisites_unavailable");
    assert.equal(
      m.calls.some((call) => call.body?.method === "book"),
      false,
    );
    const row = await m.db
      .prepare(
        "SELECT result_json FROM native_checkout_grants WHERE attempt_id=?",
      )
      .bind(c.input.key)
      .first();
    assert.equal(
      JSON.parse(row.result_json).diagnostic.operation,
      "required-fields",
    );
  } finally {
    await m.close();
  }
});
