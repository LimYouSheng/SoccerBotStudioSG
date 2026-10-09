import { createAccess, authenticate, revokeAccess } from "./access";
import { confirmation, checkoutContext } from "./confirmation";
import { ApiError, policy } from "./policy";
import { verifyBindings } from "./bindings";
import { traced, instrumentStorage, traceStatus } from "./diagnostics";
import { developerOperation } from "./developer-operation";
export { SoccerBotAccountCoordinator } from "./coordinator";
export {
  claimRecovery,
  completeRecovery,
  runRecoveryBatch,
  runNativeReadback,
  retentionPreview,
} from "./recovery";
export {
  nativeBookingOperations,
  readNativeAttempt,
  prepareNativeLink,
} from "./native-adapter";
export { orchestrateBooking } from "./orchestration";
// Journal operations are reachable only through trusted server composition, not HTTP.
export {
  prepareAttempt,
  claimDispatch,
  recordObservation,
  requireRecovery,
  bindAssociation,
} from "./journal";
const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const correlationId = crypto.randomUUID(),
      url = new URL(request.url),
      now = Date.now();
    const checkingHeaders: Record<string, string> = {};
    const json = (
      body: unknown,
      status = 200,
      extra: Record<string, string> = {},
    ) => {
      traceStatus(status);
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          ...headers,
          ...checkingHeaders,
          "X-Request-ID": correlationId,
          ...extra,
        },
      });
    };
    return traced(correlationId, "http", async () => {
      try {
        if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);
        policy(env);
        if (url.protocol !== "https:")
          throw new ApiError(400, "secure_transport_required");
        if (url.origin !== env.APP_ORIGIN)
          throw new ApiError(403, "origin_denied");
        if (
          request.headers.get("origin") &&
          request.headers.get("origin") !== env.APP_ORIGIN
        )
          throw new ApiError(403, "origin_denied");
        if (url.search) throw new ApiError(400, "unexpected_parameters");
        if (
          request.method !== "GET" &&
          request.headers.get("origin") !== url.origin
        )
          throw new ApiError(403, "origin_denied");
        // These initial named operations accept no payload at all.
        if (request.body !== null) {
          const reader = request.body.getReader();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const first = await Promise.race([
              reader.read(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new ApiError(408, "request_body_timeout")),
                  1000,
                );
              }),
            ]);
            if (!first.done) throw new ApiError(413, "payload_not_supported");
          } finally {
            clearTimeout(timer);
            void reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        }

        env = {
          ...env,
          STATE: env.STATE ? instrumentStorage(env.STATE) : env.STATE,
        };
        await verifyBindings(env);
        if (url.pathname === "/api/health" && request.method === "GET")
          return json({
            environment: "developer",
            providerAccess: env.PROVIDER_ACCESS,
            revision: env.SOURCE_REVISION,
            providerCredentialsPresent: [
              "SIMPLYBOOK_DEV_COMPANY_LOGIN",
              "SIMPLYBOOK_DEV_ADMIN_LOGIN",
              "SIMPLYBOOK_DEV_API_KEY",
              "SIMPLYBOOK_DEV_ADMIN_API_USER_KEY",
            ].every((name) => {
              const value: unknown = Reflect.get(env, name);
              return typeof value === "string" && value.length > 0;
            }),
          });
        if (
          (url.pathname === "/api/developer/provider-identity" ||
            url.pathname === "/api/developer/historical-comparison" ||
            url.pathname === "/api/developer/native-field-discovery") &&
          (request.method === "POST" || request.method === "GET")
        )
          return json(
            await developerOperation(
              request,
              env,
              now,
              url.pathname.endsWith("provider-identity")
                ? "provider_identity"
                : url.pathname.endsWith("native-field-discovery")
                  ? "native_field_discovery"
                  : "historical_comparison",
            ),
          );
        if (url.pathname === "/api/access" && request.method === "POST") {
          if (
            request.headers.get("cookie")?.includes("__Host-soccerbot-access=")
          ) {
            await authenticate(request, env, now);
            return json({ access: "guest" });
          }
          return json({ access: "guest" }, 201, {
            "Set-Cookie": await createAccess(env, now),
          });
        }
        if (url.pathname === "/api/access" && request.method === "DELETE")
          return json({ access: "revoked" }, 200, {
            "Set-Cookie": await revokeAccess(
              env,
              await authenticate(request, env, now),
              now,
            ),
          });
        const match = /^\/api\/attempts\/([a-f0-9-]{36})\/confirmation$/.exec(
          url.pathname,
        );
        if (match && request.method === "GET")
          return json(
            await confirmation(request, env, match[1], now, (window) => {
              checkingHeaders["X-Checking-Deadline"] = String(
                window.deadlineMs,
              );
              checkingHeaders["X-Next-Check"] = String(window.nextCheckMs);
              checkingHeaders["X-Checks-Remaining"] = String(window.remaining);
            }),
          );
        const checkout = /^\/api\/attempts\/([a-f0-9-]{36})\/checkout$/.exec(
          url.pathname,
        );
        if (checkout && request.method === "GET")
          return json(await checkoutContext(request, env, checkout[1], now));
        if (url.pathname === "/api/attempts" && request.method === "POST") {
          await authenticate(request, env, now);
          throw new ApiError(503, "booking_prerequisites_blocked");
        }
        throw new ApiError(404, "operation_unavailable");
      } catch (error) {
        if (error instanceof ApiError)
          return json({ error: error.code }, error.status);
        console.error(
          JSON.stringify({ event: "request_failed", correlationId }),
        );
        return json({ error: "temporarily_unavailable" }, 503);
      }
    });
  },
} satisfies ExportedHandler<Env>;
