// Synthetic external-provider state only. Production application/storage is unchanged.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHmac } from "node:crypto";
import { setTimeout as latency } from "node:timers/promises";
const templates = JSON.parse(
  readFileSync("worker/tests/native-fixtures.json", "utf8"),
).responses;
const wall = (ms) =>
  new Date(ms + 28800000).toISOString().slice(0, 19).replace("T", " ");
/** Create synthetic provider behavior and effect accounting for load tests. */
export function loadProvider({ delayMs = 0, maxCalls = 2000 } = {}) {
  const groups = new Map(),
    bookings = new Map(),
    occupied = new Set(),
    payments = new Map();
  const observations = [];
  let serial = 1000,
    calls = 0,
    nextFault;
  const business = "00000000-0000-4000-8000-000000000003";
  const response = (call, result) =>
    Response.json({ jsonrpc: "2.0", id: call.body.id, result });
  /** Create a synthetic booking group with an unpaid invoice. */
  function group() {
    const id = ++serial;
    const invoice = structuredClone(templates.invoiceBefore);
    Object.assign(invoice, {
      id,
      lines: [],
      amount: 0,
      deposit: 0,
      due_datetime: new Date(Date.now() + 900000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
    });
    const g = {
      id,
      invoice,
      items: [],
      details: [],
      closed: false,
      payment: null,
      accepted: 0,
    };
    groups.set(id, g);
    return g;
  }
  function close(g) {
    g.closed = true;
    g.invoice.amount = g.invoice.deposit = g.items.length * 88;
    for (const detail of g.details)
      detail.invoice_amount = g.invoice.amount.toFixed(4);
  }
  /** Resolve a simulated provider call while recording bounded effects and faults. */
  async function respond(call) {
    assert.ok(++calls <= maxCalls, "Synthetic provider call budget exceeded");
    const url = new URL(call.url),
      method =
        call.body?.method ??
        `${call.method} ${url.pathname.replace(/[a-f0-9-]{36}|\d+/g, ":id")}`;
    const started = performance.now();
    if (delayMs) await latency(delayMs); // Deliberate measured provider-latency injection.
    if (
      nextFault &&
      call.method === "GET" &&
      url.hostname === "api.sandbox.hit-pay.com"
    ) {
      const status = nextFault;
      nextFault = undefined;
      observations.push({
        method,
        status,
        durationMs: performance.now() - started,
      });
      return new Response(null, { status, headers: { "Retry-After": "1" } });
    }
    observations.push({
      method,
      status: 200,
      durationMs: performance.now() - started,
    });
    const p = call.body?.params;
    if (call.body?.method === "createBatch") return response(call, group().id);
    if (call.body?.method === "book") {
      const slot = `${p[2]} ${p[3]}`;
      assert.ok(!occupied.has(slot), "Duplicate synthetic studio booking");
      occupied.add(slot);
      const g = p[7] ? groups.get(Number(p[7])) : group();
      assert.ok(g && !g.closed);
      const id = ++serial,
        lineId = ++serial;
      const start = Date.parse(slot.replace(" ", "T") + "+08:00"),
        end = wall(start + 3000000);
      const item = {
        ...structuredClone(templates.creation.bookings[0]),
        id: String(id),
        event_id: 2,
        start_date_time: slot,
        end_date_time: end,
        hash: `synthetic-load-${id}`,
        client_hash: "synthetic-client-hash",
      };
      const detail = {
        ...structuredClone(templates.bookingBefore),
        id: String(id),
        event_id: "2",
        invoice_id: String(g.id),
        invoice_line_id: String(lineId),
        start_date_time: slot,
        end_date_time: end,
      };
      const line = structuredClone(templates.invoiceBefore.lines[0]);
      Object.assign(line, {
        id: String(lineId),
        invoice_id: g.id,
        booking_ids: [id],
      });
      Object.assign(line.bookings[0], {
        id,
        service_id: 2,
        start_datetime: slot,
        end_datetime: end,
      });
      g.items.push(item);
      g.details.push(detail);
      g.invoice.lines.push(line);
      g.email = p[4].email;
      bookings.set(String(id), detail);
      if (!p[7]) close(g);
      return response(call, {
        require_confirm: !!p[7],
        bookings: g.items,
        invoice: p[7] ? null : g.invoice,
        ...(p[7]
          ? { batch_id: g.id, batch_hash: `synthetic-batch-${g.id}` }
          : {}),
      });
    }
    if (call.body?.method === "closeBatch") {
      const g = groups.get(Number(p[0]));
      assert.ok(g && !g.closed);
      close(g);
      return response(call, {
        invoice: g.invoice,
        bookings: Object.fromEntries(g.items.map((item) => [item.id, item])),
      });
    }
    if (call.body?.method === "getBookingDetails") {
      assert.ok(bookings.has(String(p[0])), "Unknown synthetic booking");
      return response(call, bookings.get(String(p[0])));
    }
    if (call.body?.method === "getAvailableUnits")
      return response(call, occupied.has(p[1]) ? [] : [14]);
    if (call.body?.method === "getStartTimeMatrix") {
      const result = {};
      for (
        let d = new Date(p[0] + "T00:00:00Z");
        d.toISOString().slice(0, 10) <= p[1];
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        const date = d.toISOString().slice(0, 10);
        result[date] = [0, 6].includes(d.getUTCDay())
          ? []
          : Array.from({ length: 8 }, (_, i) =>
              wall(Date.parse(date + "T12:10:00+08:00") + i * 3000000).slice(
                11,
              ),
            ).filter((time) => !occupied.has(`${date} ${time}`));
      }
      return response(call, result);
    }
    const invoicePath = /^\/admin\/invoices\/(\d+)(\/accept-payment)?$/.exec(
      url.pathname,
    );
    if (invoicePath) {
      const g = groups.get(Number(invoicePath[1]));
      assert.ok(g);
      if (invoicePath[2]) {
        assert.equal(call.method, "PUT");
        assert.equal(g.payment?.status, "completed");
        assert.equal(g.accepted++, 0, "Duplicate external accounting");
        Object.assign(g.invoice, {
          payment_received: true,
          payment_processor: "manual",
          status: "paid",
        });
        for (const detail of g.details)
          Object.assign(detail, {
            invoice_payment_received: "1",
            invoice_payment_processor: "manual",
            invoice_status: "paid",
          });
      }
      return Response.json(g.invoice);
    }
    if (url.hostname === "api.sandbox.hit-pay.com") {
      if (call.method === "POST" && url.pathname === "/v1/payment-requests") {
        const candidates = [...groups.values()].filter(
          (g) => g.closed && g.email === call.body.email && !g.payment,
        );
        assert.equal(
          candidates.length,
          1,
          "Payment must match one complete booking group",
        );
        const g = candidates[0];
        assert.equal(call.body.amount, g.invoice.amount.toFixed(2));
        const id = randomUUID();
        const payment = {
          id,
          reference_number: call.body.reference_number,
          amount: call.body.amount,
          currency: "SGD",
          status: "pending",
          allow_repeated_payments: false,
          is_currency_editable: false,
          business_id: business,
          url: `https://checkout.sandbox.hit-pay.com/payment-request/@soccerbot/${id}/checkout`,
          payments: [],
          expiry_date: wall(Date.now() + 180000),
        };
        g.payment = payment;
        payments.set(id, payment);
        return Response.json(payment);
      }
      const payment = payments.get(url.pathname.split("/").at(-1));
      assert.ok(payment, "Unknown synthetic payment");
      assert.equal(call.method, "GET");
      return Response.json(payment);
    }
    // Shared mechanism fixture retains auth/catalogue/comment responses and rejects all unknown requests.
    return undefined;
  }
  return {
    respond,
    groups,
    payments,
    occupied,
    observations,
    fault(status) {
      assert.ok([429, 503].includes(status));
      nextFault = status;
    },
    get faultPending() {
      return nextFault !== undefined;
    },
    complete(id) {
      const p = payments.get(id);
      assert.ok(p);
      p.status = "completed";
      p.payments = [
        {
          id: randomUUID(),
          amount: p.amount,
          currency: "SGD",
          status: "succeeded",
          refunded_amount: "0",
        },
      ];
    },
    /** Construct synthetic webhook evidence for the load-test payment. */
    webhook(id, status) {
      const p = payments.get(id);
      assert.ok(p);
      const body = JSON.stringify({
        id,
        reference_number: p.reference_number,
        status,
      });
      return {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "Hitpay-Signature": createHmac("sha256", "synthetic-salt")
            .update(body)
            .digest("hex"),
        },
      };
    },
  };
}
