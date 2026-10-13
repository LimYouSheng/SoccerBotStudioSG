import { NativeCalendarReads } from "../native-calendar";
import {
  executeNativeCheckout,
  prepareCustomerNative,
  currentCustomerNative,
  customerNativeAvailability,
  customerNativeCalendar,
} from "../native-checkout";
// Isolated test entry. Never deployed; caller-supplied fixtures have no live authority.
import {
  normalizeNativeReads,
  normalizeNativeCreation,
  normalizeNativeSession,
  nativeValidationReason,
  minorUnits,
  providerFlag,
  bookingWallTime,
} from "../provider-normalization";
import {
  nativeBookingOperations,
  recoverNativeAssociation,
  compensateNativeAttempt,
  nativeCheckoutLink,
  nativeCheckoutDeadline,
  type NativeCheckoutTiming,
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
import { recoverNativeResidual } from "../native-residual";
import { policy, rpcOutcome } from "../policy";
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
      operatorRecovery?: { expiresMs: number; expectedBookingIds: string[] };
      invoiceAt?: number;
      value: unknown;
      scenario?: string;
      operation: NativeRequest;
      cookie: string;
      owner: string;
      fixtureCeiling?: string;
      fixtureUsed?: number;
      fixtureExpireAfter?: number;
      fixtureClockOffset?: number;
      batchRequiresConfirm?: unknown;
      batchReceipt?: unknown;
      batchReceipts?: unknown[];
      batchClosure?: unknown;
    };
    let reserved = 0,
      finished = 0,
      requests = 0;
    const sent: NativeRequest[] = [];
    let validation: ReturnType<typeof nativeValidationReason>;
    const realNow = Date.now;
    const fixtureNow = realNow();
    let clockOffset = input.fixtureClockOffset ?? 0;
    if (
      input.fixtureExpireAfter !== undefined ||
      input.fixtureClockOffset !== undefined
    )
      // Explicit expiry fixtures advance only at their chosen physical-call boundary.
      // CI runtime must not inject extra identity expirations into this assertion.
      Date.now = () =>
        (input.fixtureExpireAfter !== undefined ? fixtureNow : realNow()) +
        clockOffset;
    const control: ProviderControl = {
      reserve: async () => {
        reserved++;
        return String(reserved);
      },
      finish: () => {
        finished++;
        if (finished === input.fixtureExpireAfter) clockOffset += 6000;
      },
      claim: () => ({ claim: "synthetic-claim", generation: 1 }),
      complete: () => true,
      pause: () => {},
    };
    const exchange = async (operation: NativeRequest) => {
      requests++;
      sent.push(operation);
      if (
        input.scenario === "lost" ||
        (input.scenario === "second-book-lost" &&
          operation.kind === "book" &&
          sent.filter((item) => item.kind === "book").length === 2) ||
        (input.scenario === "batch-close-lost" &&
          operation.kind === "batch-close")
      )
        throw new Error("synthetic lost reply");
      if (operation.kind === "booking-cancel") {
        const bookings = (
          Array.isArray(input.booking) ? input.booking : [input.booking]
        ) as Record<string, unknown>[];
        const booking = bookings.find(
          (value) => String(value.id) === operation.bookingId,
        )!;
        booking.status = "cancelled";
        booking.is_confirmed = "0";
        const invoice = input.invoice as {
          lines: {
            bookings: { id: string | number; is_confirmed: boolean }[];
          }[];
          status: string;
          payment_received: boolean;
          payment_processor: string | null;
        };
        for (const line of invoice.lines)
          for (const nested of line.bookings)
            if (String(nested.id) === operation.bookingId)
              nested.is_confirmed = false;
        if (input.scenario === "cancelled-invoice") {
          invoice.status = "cancelled";
          for (const value of bookings) value.invoice_status = "cancelled";
        }
        if (input.scenario === "paid-after-cancel") {
          invoice.status = "paid";
          invoice.payment_received = true;
          invoice.payment_processor = "hitpay";
          for (const value of bookings) {
            value.invoice_status = "paid";
            value.invoice_payment_received = true;
            value.invoice_payment_processor = "hitpay";
          }
        }
        if (input.scenario === "cancel-lost")
          throw new Error("synthetic lost cancellation reply");
        return { body: true, receivedAtMs: input.now };
      }
      if (input.scope?.intent.sessions.length > 1) {
        if (operation.kind === "batch-create") {
          if (input.scenario === "revoke-after-batch")
            await env.STATE.prepare(
              "UPDATE guest_access SET revoked_ms=? WHERE owner_id=(SELECT owner_id FROM attempts WHERE id=?)",
            )
              .bind(Date.now(), input.scope.attemptId)
              .run();
          return { body: 601, receivedAtMs: input.now };
        }
        if (operation.kind === "batch-close")
          return {
            body: input.batchClosure ?? input.creation,
            receivedAtMs: input.now,
          };
        if (operation.kind === "book") {
          const creation = input.creation as { bookings: unknown[] };
          const index = sent.filter((item) => item.kind === "book").length - 1;
          return {
            body:
              input.batchReceipts !== undefined
                ? input.batchReceipts[index]
                : input.batchReceipt !== undefined
                  ? input.batchReceipt
                  : {
                      require_confirm: input.batchRequiresConfirm ?? false,
                      invoice: null,
                      batch_id: 601,
                      batch_hash: "synthetic-batch-hash",
                      bookings: [
                        creation.bookings[
                          sent.filter((item) => item.kind === "book").length - 1
                        ],
                      ],
                    },
            receivedAtMs: input.now,
          };
        }
        if (operation.kind === "booking-read" && Array.isArray(input.booking))
          return {
            body: input.booking.find(
              (booking: { id: string }) => booking.id === operation.bookingId,
            ),
            receivedAtMs: input.now,
          };
      }
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
        case "validation-rpc":
          result = await rpcOutcome(async () =>
            normalizeNativeCreation(input.creation, context),
          );
          break;
        case "session":
          result = normalizeNativeSession(
            input.creation,
            context,
            0,
            input.scenario === "batch-item" ? "batch-item" : "finalized",
          );
          break;
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
        case "deadline":
          result = nativeCheckoutDeadline(
            input.value as NativeCheckoutTiming,
            input.now,
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
        case "recover-association": {
          result = await recoverNativeAssociation({
            db: env.STATE,
            scope: input.scope,
            exchange,
            signingSecret: "synthetic-signing-secret",
            signal: new AbortController().signal,
          });
          break;
        }
        case "inspect-diagnostic":
        case "residual-diagnostic":
          result = await recoverNativeResidual({
            db: env.STATE,
            scope: input.scope,
            exchange,
            signingSecret: "synthetic-signing-secret",
            expiresMs: input.now + 120000,
            authority: {
              ...(input.action === "inspect-diagnostic"
                ? { mode: "inspect" as const }
                : {}),
              sourceRevision: "c".repeat(40),
              expectedBookingIds: ["701"],
            },
            assertGranted: async () => {},
            invalidate: () => {},
          });
          break;
        case "compensate": {
          result = await compensateNativeAttempt({
            operatorRecovery: input.operatorRecovery,
            db: env.STATE,
            scope: input.scope,
            exchange,
            signingSecret: "synthetic-signing-secret",
            signal: new AbortController().signal,
            assertGranted: async () => {
              if (input.scenario === "cleanup-revoked")
                throw new Error("synthetic revoked cleanup grant");
            },
            invalidate: () => {},
          });
          break;
        }
        case "customer-prepare":
        case "customer-current":
        case "customer-calendar":
        case "customer-availability":
        case "session-expired":
        case "finite-checkout": {
          if (input.fixtureCeiling !== undefined)
            Reflect.set(
              admittedEnv,
              "PROVIDER_CALL_CEILING",
              input.fixtureCeiling,
            );
          for (const [key, value] of Object.entries({
            SOURCE_REVISION: "c".repeat(40),
            SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-developer",
            SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-operator",
            SIMPLYBOOK_DEV_API_KEY: "synthetic-public-key",
            SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "synthetic-admin-key",
            SIMPLYBOOK_DEV_SIGNING_SECRET: "synthetic-signing-secret",
          }))
            Reflect.set(admittedEnv, key, value);
          const customerRequest = new Request("https://soccerbot.test/", {
            headers: { cookie: input.cookie },
          });
          if (input.action === "session-expired") {
            const provider = new ProviderSession();
            await provider.identity(admittedEnv, control);
            clockOffset += 6000;
            result = await provider.nativeRead(admittedEnv, control, {
              kind: "catalogue-services",
            });
            break;
          }
          if (input.action === "customer-prepare") {
            result = await prepareCustomerNative(
              customerRequest,
              admittedEnv,
              input.value,
            );
            break;
          }
          if (input.action === "customer-current") {
            result = await currentCustomerNative(customerRequest, admittedEnv);
            break;
          }
          if (input.action === "customer-calendar") {
            const value = input.value as { month: string; serviceId: string };
            result = await customerNativeCalendar({
              request: customerRequest,
              env: admittedEnv,
              ...value,
              provider: new ProviderSession(),
              control,
              cache: new NativeCalendarReads(),
              accounting: () => ({
                used: 15 + reserved,
                active: reserved - finished,
              }),
            });
            break;
          }
          if (input.action === "customer-availability") {
            const value = input.value as { date: string; serviceId: string };
            result = await customerNativeAvailability({
              request: customerRequest,
              env: admittedEnv,
              ...value,
              provider: new ProviderSession(),
              control,
              accounting: () => ({
                used: 15 + reserved,
                active: reserved - finished,
              }),
            });
            break;
          }
          result = await executeNativeCheckout({
            request: new Request("https://soccerbot.test/", {
              headers: { cookie: input.cookie },
            }),
            env: admittedEnv,
            attemptId: input.scope.attemptId,
            provider: new ProviderSession(),
            control,
            recoveryControl: control,
            accounting: () => ({
              used: (input.fixtureUsed ?? 15) + reserved,
              active: reserved - finished,
            }),
          });
          break;
        }
        case "orchestrate": {
          const operations = nativeBookingOperations({
            scope: input.scope,
            exchange,
            additional: { handle_invoice: true },
            prebooking: {
              revalidate: async (value) => value,
              invalidate: () => {},
            },
            hasRecoveryCapacity: async () => true,
            db: env.STATE,
            clientSignature: async (id, hash) =>
              nativeBookingSignature(id, hash, "synthetic-signing-secret"),
            batchSignature: async (id, hash) =>
              nativeBookingSignature(id, hash, "synthetic-signing-secret"),
          });
          operations.onFailure = (error) => {
            validation ??= nativeValidationReason(error);
          };
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
              : {
                  invoiceId: "901",
                  dueDatetime: new Date(input.now + 330000)
                    .toISOString()
                    .replace(".000", "")
                    .replace(/\.\d{3}Z$/, "Z"),
                  supervisionDeadlineMs: input.now + 600000,
                  handoffAtMs: input.now,
                },
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
      return Response.json({
        result,
        reserved,
        finished,
        requests,
        sent,
        validation,
      });
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : "failed",
          validation: nativeValidationReason(error),
          reserved,
          finished,
          requests,
          sent,
        },
        { status: 409 },
      );
    } finally {
      if (
        input.fixtureExpireAfter !== undefined ||
        input.fixtureClockOffset !== undefined
      )
        Date.now = realNow;
    }
  },
};

export default harness;
