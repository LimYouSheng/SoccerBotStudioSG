import { z } from "zod";
import { ApiError } from "./policy";
import { verifyBindings } from "./bindings";
import {
  assertPaymentScope,
  hitpayId,
  hitpayRecoveryEnabled,
  hitpaySetting,
  paymentScopeSchema,
} from "./hitpay-contract";

const maximumBytes = 32768;
async function rawBody(request: Request) {
  if (!request.body) throw new ApiError(400, "hitpay_body_required");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError(408, "hitpay_body_timeout"));
      void reader.cancel().catch(() => {});
    }, 5000);
  });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await Promise.race([reader.read(), expired]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) throw new ApiError(413, "hitpay_body_too_large");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
// Separate event-webhook contract. No legacy payload HMAC, timestamp assumption,
// or trusted payment status. Authenticated identity only schedules a server read.
export async function receiveHitpayWebhook(request: Request, env: Env) {
  if (request.method !== "POST")
    throw new ApiError(405, "operation_unavailable");
  if (
    !hitpayRecoveryEnabled(env) ||
    hitpaySetting(env, "HITPAY_WEBHOOK") !== "enabled"
  )
    throw new ApiError(503, "hitpay_webhook_disabled");
  const salt = hitpaySetting(env, "HITPAY_WEBHOOK_SALT");
  if (!salt || salt.length > 8192)
    throw new ApiError(503, "hitpay_webhook_disabled");
  const signature = request.headers.get("Hitpay-Signature") || "";
  if (!/^[a-fA-F0-9]{64}$/.test(signature))
    throw new ApiError(401, "hitpay_signature_invalid");
  if (
    (request.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase() !== "application/json"
  )
    throw new ApiError(415, "hitpay_content_type_invalid");
  const bytes = await rawBody(request);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = Uint8Array.from(signature.match(/../g)!, (part) =>
    parseInt(part, 16),
  );
  if (!(await crypto.subtle.verify("HMAC", key, signatureBytes, bytes)))
    throw new ApiError(401, "hitpay_signature_invalid");
  let raw: unknown;
  try {
    raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw new ApiError(400, "hitpay_event_invalid");
  }
  const parsed = z
    .object({
      id: hitpayId,
      reference_number: z.string().min(1).max(128).optional(),
    })
    .safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "hitpay_event_invalid");
  await verifyBindings(env);
  const event = parsed.data;
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT attempt_id,scope_json,reference,request_id FROM hitpay_payments WHERE request_id=? OR (request_id IS NULL AND reference=?) LIMIT 2",
    )
    .bind(event.id, event.reference_number ?? "")
    .all<{
      attempt_id: string;
      scope_json: string;
      reference: string;
      request_id: string | null;
    }>();
  if (row.results.length !== 1)
    throw new ApiError(404, "hitpay_request_unknown");
  const payment = row.results[0];
  if (
    event.reference_number !== undefined &&
    event.reference_number !== payment.reference
  )
    throw new ApiError(409, "hitpay_event_mismatch");
  await assertPaymentScope(
    env,
    paymentScopeSchema.parse(JSON.parse(payment.scope_json)),
  );
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const now = Date.now();
  // Both statements commit together. Duplicate receipts never extend recovery,
  // reset a lease/retry count, replace paid evidence or store customer payloads.
  await env.STATE.batch([
    env.STATE.prepare(
      "INSERT INTO hitpay_receipts(digest,attempt_id,received_ms) VALUES(?,?,?) ON CONFLICT(digest) DO NOTHING",
    ).bind(digest, payment.attempt_id, now),
    env.STATE.prepare(
      "UPDATE hitpay_payments SET ready_ms=MIN(ready_ms,?) WHERE attempt_id=? AND state='due' AND EXISTS(SELECT 1 FROM hitpay_receipts WHERE digest=? AND attempt_id=?)",
    ).bind(now, payment.attempt_id, digest, payment.attempt_id),
  ]);
  return { received: true };
}
