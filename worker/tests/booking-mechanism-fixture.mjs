// Test-only provider boundary. All application routes, auth, D1 and coordinator
// code are production code. No network request is forwarded to a provider.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { build } from "esbuild";
import ts from "typescript";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { seedFoundation } from "./foundation-fixture.mjs";
export async function createBookingMechanism(options = {}) {
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config;
  const origin = "https://soccerbot.test";
  const day = new Date(Date.now() + 3 * 86400000);
  while (day.getUTCDay() !== 3) day.setUTCDate(day.getUTCDate() + 1);
  const date = day.toISOString().slice(0, 10);
  const startMs = Date.parse(date + "T12:10:00+08:00");
  const fixtures = JSON.parse(
    readFileSync("worker/tests/native-fixtures.json", "utf8"),
  ).responses;
  const creation = structuredClone(fixtures.creation),
    booking = structuredClone(fixtures.bookingBefore),
    invoice = structuredClone(fixtures.invoiceBefore);
  const wall = (ms) =>
    new Date(ms + 28800000).toISOString().slice(0, 19).replace("T", " ");
  for (const value of [booking, creation.bookings[0]]) {
    value.event_id = 2;
    value.start_date_time = wall(startMs);
    value.end_date_time = wall(startMs + 3000000);
  }
  for (const value of [invoice, creation.invoice]) {
    value.lines[0].bookings[0].service_id = 2;
    value.due_datetime = new Date(Date.now() + 600000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    value.lines[0].bookings[0].start_datetime = wall(startMs);
    value.lines[0].bookings[0].end_datetime = wall(startMs + 3000000);
  }
  creation.bookings[0].client_hash = "synthetic-client-hash";
  const requestId = "20000000-0000-4000-8000-000000000002";
  const checkoutUrl = `https://checkout.sandbox.hit-pay.com/payment-request/@soccerbot/${requestId}/checkout`;
  const businessId = "00000000-0000-4000-8000-000000000003";
  const calls = [],
    unexpected = [];
  let paymentComplete = false;
  let booked = false,
    reference;
  const script = (
    await build({
      entryPoints: ["worker/index.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["cloudflare:workers", "node:async_hooks"],
    })
  ).outputFiles[0].text;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "booking-mechanism",
      modules: true,
      script,
      cf: false,
      handleStructuredLogs: () => {},
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      bindings: {
        ...config.vars,
        APP_ORIGIN: origin,
        SOURCE_REVISION: "d".repeat(40),
        LIVE_CUSTOMER_ACCESS: "enabled",
        PROVIDER_ACCESS: "trusted-reads",
        CHECKOUT_PAYMENT_ROUTE: "hitpay",
        HITPAY_CHECKOUT: "enabled",
        HITPAY_RECOVERY: "enabled",
        HITPAY_WEBHOOK: "enabled",
        HITPAY_CONTRACT_ACCEPTED: "sandbox-reviewed",
        HITPAY_SANDBOX_API_KEY: "synthetic-key",
        HITPAY_WEBHOOK_SALT: "synthetic-salt",
        HITPAY_BUSINESS_ID: businessId,
        HITPAY_MERCHANT: "soccerbot",
        SIMPLYBOOK_EXTERNAL_PAYMENT: "sandbox-reviewed",
        SIMPLYBOOK_EXTERNAL_PROCESSOR: "manual",
        SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-developer",
        SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-operator",
        SIMPLYBOOK_DEV_API_KEY: "synthetic-public-secret",
        SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "synthetic-admin-secret",
        SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
      },
      d1Databases: { STATE: "synthetic-state" },
      durableObjects: {
        COORDINATOR: {
          className: "SoccerBotAccountCoordinator",
          useSQLite: true,
        },
      },
      serviceBindings: { ASSETS: () => new Response(null, { status: 404 }) },
      outboundService: async (request) => {
        const url = new URL(request.url);
        const body =
          request.method === "POST" || request.method === "PUT"
            ? await request.json()
            : null;
        const call = { url: request.url, method: request.method, body };
        calls.push(call);
        const override = await options.respond?.(call);
        if (override) return override;
        if (
          url.hostname === "api.sandbox.hit-pay.com" &&
          url.pathname === "/v1/payment-requests" &&
          request.method === "POST"
        ) {
          assert.equal(body.amount, "88.00");
          assert.equal(body.currency, "SGD");
          reference = body.reference_number;
          return Response.json({
            id: requestId,
            reference_number: reference,
            amount: "88.00",
            currency: "SGD",
            status: "pending",
            allow_repeated_payments: false,
            is_currency_editable: false,
            business_id: businessId,
            url: checkoutUrl,
            payments: [],
            expiry_date: wall(Date.now() + 180000),
          });
        }
        if (
          url.hostname === "api.sandbox.hit-pay.com" &&
          url.pathname === `/v1/payment-requests/${requestId}` &&
          request.method === "GET"
        ) {
          return Response.json({
            id: requestId,
            reference_number: reference,
            amount: "88.00",
            currency: "SGD",
            status: paymentComplete ? "completed" : "pending",
            allow_repeated_payments: false,
            is_currency_editable: false,
            business_id: businessId,
            url: checkoutUrl,
            payments: paymentComplete
              ? [
                  {
                    id: "20000000-0000-4000-8000-000000000004",
                    amount: "88.00",
                    currency: "SGD",
                    status: "succeeded",
                    refunded_amount: "0",
                  },
                ]
              : [],
          });
        }
        if (
          ["user-api.simplybook.me", "user-api-v2.simplybook.me"].includes(
            url.hostname,
          )
        ) {
          if (
            /^\/admin\/bookings\/\d+\/comment$/.test(url.pathname) &&
            request.method === "PUT"
          ) {
            assert.match(body.comment, /^Number of players: [1-4]/);
            assert.match(body.comment, /Preferred communication: /);
            return Response.json({ comment: body.comment });
          }
          if (url.pathname === "/admin/auth")
            return Response.json({ token: "synthetic-admin-token" });
          if (url.pathname === "/admin/company/info")
            return Response.json({ login: "synthetic-developer" });
          if (url.pathname === "/admin/tariff/current")
            return Response.json({
              limits: [{ key: "sheduler_limit", total: 100, rest: 100 }],
            });
          if (
            url.pathname === "/admin/invoices/901/accept-payment" &&
            request.method === "PUT"
          ) {
            assert.equal(paymentComplete, true);
            assert.equal(
              invoice.payment_received,
              false,
              "external payment must not be repeated",
            );
            assert.deepEqual(body, { payment_processor: "manual" });
            invoice.payment_received = true;
            invoice.payment_processor = "manual";
            invoice.status = "paid";
            booking.invoice_payment_received = "1";
            booking.invoice_payment_processor = "manual";
            booking.invoice_status = "paid";
            return Response.json(invoice);
          }
          if (url.pathname === "/admin/invoices/901")
            return Response.json(invoice);
          const matrix = {};
          if (body?.method === "getStartTimeMatrix")
            for (
              let cursor = new Date(body.params[0] + "T00:00:00Z");
              cursor.toISOString().slice(0, 10) <= body.params[1];
              cursor.setUTCDate(cursor.getUTCDate() + 1)
            ) {
              const key = cursor.toISOString().slice(0, 10);
              matrix[key] = key === date && !booked ? ["12:10:00"] : [];
            }
          const results = {
            getToken: "synthetic-public-token",
            getEventList: {
              2: {
                id: 2,
                name: "Native Session",
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
              14: { id: 14, name: "Native Trainer", is_active: "1" },
            },
            getAdditionalFields: [],
            getAvailableUnits: booked ? [] : [14],
            getStartTimeMatrix: matrix,
            book: creation,
            getBookingDetails: booking,
          };
          if (body && Object.hasOwn(results, body.method)) {
            if (body.method === "book") {
              assert.equal(booked, false, "a hold must never book twice");
              booked = true;
            }
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: results[body.method],
            });
          }
        }
        unexpected.push(`${request.method} ${url.hostname}${url.pathname}`);
        throw new Error("Unexpected simulated provider request");
      },
    }),
  );
  try {
    await mf.ready;
    const db = await mf.getD1Database("STATE");
    for (const name of readdirSync("migrations")
      .sort()
      .filter((n) => !n.startsWith("0005")))
      await db.exec(
        readFileSync(`migrations/${name}`, "utf8")
          .replace(/^--.*$/gm, "")
          .replace(/\n/g, " "),
      );
    await seedFoundation(mf, db);
    return {
      mf,
      db,
      origin,
      date,
      startMs,
      checkoutUrl,
      calls,
      unexpected,
      async completePayment() {
        assert.ok(reference, "payment request must exist before payment");
        paymentComplete = true;
        const body = JSON.stringify({
          id: requestId,
          reference_number: reference,
          status: "completed",
        });
        return mf.dispatchFetch(origin + "/api/webhooks/hitpay", {
          method: "POST",
          body,
          headers: {
            "content-type": "application/json",
            "Hitpay-Signature": createHmac("sha256", "synthetic-salt")
              .update(body)
              .digest("hex"),
          },
        });
      },
      recover: async () => (await mf.getWorker()).scheduled(),
      close: () => mf.dispose(),
    };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
