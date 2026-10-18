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
