// Isolated local synthetic composition. Never exported from worker/index.ts.
import worker, {
  SoccerBotAccountCoordinator,
  prepareAttempt,
  claimDispatch,
  bindAssociation,
  recordObservation,
} from "../index";
import { authenticate, createAccess, revokeAccess } from "../access";
import { checkoutContext } from "../confirmation";
export { SoccerBotAccountCoordinator };
function page(id: string, done = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="origin"><title>Synthetic checkout · SoccerBot</title><style>body{font:18px system-ui;background:#f4f7fa;color:#102344;margin:0;padding:32px}main{max-width:560px;margin:6vh auto;background:white;padding:32px;border-radius:24px}button{display:block;background:#003da5;color:white;border:0;border-radius:12px;padding:16px;margin:16px 0;font:inherit;width:100%}p{line-height:1.6}</style></head><body><main><p>Experiment 1 · Synthetic Preview</p><h1>${done ? "Synthetic evidence saved" : "Simulated checkout"}</h1><p>No payment details are collected. No real booking or payment is made.</p>${done ? "<p>Return to the original SoccerBot page and check status. This page is not proof of payment.</p>" : `<p>Your original SoccerBot page stays open. Choose a synthetic result, then return there to check progress.</p><form method="post" action="/__experiment/outcome/${id}"><button name="outcome" value="confirmed">Simulate successful payment</button><button name="outcome" value="recovery">Simulate payment needing review</button><button name="outcome" value="expired">Expire synthetic access</button></form>`}</main></body></html>`;
}
const html = (value: string) =>
  new Response(value, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "origin",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    },
  });
const experimentHarness = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url),
      now = Date.now();
    try {
      if (!url.pathname.startsWith("/__experiment/")) {
        const context = /^\/api\/attempts\/([a-f0-9-]{36})\/checkout$/.exec(
          url.pathname,
        );
        if (context && request.method === "GET") {
          if (url.search) return new Response(null, { status: 400 });
          const result = await checkoutContext(request, env, context[1], now);
          const row = await env.STATE.prepare(
            "SELECT association_json FROM attempts WHERE id=?",
          )
            .bind(context[1])
            .first<{ association_json: string | null }>();
          return Response.json(
            {
              ...result,
              mode: "synthetic",
              checkout:
                row?.association_json && now < result.checking.deadlineMs
                  ? {
                      state: "available",
                      url: `/__experiment/checkout/${context[1]}`,
                    }
                  : { state: "unavailable" },
            },
            {
              headers: {
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
              },
            },
          );
        }
        return worker.fetch(request, env);
      }
      if (
        url.search ||
        (request.method !== "GET" &&
          request.headers.get("origin") !== env.APP_ORIGIN)
      )
        return new Response(null, { status: 403 });
      if (
        url.pathname === "/__experiment/attempts" &&
        request.method === "POST"
      ) {
        let cookie: string | undefined, access;
        try {
          access = await authenticate(request, env, now);
        } catch {
          cookie = await createAccess(env, now);
          const headers = new Headers(request.headers);
          headers.set("cookie", cookie.split(";")[0]);
          request = new Request(request, { headers });
          access = await authenticate(request, env, now);
        }
        const old = await env.STATE.withSession("first-primary")
          .prepare(
            "SELECT id FROM attempts WHERE owner_id=? AND idempotency_key='experiment-checkout-0001'",
          )
          .bind(access.owner_id)
          .first<{ id: string }>();
        let id = old?.id;
        if (!id) {
          const intent = {
            accountId: "synthetic-account",
            environmentId: "developer",
            customerId: "synthetic-customer",
            currency: "SGD",
            totalMinor: 8800,
            taxMinor: 0,
            sessions: [
              {
                serviceId: "service-2",
                instructorId: "instructor-2",
                startMs: now + 86400000,
                players: 2,
                totalMinor: 8800,
                taxMinor: 0,
              },
            ],
          };
          const a = await prepareAttempt(
            env.STATE,
            access.owner_id,
            "experiment-checkout-0001",
            intent,
            now,
            600000,
          );
          id = a.id;
          if (a.state === "prepared") {
            const claim = await claimDispatch(env.STATE, id, a.version, now);
            const fence = await bindAssociation(env.STATE, id, claim.fence, {
              invoiceId: `invoice-${id}`,
              bookingIds: [`booking-${id}`],
            });
            await recordObservation(
              env.STATE,
              id,
              fence,
              evidence(id, intent.sessions[0].startMs, now, "pending"),
              now,
            );
          }
        }
        return Response.json(
          { attemptId: id },
          {
            headers: {
              "Cache-Control": "no-store",
              ...(cookie ? { "Set-Cookie": cookie } : {}),
            },
          },
        );
      }
      const match =
        /^\/__experiment\/(checkout|outcome)\/([a-f0-9-]{36})$/.exec(
          url.pathname,
        );
      if (!match) return new Response(null, { status: 404 });
      const access = await authenticate(request, env, now);
      const row = await env.STATE.withSession("first-primary")
        .prepare(
          "SELECT intent_json,observation_json,version FROM attempts WHERE id=? AND owner_id=?",
        )
        .bind(match[2], access.owner_id)
        .first<{
          intent_json: string;
          observation_json: string;
          version: number;
        }>();
      if (!row) return new Response(null, { status: 404 });
      if (match[1] === "checkout" && request.method === "GET")
        return html(page(match[2]));
      if (match[1] === "outcome" && request.method === "POST") {
        const outcome = (await request.formData()).get("outcome");
        if (!["confirmed", "recovery", "expired"].includes(String(outcome)))
          return new Response(null, { status: 400 });
        if (outcome === "expired") await revokeAccess(env, access, now);
        else if (!JSON.parse(row.observation_json).invoice.paymentReceived) {
          const start = JSON.parse(row.intent_json).sessions[0]
            .startMs as number;
          await recordObservation(
            env.STATE,
            match[2],
            row.version,
            evidence(
              match[2],
              start,
              now,
              outcome === "confirmed" ? "confirmed" : "recovery",
            ),
            now,
          );
        }
        return html(page(match[2], true));
      }
      return new Response(null, { status: 404 });
    } catch {
      return Response.json(
        { error: "synthetic_operation_unavailable" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};
export default experimentHarness;
function evidence(
  id: string,
  start: number,
  now: number,
  outcome: "pending" | "confirmed" | "recovery",
) {
  const scope = {
      accountId: "synthetic-account",
      environmentId: "developer",
      attemptId: id,
      customerId: "synthetic-customer",
      observedAtMs: now,
    },
    money = { currency: "SGD", totalMinor: 8800, taxMinor: 0 };
  return {
    bookings: [
      {
        ...scope,
        invoiceId: `invoice-${id}`,
        status: outcome === "recovery" ? "cancelled" : "confirmed",
        session: {
          bookingId: `booking-${id}`,
          serviceId: "service-2",
          instructorId: "instructor-2",
          startMs: start,
          playEndMs: start + 2400000,
          occupiedStartMs: start,
          occupiedEndMs: start + 3000000,
        },
      },
    ],
    invoice: {
      ...scope,
      invoiceId: `invoice-${id}`,
      money,
      lines: [{ bookingId: `booking-${id}`, money }],
      status: outcome === "pending" ? "pending" : "paid",
      paymentReceived: outcome !== "pending",
    },
  };
}
