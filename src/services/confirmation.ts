import { isNativeCheckoutUrl } from "@/domain/native-checkout";
import { z } from "zod";
import type { ProtectedCheckoutService } from "./contracts";
const idSchema = z.string().uuid();
const decisionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), reason: z.literal("verified") }),
  z.object({ status: z.literal("pending"), reason: z.string() }),
  z.object({ status: z.literal("unresolved"), reason: z.string() }),
  z.object({ status: z.literal("invalid"), reason: z.string() }),
  z.object({ status: z.literal("denied"), reason: z.literal("access_denied") }),
]);
export class ConfirmationError extends Error {
  constructor(
    public kind: "denied" | "unavailable" | "throttled" | "exhausted",
    public nextCheckMs?: number,
    public deadlineMs?: number,
  ) {
    super("confirmation_unavailable");
  }
}
const instant = z.number().int().nonnegative().safe();
const contextSchema = z.strictObject({
  attemptId: idSchema,
  mode: z.enum(["synthetic", "live"]),
  checkout: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unavailable") }),
    z.strictObject({
      state: z.literal("available"),
      url: z.string().max(2048),
      expiresAtMs: instant.optional(),
    }),
  ]),
  summary: z.strictObject({
    players: z.number().int().min(1).max(4),
    totalMinor: instant,
    currency: z.literal("SGD"),
    sessions: z
      .array(
        z.strictObject({
          startMs: instant,
          players: z.number().int().min(1).max(4),
        }),
      )
      .min(1)
      .max(12),
  }),
  checking: z.strictObject({
    deadlineMs: instant,
    nextCheckMs: instant,
    pollAfterMs: z.number().int().min(1000).max(30000),
  }),
});
async function protectedRead(
  attemptId: string,
  operation: string,
  signal: AbortSignal,
) {
  idSchema.parse(attemptId);
  const response = await fetch(
    `/api/attempts/${encodeURIComponent(attemptId)}/${operation}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
      headers: { Accept: "application/json" },
    },
  );
  const value = (name: string) => {
    const raw = response.headers.get(name);
    const n = Number(raw);
    return raw && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
  };
  const checking = {
    nextCheckMs: value("X-Next-Check"),
    deadlineMs: value("X-Checking-Deadline"),
  };
  if (response.status === 401 || response.status === 403)
    throw new ConfirmationError("denied");
  if (response.status === 429)
    throw new ConfirmationError(
      response.headers.get("X-Checks-Remaining") === "0"
        ? "exhausted"
        : "throttled",
      checking.nextCheckMs,
      checking.deadlineMs,
    );
  if (!response.ok) throw new ConfirmationError("unavailable");
  return { response, checking };
}
export async function readConfirmation(attemptId: string, signal: AbortSignal) {
  const { response, checking } = await protectedRead(
    attemptId,
    "confirmation",
    signal,
  );
  return { ...decisionSchema.parse(await response.json()), checking };
}
export const protectedCheckoutService: ProtectedCheckoutService = {
  async context({ attemptId, mode, signal }) {
    const { response } = await protectedRead(attemptId, "checkout", signal);
    const context = contextSchema.parse(await response.json());
    if (context.attemptId !== attemptId || context.mode !== mode)
      throw new ConfirmationError("unavailable");
    if (context.checkout.state === "available") {
      if (
        mode === "synthetic"
          ? context.checkout.url !== `/__experiment/checkout/${attemptId}`
          : !isNativeCheckoutUrl(context.checkout.url) ||
            context.checkout.expiresAtMs === undefined ||
            context.checkout.expiresAtMs <= Date.now() ||
            context.checkout.expiresAtMs > context.checking.deadlineMs
      )
        throw new ConfirmationError("unavailable");
    }
    return context;
  },
};

export async function startSyntheticCheckout(
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch("/__experiment/attempts", {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new ConfirmationError("unavailable");
  return z.strictObject({ attemptId: idSchema }).parse(await response.json())
    .attemptId;
}
