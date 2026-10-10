// Synthetic-only entry. Never packaged by the developer release.
import app, {
  requestIdentityChallenge,
  verifyIdentityChallenge,
  readVerifiedIdentity,
  verifiedContact,
} from "../index";
import { createAccess } from "../access";
import {
  restoreRememberedIdentity,
  revokeAllIdentities,
} from "../remembered-identity";
export { SoccerBotAccountCoordinator } from "../index";
const pepper = "SYNTHETIC_PRIVATE_PEPPER_FOR_IDENTITY_123456789";
export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/synthetic-identity/"))
      return app.fetch(request, env);
    const input = (await request.json()) as {
      action:
        | "challenge"
        | "verify"
        | "read"
        | "profile"
        | "restore"
        | "guest"
        | "all-signout";
      now: number;
      remember?: boolean;
      email?: string;
      code?: string;
      challengeId?: string;
      botToken?: string;
      bot?: "denied" | "expired" | "wrong-action";
      delivery?: "lost";
      source?: string;
      matches?: unknown;
    };
    const sent: { email: string; code: string; idempotencyKey: string }[] = [];
    const cookies: string[] = [];
    try {
      let result: unknown;
      if (input.action === "challenge")
        result = await requestIdentityChallenge(
          request,
          env,
          { email: input.email, botToken: input.botToken },
          {
            pepper,
            source: input.source ?? "synthetic-source",
            hostname: "soccerbot.test",
            now: () => input.now,
            verifyBot: async () => ({
              success: input.bot !== "denied",
              hostname: "soccerbot.test",
              action: input.bot === "wrong-action" ? "other" : "verify-email",
              challengeAtMs:
                input.now - (input.bot === "expired" ? 300000 : 1000),
            }),
            send: async (message) => {
              sent.push(message);
              if (input.delivery === "lost")
                throw new Error("SYNTHETIC_PRIVATE_DELIVERY_ERROR");
              return { accepted: true };
            },
          },
        );
      else if (input.action === "verify")
        result = await verifyIdentityChallenge(
          request,
          env,
          {
            email: input.email,
            code: input.code,
            challengeId: input.challengeId,
            remember: input.remember,
          },
          pepper,
          () => input.now,
          cookies,
        );
      else if (input.action === "restore")
        result = await restoreRememberedIdentity(
          request,
          env,
          pepper,
          cookies,
          () => input.now,
        );
      else if (input.action === "guest") {
        cookies.push(await createAccess(env, input.now));
        result = null;
      } else if (input.action === "all-signout") {
        await revokeAllIdentities(request, env, input.now);
        result = null;
      } else if (input.action === "read")
        result = await readVerifiedIdentity(request, env, input.now);
      else result = verifiedContact(input.email ?? "", input.matches);
      return Response.json({ result, sent, cookies });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "failed", sent },
        { status: 400 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
