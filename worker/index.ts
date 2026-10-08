import { createAccess, authenticate, revokeAccess } from "./access";
import { confirmation } from "./confirmation";
import { ApiError, policy } from "./policy";
import { developerIdentity } from "./developer-operation";
export { SoccerBotAccountCoordinator } from "./coordinator";
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
    const json = (
      body: unknown,
      status = 200,
      extra: Record<string, string> = {},
    ) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, "X-Request-ID": correlationId, ...extra },
      });
    try {
      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);
      policy(env);
      if (url.protocol !== "https:")
        throw new ApiError(400, "secure_transport_required");
      if (url.search) throw new ApiError(400, "unexpected_parameters");
      if (
        request.method !== "GET" &&
        request.headers.get("origin") !== url.origin
      )
        throw new ApiError(403, "origin_denied");
      // These initial named operations accept no payload at all.
      if (request.body !== null) {
        const reader = request.body.getReader();
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (chunk.value.byteLength) {
              await reader.cancel();
              throw new ApiError(413, "payload_not_supported");
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
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
        url.pathname === "/api/developer/provider-identity" &&
        (request.method === "POST" || request.method === "GET")
      )
        return json(await developerIdentity(request, env, now));
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
        return json(await confirmation(request, env, match[1], now));
      if (url.pathname === "/api/attempts" && request.method === "POST") {
        await authenticate(request, env, now);
        throw new ApiError(503, "booking_prerequisites_blocked");
      }
      throw new ApiError(404, "operation_unavailable");
    } catch (error) {
      if (error instanceof ApiError)
        return json({ error: error.code }, error.status);
      console.error(JSON.stringify({ event: "request_failed", correlationId }));
      return json({ error: "temporarily_unavailable" }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
