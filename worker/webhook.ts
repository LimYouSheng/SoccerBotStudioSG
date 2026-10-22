import { webhookEvent, webhookRoute } from "./webhook-contract";
import { z } from "zod";
import { verifyBindings } from "./bindings";
import { ApiError } from "./policy";

const unavailable = () => new ApiError(503, "webhook_unavailable");
const windowSchema = z.strictObject({
  id: z.string().uuid(),
  subscription_event: webhookEvent,
  source_revision: z.string().regex(/^[a-f0-9]{40}$/),
  account_id: z.string(),
  company_login: z.string().min(1).max(128),
  environment: z.literal("developer"),
  origin: z.url(),
  opened_ms: z.number().int().nonnegative().safe(),
  expires_ms: z.number().int().positive().safe(),
  maximum_receipts: z.number().int().min(1).max(16),
  state: z.literal("open"),
});

// Exact bytes are needed for the documented HMAC, before UTF-8/JSON parsing.
/** Read a webhook body within the configured size and deadline limits. */
async function rawBody(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json" ||
    !request.body
  )
    throw new ApiError(400, "webhook_invalid");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let length = 0;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 16384) throw new ApiError(413, "webhook_invalid");
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return bytes;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ApiError(408, "webhook_invalid")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

// No payload values, booking hashes, contacts or raw bodies are retained.
// Bounded structure is evidence for a later, separately reviewed event mapper.
function shape(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value !== "object") return typeof value;
  if (depth === 2) return "object";
  const entries = Object.entries(value);
  return {
    type: "object",
    count: entries.length,
    fields: entries.slice(0, 32).map(([key, item]) => ({
      key: /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ? key : "redacted",
      value: shape(item, depth + 1),
    })),
  };
}

// Discovery ingress only. Unsupported event semantics never enqueue recovery,
// inspect protected attempts or dispatch provider requests. A receipt is not payment.
/** Authenticate and retain provider webhook evidence without claiming confirmation. */
export async function captureWebhook(
  request: Request,
  env: Env,
  clock = Date.now,
) {
  if (request.method !== "POST")
    throw new ApiError(405, "operation_unavailable");
  const event = webhookRoute(new URL(request.url).pathname);
  if (!event) throw unavailable();
  await verifyBindings(env);
  const db = env.STATE.withSession("first-primary");
  const parsedWindow = windowSchema.safeParse(
    await db
      .prepare(
        "SELECT w.*,COALESCE(s.event,'new_booking') AS subscription_event FROM webhook_capture_windows w LEFT JOIN webhook_event_scopes s ON s.window_id=w.id WHERE w.state='open' AND w.opened_ms<=? AND w.expires_ms>? AND COALESCE(s.event,'new_booking')=? ORDER BY w.opened_ms DESC LIMIT 1",
      )
      .bind(clock(), clock(), event)
      .first(),
  );
  if (!parsedWindow.success) throw unavailable();
  const window = parsedWindow.data;
  const company: unknown = Reflect.get(env, "SIMPLYBOOK_DEV_COMPANY_LOGIN");
  if (
    window.subscription_event !== event ||
    window.source_revision !== env.SOURCE_REVISION ||
    window.account_id !== env.DEPLOYMENT_ACCOUNT_ID ||
    typeof company !== "string" ||
    company.toLowerCase() === "soccerbotstudio" ||
    window.company_login !== company ||
    window.environment !== env.ENVIRONMENT ||
    window.origin !== env.APP_ORIGIN ||
    window.expires_ms - window.opened_ms > 1200000
  )
    throw unavailable();
  const secret: unknown = Reflect.get(env, "SIMPLYBOOK_DEV_SIGNING_SECRET");
  if (typeof secret !== "string" || secret.length < 16 || secret.length > 512)
    throw unavailable();
  const signature = request.headers.get("x-signature");
  if (!signature || !/^[a-fA-F0-9]{64}$/.test(signature))
    throw new ApiError(401, "webhook_unauthorized");
  const bytes = await rawBody(request);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const mac = Uint8Array.from(signature.match(/../g)!, (byte) =>
    parseInt(byte, 16),
  );
  if (!(await crypto.subtle.verify("HMAC", key, mac, bytes)))
    throw new ApiError(401, "webhook_unauthorized");
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw new ApiError(400, "webhook_invalid");
  }
  const envelope = z
    .object({
      signature_algo: z.literal("sha256"),
      webhook_timestamp: z.number().int().nonnegative().safe(),
    })
    .safeParse(payload);
  if (!envelope.success) throw new ApiError(400, "webhook_invalid");
  const now = clock(),
    sent = envelope.data.webhook_timestamp;
  // Explicit local policy, not a claim about the provider's retry schedule.
  if (sent * 1000 < now - 300000 || sent * 1000 > now + 30000)
    throw new ApiError(401, "webhook_stale");
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  // Atomic finite admission and exact-delivery dedup. Recheck closure at commit.
  const result = await db
    .prepare(
      "INSERT INTO webhook_receipts(window_id,body_digest,received_ms,sent_seconds,body_bytes,shape_json,state) SELECT id,?,?,?,?,?,'captured' FROM webhook_capture_windows WHERE id=? AND state='open' AND source_revision=? AND account_id=? AND company_login=? AND environment=? AND origin=? AND opened_ms<=? AND expires_ms>? AND COALESCE((SELECT event FROM webhook_event_scopes WHERE window_id=webhook_capture_windows.id),'new_booking')=? AND (SELECT count(*) FROM webhook_receipts WHERE window_id=?)<maximum_receipts ON CONFLICT(window_id,body_digest) DO NOTHING RETURNING body_digest",
    )
    .bind(
      digest,
      now,
      sent,
      bytes.byteLength,
      JSON.stringify(shape(payload)),
      window.id,
      env.SOURCE_REVISION,
      env.DEPLOYMENT_ACCOUNT_ID,
      company,
      env.ENVIRONMENT,
      env.APP_ORIGIN,
      now,
      now,
      event,
      window.id,
    )
    .first();
  if (!result) {
    const duplicate = await db
      .prepare(
        "SELECT r.body_digest FROM webhook_receipts r JOIN webhook_capture_windows w ON w.id=r.window_id WHERE r.window_id=? AND r.body_digest=? AND w.state='open' AND w.source_revision=? AND w.account_id=? AND w.company_login=? AND w.environment=? AND w.origin=? AND w.opened_ms<=? AND w.expires_ms>? AND COALESCE((SELECT event FROM webhook_event_scopes WHERE window_id=w.id),'new_booking')=?",
      )
      .bind(
        window.id,
        digest,
        env.SOURCE_REVISION,
        env.DEPLOYMENT_ACCOUNT_ID,
        company,
        env.ENVIRONMENT,
        env.APP_ORIGIN,
        clock(),
        clock(),
        event,
      )
      .first();
    if (!duplicate) throw unavailable();
  }
  return { received: true };
}
