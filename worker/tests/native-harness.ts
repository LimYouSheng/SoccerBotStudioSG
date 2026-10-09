// Isolated test entry. Never deployed; caller-supplied fixtures have no live authority.
import {
  normalizeNativeReads,
  normalizeNativeCreation,
  minorUnits,
  providerFlag,
  bookingWallTime,
} from "../provider-normalization";
import {
  nativeBookingOperations,
  nativeCheckoutLink,
  prepareNativeLink,
  nativeBookingSignature,
  storedNativeCheckout,
  storedNativeSignature,
  type NativeScope,
} from "../native-adapter";
import { providerRequest, type NativeRequest } from "../provider-transport";
import { ProviderSession, type ProviderControl } from "../provider-session";
import { decideStoredConfirmation, checkoutContext } from "../confirmation";
import { runNativeReadback } from "../recovery";
import { policy } from "../policy";
import { orchestrateBooking, prepareAttempt } from "../index";
import worker from "../index";
export { SoccerBotAccountCoordinator } from "../coordinator";
const harness = {
  async fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname.startsWith("/api/"))
      return worker.fetch(request, env);
    const input = (await request.json()) as {
      action: string;
      scope: NativeScope;
      association: unknown;
      booking: unknown;
      invoice: unknown;
      creation: unknown;
      now: number;
      bookingAt?: number;
      invoiceAt?: number;
      value: unknown;
      scenario?: string;
      operation: NativeRequest;
      cookie: string;
      owner: string;
    };
    let reserved = 0,
      finished = 0,
      requests = 0;
    const control: ProviderControl = {
      reserve: async () => {
        reserved++;
        return String(reserved);
      },
      finish: () => {
        finished++;
      },
      claim: () => ({ claim: "synthetic-claim", generation: 1 }),
      complete: () => true,
      pause: () => {},
    };
    const exchange = async (operation: NativeRequest) => {
      requests++;
      if (input.scenario === "lost") throw new Error("synthetic lost reply");
      return {
        body:
          operation.kind === "book"
            ? input.creation
            : operation.kind === "booking-read"
              ? input.booking
              : operation.kind === "invoice-read"
                ? input.invoice
                : input.value,
        receivedAtMs: input.now,
      };
    };
    try {
      let result: unknown;
      const admittedEnv = { ...env };
      Reflect.set(admittedEnv, "PROVIDER_ACCESS", "trusted-reads");
      Reflect.set(admittedEnv, "CAMPAIGN_END_MS", String(Date.now() + 600000));
      const context = {
        ...input.scope,
        association: input.association,
        bookingObservedAtMs: input.bookingAt ?? input.now,
        invoiceObservedAtMs: input.invoiceAt ?? input.now,
      };
      switch (input.action) {
        case "normalize": {
          const observation = normalizeNativeReads(
            input.booking,
            input.invoice,
            context,
          );
          result = {
            observation,
            decision: decideStoredConfirmation(
              {
                id: input.scope.attemptId,
                created_ms: input.now - 60000,
                deadline_ms: input.now + 60000,
                state: "observed",
                intent_json: JSON.stringify(input.scope.intent),
                association_json: JSON.stringify(input.association),
                observation_json: JSON.stringify(observation),
              },
              {
                owner_id: "synthetic-owner",
                capability_hash: "synthetic",
                issued_ms: input.now - 60000,
                expires_ms: input.now + 60000,
              },
              input.now,
              policy(env),
            ),
          };
          break;
        }
        case "creation": {
          const created = normalizeNativeCreation(input.creation, context);
          result = {
            association: created.association,
            invoice: created.invoice,
            retainedHash: !!created.bookingHash,
          };
          break;
        }
        case "scalar":
          result = {
            money: minorUnits(input.value),
            flag: providerFlag(input.value),
          };
          break;
        case "time":
          result = bookingWallTime(
            input.value,
            input.scenario || "Asia/Singapore",
          );
          break;
        case "link":
          result = nativeCheckoutLink(
            input.value,
            input.scenario !== "unconfigured",
          );
          break;
        case "stored-signature":
          result = await storedNativeSignature(
            env.STATE,
            input.scope.attemptId,
            input.scenario === "foreign" ? "702" : "701",
            "synthetic-signing-secret",
          );
          break;
        case "protected-context":
          result = await checkoutContext(
            new Request("https://soccerbot.test/", {
              headers: { cookie: input.cookie },
            }),
            admittedEnv,
            input.scope.attemptId,
            input.now,
          );
          break;
        case "signature":
          result = await nativeBookingSignature(
            "701",
            "synthetic-booking-hash",
            "synthetic-signing-secret",
          );
          break;
        case "session-closed":
          result = await new ProviderSession().nativeRead(
            env,
            control,
            input.operation,
          );
          break;
        case "transport":
          result = await providerRequest(
            "native",
            {
              company: "synthetic-developer",
              login: "synthetic-operator",
              publicKey: "synthetic-key",
              adminKey: "synthetic-admin",
            },
            "synthetic-token",
            control,
            input.operation,
          );
          break;
        case "orchestrate": {
          const operations = nativeBookingOperations({
            scope: input.scope,
            exchange,
            client: { synthetic: true },
            intake: {},
            revalidate: async (value) => value,
            hasRecoveryCapacity: async () => true,
            db: env.STATE,
          });
          result = await orchestrateBooking(
            new Request("https://soccerbot.test/", {
              headers: { cookie: input.cookie },
            }),
            env,
            input.scope.attemptId,
            operations,
          );
          break;
        }
        case "prepare":
          result = await prepareAttempt(
            env.STATE,
            input.owner,
            crypto.randomUUID(),
            input.scope.intent,
            input.now,
            600000,
          );
          break;
        case "prepare-link":
          result = await prepareNativeLink(
            env.STATE,
            input.scope,
            exchange,
            true,
            input.scenario === "expiry-unknown"
              ? undefined
              : input.now + 300000,
          );
          break;
        case "stored-link":
          result = await storedNativeCheckout(
            env.STATE,
            input.scope.attemptId,
            input.association,
            input.now,
          );
          break;
        case "readback":
          result = await runNativeReadback(
            input.scenario === "closed" ? env : admittedEnv,
            {
              scope: input.scope,
              claimant: "synthetic-native-operator",
              phase: "initial",
              grantExpiresMs: Date.now() + 600000,
              exchange,
              signature: async () => "a".repeat(32),
            },
          );
          break;
        default:
          throw new Error("unknown fixture action");
      }
      return Response.json({ result, reserved, finished, requests });
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : "failed",
          reserved,
          finished,
          requests,
        },
        { status: 409 },
      );
    }
  },
};

export default harness;
