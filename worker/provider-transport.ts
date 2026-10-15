import {
  webhookEvent,
  webhookPath,
  type WebhookEvent,
} from "./webhook-contract";
import { z } from "zod";
import { providerId } from "./provider-normalization";
import { measure } from "./diagnostics";
import { ApiError } from "./policy";

// Fixed identity endpoints share the physical transport owner. Their durable
// admission is owned by identity-delivery, separately from SimplyBook accounting.
export async function identityRequest(
  kind: "bot" | "email",
  secret: string,
  payload: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  const url =
    kind === "bot"
      ? "https://challenges.cloudflare.com/turnstile/v0/siteverify"
      : "https://api.resend.com/emails";
  const body =
    kind === "bot"
      ? JSON.stringify({
          secret,
          response: z.string().min(1).max(2048).parse(payload.token),
        })
      : JSON.stringify({
          from: z
            .literal("SoccerBotStudioSG Dev <noreply@auth.app404.ai>")
            .parse(payload.sender),
          to: [z.email().max(254).parse(payload.recipient)],
          subject: "Your SoccerBotStudioSG Dev verification code",
          text: `Your verification code is ${z
            .string()
            .regex(/^\d{6}$/)
            .parse(
              payload.code,
            )}. It expires within 10 minutes. If you did not request this, ignore this email.`,
        });
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(kind === "email"
        ? {
            Authorization: `Bearer ${secret}`,
            "Idempotency-Key": z
              .string()
              .regex(/^verification\/[a-f0-9-]{36}$/)
              .parse(payload.idempotencyKey),
          }
        : {}),
    },
    body,
  });
  if (
    !response.ok ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json") ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new ApiError(503, "identity_transport_unknown");
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let size = 0,
    text = "";
  try {
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) throw new ApiError(503, "identity_transport_unknown");
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export type ProviderFamily = "public" | "admin";
export type ProviderOperation =
  | "public-auth"
  | "admin-auth"
  | "identity"
  | "tariff"
  | "historical-booking"
  | "historical-invoice"
  | "native";
// Retained request-builder shape, not a raw HTTP capture. Bounds are local policy.
const contactText = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value && !/[\x00-\x1f\x7f]/.test(value));
export const nativeClientSchema = z
  .object({
    name: contactText,
    email: contactText.pipe(z.email()),
    phone: contactText,
    client_id: z
      .string()
      .regex(/^[1-9]\d{0,14}$/)
      .optional(),
    client_sign: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.client_id === undefined) === (value.client_sign === undefined),
  );
// Invoice handling is a control, not a discovered custom intake answer.
export const nativeAdditionalSchema = z
  .object({ handle_invoice: z.literal(true) })
  .strict();
export function nativeBookFields(client: unknown, additional: unknown) {
  const a = nativeClientSchema.safeParse(client);
  const b = nativeAdditionalSchema.safeParse(additional);
  if (!a.success || !b.success)
    throw new ApiError(503, "native_request_fields_invalid");
  return { client: a.data, additional: b.data };
}
export type NativeExchange = (
  request: NativeRequest,
  signal?: AbortSignal,
) => Promise<{ body: unknown; receivedAtMs: number }>;
export type NativeRequest =
  | { kind: "webhook-subscriptions" }
  | { kind: "webhook-create"; origin: string; event: WebhookEvent }
  | { kind: "webhook-delete"; subscriptionId: string }
  | {
      kind: "working-hours";
      from: string;
      to: string;
      serviceId: string | null;
      instructorId: string | null;
    }
  | {
      kind: "availability-range";
      serviceId: string;
      instructorId: string;
      from: string;
      to: string;
    }
  | { kind: "batch-create" }
  | { kind: "batch-close"; batchId: string; signature: string }
  | { kind: "catalogue-services" }
  | { kind: "catalogue-instructors" }
  | {
      kind: "eligible-instructors";
      serviceId: string;
      date: string;
      time: string;
    }
  | { kind: "required-fields"; serviceId: string }
  | {
      kind: "availability";
      serviceId: string;
      instructorId: string;
      date: string;
    }
  | {
      kind: "book";
      serviceId: string;
      instructorId: string;
      date: string;
      time: string;
      client: z.infer<typeof nativeClientSchema>;
      additional: z.infer<typeof nativeAdditionalSchema>;
      batchId?: string;
    }
  | { kind: "booking-read"; bookingId: string; signature: string }
  | {
      kind: "booking-cancel";
      bookingId: string;
      signature: string;
      evidenceObservedAtMs: number;
    }
  | { kind: "invoice-read"; invoiceId: string }
  | { kind: "payment-link"; invoiceId: string };
export type ProviderSecrets = {
  company: string;
  login: string;
  publicKey: string;
  adminKey: string;
};
export function providerSecrets(env: Env): ProviderSecrets {
  const read = (name: string) => {
    const value: unknown = Reflect.get(env, name);
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value !== value.trim() ||
      /[\r\n]/.test(value)
    )
      throw new ApiError(503, "provider_credentials_missing");
    return value;
  };
  return {
    company: read("SIMPLYBOOK_DEV_COMPANY_LOGIN"),
    login: read("SIMPLYBOOK_DEV_ADMIN_LOGIN"),
    publicKey: read("SIMPLYBOOK_DEV_API_KEY"),
    adminKey: read("SIMPLYBOOK_DEV_ADMIN_API_USER_KEY"),
  };
}

// Only this module owns physical dispatch. No caller-supplied URL or RPC method.
export async function providerRequest(
  operation: ProviderOperation,
  secrets: ProviderSecrets,
  token: string | undefined,
  dispatch: {
    reserve: () => Promise<string>;
    finish: (
      id: string,
      cooldown: number,
      reason?: "read_transport_ended",
    ) => void;
  },
  native?: NativeRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  // Explicit operation semantics, never HTTP method: payment-link GET can mutate.
  const readOnly =
    [
      "public-auth",
      "admin-auth",
      "identity",
      "tariff",
      "historical-booking",
      "historical-invoice",
    ].includes(operation) ||
    (native !== undefined &&
      [
        "webhook-subscriptions",
        "working-hours",
        "availability-range",
        "catalogue-services",
        "catalogue-instructors",
        "eligible-instructors",
        "required-fields",
        "availability",
        "booking-read",
        "invoice-read",
      ].includes(native.kind));
  const rpcId = crypto.randomUUID();
  let url: string, method: string, body: string | undefined;
  let rpc = operation === "public-auth";
  switch (operation) {
    case "public-auth":
      url = "https://user-api.simplybook.me/login";
      method = "POST";
      body = JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: "getToken",
        params: [secrets.company, secrets.publicKey],
      });
      break;
    case "admin-auth":
      url = "https://user-api-v2.simplybook.me/admin/auth";
      method = "POST";
      body = JSON.stringify({
        company: secrets.company,
        login: secrets.login,
        password: secrets.adminKey,
      });
      break;
    case "identity":
      url = "https://user-api-v2.simplybook.me/admin/company/info";
      method = "GET";
      break;
    case "tariff":
      url = "https://user-api-v2.simplybook.me/admin/tariff/current";
      method = "GET";
      break;
    case "historical-booking":
      url = "https://user-api-v2.simplybook.me/admin/bookings/23";
      method = "GET";
      break;
    case "historical-invoice":
      url = "https://user-api-v2.simplybook.me/admin/invoices/23";
      method = "GET";
      break;
    case "native": {
      if (!native) throw new ApiError(503, "provider_operation_unavailable");
      if (native.kind === "webhook-create") {
        const origin = z
          .literal("https://soccerbot-dev.limyousheng-94.workers.dev")
          .parse(native.origin);
        url = "https://user-api-v2.simplybook.me/admin/webhooks";
        method = "POST";
        body = JSON.stringify({
          url: origin + webhookPath(webhookEvent.parse(native.event)),
          event: native.event,
        });
        break;
      }
      if (native.kind === "webhook-delete") {
        url =
          "https://user-api-v2.simplybook.me/admin/webhooks/" +
          providerId(native.subscriptionId);
        method = "DELETE";
        break;
      }
      if (native.kind === "webhook-subscriptions") {
        url = "https://user-api-v2.simplybook.me/admin/webhooks";
        method = "GET";
        break;
      }
      if (native.kind === "invoice-read" || native.kind === "payment-link") {
        const invoiceId = providerId(native.invoiceId);
        url =
          "https://user-api-v2.simplybook.me/admin/invoices/" +
          invoiceId +
          (native.kind === "payment-link" ? "/payment-link" : "");
        method = "GET";
        break;
      }
      url = "https://user-api.simplybook.me/";
      method = "POST";
      rpc = true;
      let rpcMethod: string, params: unknown[];
      if (native.kind === "batch-create") {
        rpcMethod = "createBatch";
        params = [];
      } else if (native.kind === "batch-close") {
        if (!/^[a-f0-9]{32}$/.test(native.signature))
          throw new ApiError(503, "provider_signature_invalid");
        rpcMethod = "closeBatch";
        params = [
          Number(providerId(native.batchId)),
          "batch_multiple_booking",
          native.signature,
        ];
      } else if (
        native.kind === "availability-range" ||
        native.kind === "working-hours"
      ) {
        const from = Date.parse(native.from + "T00:00:00+08:00");
        const to = Date.parse(native.to + "T00:00:00+08:00");
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(native.from) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(native.to) ||
          !Number.isFinite(from) ||
          !Number.isFinite(to) ||
          to < from ||
          to - from > 14 * 86400000
        )
          throw new ApiError(503, "provider_date_invalid");
        rpcMethod =
          native.kind === "working-hours"
            ? "getWorkDaysInfo"
            : "getStartTimeMatrix";
        const service =
          native.serviceId === null
            ? null
            : Number(providerId(native.serviceId));
        const instructor =
          native.instructorId === null
            ? null
            : Number(providerId(native.instructorId));
        params =
          native.kind === "working-hours"
            ? [native.from, native.to, instructor, service, 1]
            : [native.from, native.to, service, instructor, 1];
      } else if (
        native.kind === "catalogue-services" ||
        native.kind === "catalogue-instructors"
      ) {
        rpcMethod =
          native.kind === "catalogue-services" ? "getEventList" : "getUnitList";
        params = [true, false];
      } else if (native.kind === "eligible-instructors") {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(native.date) ||
          !/^([01]\d|2[0-3]):[0-5]\d:00$/.test(native.time)
        )
          throw new ApiError(503, "provider_date_invalid");
        rpcMethod = "getAvailableUnits";
        params = [
          Number(providerId(native.serviceId)),
          `${native.date} ${native.time}`,
          1,
        ];
      } else if (
        native.kind === "booking-read" ||
        native.kind === "booking-cancel"
      ) {
        if (!/^[a-f0-9]{32}$/.test(native.signature))
          throw new ApiError(503, "provider_signature_invalid");
        rpcMethod =
          native.kind === "booking-read"
            ? "getBookingDetails"
            : "cancelBooking";
        params = [
          native.kind === "booking-cancel"
            ? Number(providerId(native.bookingId))
            : providerId(native.bookingId),
          native.signature,
        ];
      } else {
        const service = Number(providerId(native.serviceId));
        if (native.kind === "required-fields") {
          rpcMethod = "getAdditionalFields";
          params = [service];
        } else {
          const provider = Number(providerId(native.instructorId));
          if (!/^\d{4}-\d{2}-\d{2}$/.test(native.date))
            throw new ApiError(503, "provider_date_invalid");
          if (native.kind === "availability") {
            rpcMethod = "getStartTimeMatrix";
            params = [native.date, native.date, service, provider, 1];
          } else {
            if (!/^([01]\d|2[0-3]):[0-5]\d:00$/.test(native.time))
              throw new ApiError(503, "provider_time_invalid");
            const fields = nativeBookFields(native.client, native.additional);
            rpcMethod = "book";
            params = [
              service,
              provider,
              native.date,
              native.time,
              fields.client,
              fields.additional,
              1,
              native.batchId === undefined
                ? null
                : Number(providerId(native.batchId)),
              null,
            ];
          }
        }
      }
      body = JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: rpcMethod,
        params,
      });
      break;
    }
    default:
      throw new ApiError(503, "provider_operation_unavailable");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (operation !== "public-auth" && operation !== "admin-auth") {
    if (!token) throw new ApiError(503, "provider_auth_required");
    headers["X-Company-Login"] = secrets.company;
    headers["X-Token"] = token;
  }
  signal?.throwIfAborted();
  const id = await dispatch.reserve();
  // Reservation precedes dispatch; uncertain writes keep their slot held.
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), 15000);
  let complete = false;
  let cooldown = 0;
  return await measure("provider", async () => {
    try {
      if (
        native?.kind === "booking-cancel" &&
        (!Number.isSafeInteger(native.evidenceObservedAtMs) ||
          native.evidenceObservedAtMs > Date.now() ||
          Date.now() - native.evidenceObservedAtMs > 15000)
      ) {
        complete = true;
        throw new ApiError(503, "native_cleanup_evidence_expired");
      }
      const response = await fetch(url, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        complete = true;
        cooldown = 60000;
        throw new ApiError(503, "provider_redirect_denied");
      }
      if (!response.ok) {
        await response.body?.cancel();
        complete = true;
        cooldown = 60000;
        throw new ApiError(
          503,
          response.status === 401 || response.status === 403
            ? "provider_auth_failed"
            : "provider_http_failed",
        );
      }
      if (native?.kind === "webhook-delete") {
        // DELETE's body has no documented representation. HTTP acknowledgement
        // only permits the lifecycle owner to verify a fresh exact baseline;
        // it is never proof of removal. Do not buffer or interpret this body.
        const contentType = response.headers.get("content-type");
        const acknowledgement = {
          httpStatus: response.status,
          contentType:
            contentType === null
              ? "absent"
              : contentType.toLowerCase().includes("application/json")
                ? "json"
                : "other",
          bodyPresent: response.body !== null,
        };
        await response.body?.cancel();
        complete = true;
        return acknowledgement;
      }
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .includes("application/json")
      ) {
        await response.body?.cancel();
        complete = true;
        cooldown = 60000;
        throw new ApiError(503, "provider_representation_unknown");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError(503, "provider_representation_unknown");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 131072) {
            await reader.cancel();
            complete = true;
            throw new ApiError(503, "provider_response_too_large");
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      complete = true;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
          bytes,
        ),
      );
      if (rpc) {
        if (
          !value ||
          typeof value !== "object" ||
          !("id" in value) ||
          value.id !== rpcId ||
          !("result" in value) ||
          ("error" in value && value.error !== null)
        )
          throw new ApiError(503, "provider_rpc_failed");
        return value.result;
      }
      return value;
    } catch (error) {
      cooldown = 60000;
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        complete
          ? "provider_representation_unknown"
          : "provider_transport_uncertain",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (complete || readOnly)
        dispatch.finish(
          id,
          cooldown,
          complete ? undefined : "read_transport_ended",
        );
    }
  });
}
