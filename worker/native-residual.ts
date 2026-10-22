import { nativeValidationReason } from "./provider-normalization";
import { z } from "zod";
import { ApiError, policy } from "./policy";
import {
  compensateNativeAttempt,
  inspectNativeAttempt,
  type NativeScope,
  type NativeExchange,
} from "./native-adapter";

// This is installed operator authority, never a customer request parameter.
export const residualSchema = z
  .strictObject({
    mode: z.literal("inspect").optional(),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    expectedBookingIds: z
      .array(z.string().regex(/^[1-9][0-9]*$/))
      .min(1)
      .max(2),
  })
  .refine(
    (value) =>
      new Set(value.expectedBookingIds).size ===
        value.expectedBookingIds.length &&
      (value.mode !== "inspect" || value.expectedBookingIds.length === 1),
  );
export type ResidualAuthority = z.infer<typeof residualSchema>;

/** Classify native failures without exposing arbitrary provider details. */
export function safeNativeFailure(error: unknown) {
  return error instanceof ApiError && /^[a-z][a-z0-9_]{0,100}$/.test(error.code)
    ? error.code
    : error instanceof z.ZodError
      ? "provider_schema_invalid"
      : "internal_error";
}

/** Validate the retained scope for inspecting or compensating residual effects. */
export async function residualGrant(
  env: Env,
  scope: {
    attemptId: string;
    invocationId: string;
    expiresMs: number;
    startingUsed: number;
    maximumUsed: number;
    useRecoveryReserve?: boolean;
    residual: ResidualAuthority;
  },
) {
  const p = policy(env),
    now = Date.now();
  residualSchema.parse(scope.residual);
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT result_json,expires_ms FROM developer_operations WHERE capability_hash=? AND operation='native_recovery_window' AND state='running' AND expires_ms>?",
    )
    .bind(scope.invocationId, now)
    .first<{ result_json: string; expires_ms: number }>();
  const stored = row ? JSON.parse(row.result_json) : null;
  if (
    !row ||
    row.expires_ms !== scope.expiresMs ||
    now >= p.CAMPAIGN_END_MS ||
    p.PROVIDER_ACCESS !== "trusted-reads" ||
    scope.residual.sourceRevision !== p.SOURCE_REVISION ||
    stored.attemptId !== scope.attemptId ||
    stored.startingUsed !== scope.startingUsed ||
    stored.maximumUsed !== scope.maximumUsed ||
    stored.useRecoveryReserve !== scope.useRecoveryReserve ||
    stored.notBeforeMs > now ||
    JSON.stringify(stored.residual) !== JSON.stringify(scope.residual)
  )
    throw new ApiError(409, "native_residual_grant_unavailable");
}

/** Handle residual booking effects within the explicitly authorized scope. */
export async function recoverNativeResidual(options: {
  db: D1Database;
  scope: NativeScope;
  exchange: NativeExchange;
  signingSecret: string;
  expiresMs: number;
  authority: ResidualAuthority;
  assertGranted: () => Promise<void>;
  invalidate: () => void;
}) {
  let operation: Parameters<NativeExchange>[0]["kind"] | undefined;
  let representation:
    { kind: string; count?: number; invoiceReference?: string } | undefined;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(0, Math.min(15000, options.expiresMs - Date.now())),
  );
  try {
    const exchange: NativeExchange = async (request, signal) => {
      operation = request.kind;
      representation = undefined;
      if (
        (options.authority.mode === "inspect" &&
          request.kind !== "booking-read") ||
        !["booking-read", "invoice-read", "booking-cancel"].includes(
          request.kind,
        )
      )
        throw new ApiError(503, "native_residual_operation_unavailable");
      const response = await options.exchange(request, signal);
      const body = response.body;
      representation =
        body === null
          ? { kind: "null" }
          : Array.isArray(body)
            ? { kind: "array", count: body.length }
            : typeof body === "object"
              ? {
                  kind: "object",
                  count: Object.keys(body).length,
                  ...(request.kind === "booking-read"
                    ? {
                        invoiceReference:
                          Reflect.get(body, "invoice_id") == null
                            ? "missing"
                            : "present",
                      }
                    : {}),
                }
              : { kind: "primitive" };
      return response;
    };
    const result =
      options.authority.mode === "inspect"
        ? await inspectNativeAttempt({
            ...options,
            exchange,
            signal: controller.signal,
            expectedBookingIds: options.authority.expectedBookingIds,
          })
        : await compensateNativeAttempt({
            ...options,
            exchange,
            signal: controller.signal,
            operatorRecovery: {
              expiresMs: options.expiresMs,
              expectedBookingIds: options.authority.expectedBookingIds,
            },
          });
    return { ...result, operation, representation };
  } catch (error) {
    return {
      state: "recovery_required",
      diagnostic: {
        code: safeNativeFailure(error),
        validation: nativeValidationReason(error),
        operation,
        representation,
      },
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
