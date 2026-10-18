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
    const responses = await Promise.all([c.send(), c.send()]);
    for (const response of responses)
      assert.equal(response.status, 200, await response.clone().text());
    const results = await Promise.all(
      responses.map((response) => response.json()),
    );
    assert.ok(results.some((result) => result.state === "associated"));
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
      { headers: c.headers },
    );
    assert.notEqual((await checkout.json()).checkout?.state, "available");
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

test("single hold progress exposes the matched comment receipt before association without granting payment", async () => {
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
        state: "dispatching",
        batch: false,
        expected: "verifying",
      },
      {
        outcome: "unknown",
        reference: "701",
        state: "dispatching",
        batch: false,
        expected: "running",
      },
      {
        outcome: "observed",
        reference: "wrong",
        state: "dispatching",
        batch: false,
        expected: "running",
      },
      {
        outcome: "observed",
        reference: "701",
        state: "recovery_required",
        batch: false,
        expected: "running",
      },
      {
        outcome: "observed",
        reference: "701",
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
        .prepare(
          "INSERT INTO session_effects VALUES(?,'session:0','observed','701')",
        )
        .bind(id)
        .run();
      await m.db
        .prepare("INSERT INTO session_effects VALUES(?,'native-comment:0',?,?)")
        .bind(id, scenario.outcome, scenario.reference)
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
