import { runScheduledRecovery } from "./scheduled-recovery";
import { customerCatalogue } from "./customer-catalogue";
import {
  restoreRememberedIdentity,
  revokeAllIdentities,
  clearRememberedCookie,
  revokePresentedRemembered,
} from "./remembered-identity";
import { readVerifiedIdentity } from "./identity";
import { identityDelivery, assertIdentityProofOpen } from "./identity-delivery";
import {
  createAccess,
  authenticate,
  revokeAccess,
  clearAccessCookie,
} from "./access";
import { confirmation, checkoutContext } from "./confirmation";
import { ApiError, policy } from "./policy";
import { verifyBindings } from "./bindings";
import { traced, instrumentStorage, traceStatus } from "./diagnostics";
import { developerOperation } from "./developer-operation";
export {
  requestIdentityChallenge,
  verifyIdentityChallenge,
  readVerifiedIdentity,
  verifiedContact,
} from "./identity";
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
  async scheduled(event: ScheduledController, env: Env) {
    event.noRetry();
    try {
      await runScheduledRecovery(env);
    } catch {
      console.error(
        JSON.stringify({ event: "scheduled_recovery_unavailable" }),
      );
    }
  },
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
        const configuration = policy(env);
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
        // Empty durable window and disabled deployment default keep delivery closed.
        if (
          ["/api/identity/challenges", "/api/identity/verify"].includes(
            url.pathname,
          )
        ) {
          const cookies: string[] = [];
          const response = json(await identityDelivery(request, env, cookies));
          for (const cookie of cookies)
            response.headers.append("Set-Cookie", cookie);
          return response;
        }
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
            versionId: env.CF_VERSION_METADATA?.id ?? null,
            origin: env.APP_ORIGIN,
            campaignEndMs: Number(env.CAMPAIGN_END_MS),
            effectiveProviderAccess:
              configuration.PROVIDER_ACCESS === "trusted-reads" &&
              now < Number(env.CAMPAIGN_END_MS)
                ? "trusted-reads"
                : "disabled",
            readinessNonce: /^[a-f0-9]{32}$/.test(
              request.headers.get("X-Readiness-Nonce") ?? "",
            )
              ? request.headers.get("X-Readiness-Nonce")
              : null,
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
            try {
              await authenticate(request, env, now);
              return json({ access: "guest" });
            } catch (error) {
              if (!(error instanceof ApiError) || error.status !== 401)
                throw error;
              // A new guest never inherits the expired/revoked owner's attempts.
            }
          }
          return json({ access: "guest" }, 201, {
            "Set-Cookie": await createAccess(env, now),
          });
        }
        if (url.pathname === "/api/access" && request.method === "DELETE") {
          const access = await authenticate(request, env, now).catch(
            (error: unknown) => {
              if (error instanceof ApiError && error.status === 401)
                return null;
              throw error;
            },
          );
          await revokePresentedRemembered(request, env, now);
          const response = json({ access: "revoked" }, 200, {
            "Set-Cookie": access
              ? await revokeAccess(env, access, now)
              : clearAccessCookie(),
          });
          response.headers.append("Set-Cookie", clearRememberedCookie());
          return response;
        }
        if (
          url.pathname === "/api/identity/restore" &&
          request.method === "POST"
        ) {
          await assertIdentityProofOpen(env);
          const cookies: string[] = [];
          const pepper: unknown = Reflect.get(env, "IDENTITY_PEPPER");
          const identity = await restoreRememberedIdentity(
            request,
            env,
            typeof pepper === "string" ? pepper : "",
            cookies,
          );
          await assertIdentityProofOpen(env);
          const response = json(identity);
          for (const cookie of cookies)
            response.headers.append("Set-Cookie", cookie);
          return response;
        }
        if (
          url.pathname === "/api/identity/all-devices" &&
          request.method === "DELETE"
        ) {
          await revokeAllIdentities(request, env, now);
          const response = json({ access: "revoked" });
          response.headers.append("Set-Cookie", clearRememberedCookie());
          response.headers.append("Set-Cookie", clearAccessCookie());
          return response;
        }
        if (url.pathname === "/api/catalogue" && request.method === "GET")
          return json(await customerCatalogue(request, env, now));
        if (url.pathname === "/api/identity" && request.method === "GET") {
          await assertIdentityProofOpen(env);
          const identity = await readVerifiedIdentity(request, env, now);
          await assertIdentityProofOpen(env);
          return json(identity);
        }
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
