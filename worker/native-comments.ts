import { z } from "zod";
import { ApiError, digest, liveCustomerAccess, policy } from "./policy";
import { associationSchema, intentSchema } from "./journal";
import { nativeBookingComment } from "./prebooking";
import { providerSecrets } from "./provider-transport";
import type { ProviderSession, ProviderControl } from "./provider-session";

// Durable annotation intent is saved before association. Dispatch is claimed
// separately after checkout, under the same account admission limits. A missing
// response remains unknown; neither cron nor another request resends it.
/** Annotate eligible pending bookings using retained effect accounting. */
export async function annotatePendingBooking(
  env: Env,
  provider: ProviderSession,
  control: ProviderControl,
  attemptId?: string,
) {
  if (!liveCustomerAccess(env)) return;
  if (attemptId !== undefined) z.string().uuid().parse(attemptId);
  const row = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT a.id,a.intent_json,a.intent_hash,a.association_json,e.reference_id,g.contract_json FROM session_effects e JOIN attempts a ON a.id=e.attempt_id JOIN native_checkout_grants g ON g.attempt_id=a.id JOIN checkout_payment_routes p ON p.attempt_id=a.id JOIN guest_access x ON x.capability_hash=g.capability_hash AND x.owner_id=a.owner_id WHERE e.step='native-comments-pending' AND e.outcome='observed' AND a.association_json IS NOT NULL AND g.ongoing=1 AND g.state IN ('complete','blocked') AND g.expires_ms>? AND p.route='hitpay' AND x.revoked_ms IS NULL AND x.expires_ms>? AND (? IS NULL OR a.id=?) AND EXISTS(SELECT 1 FROM json_each(e.reference_id) j WHERE NOT EXISTS(SELECT 1 FROM session_effects c WHERE c.attempt_id=a.id AND c.step='native-comment:'||j.key)) ORDER BY a.created_ms,a.id LIMIT 1",
    )
    .bind(Date.now(), Date.now(), attemptId ?? null, attemptId ?? null)
    .first<{
      id: string;
      intent_json: string;
      intent_hash: string;
      association_json: string;
      reference_id: string;
      contract_json: string;
    }>();
  if (!row) return;
  const intent = intentSchema.parse(JSON.parse(row.intent_json));
  const association = associationSchema.parse(JSON.parse(row.association_json));
  const ids = z
    .array(z.string())
    .min(1)
    .max(12)
    .parse(JSON.parse(row.reference_id));
  const contract = z
    .object({ companyLogin: z.string() })
    .parse(JSON.parse(row.contract_json));
  if (
    intent.accountId !== env.DEPLOYMENT_ACCOUNT_ID ||
    intent.environmentId !== env.ENVIRONMENT ||
    contract.companyLogin !== providerSecrets(env).company ||
    (await digest(row.intent_json)) !== row.intent_hash ||
    ids.length !== intent.sessions.length ||
    JSON.stringify(ids) !== JSON.stringify(association.bookingIds)
  )
    throw new ApiError(409, "native_comment_scope_mismatch");
  for (const [index, bookingId] of ids.entries()) {
    const step = `native-comment:${index}`;
    const assertCurrent = async () => {
      if (
        !liveCustomerAccess(env) ||
        policy(env).PROVIDER_ACCESS !== "trusted-reads"
      )
        throw new ApiError(503, "provider_access_disabled");
      const current = await env.STATE.withSession("first-primary")
        .prepare(
          "SELECT 1 FROM attempts a JOIN native_checkout_grants g ON g.attempt_id=a.id JOIN guest_access x ON x.capability_hash=g.capability_hash AND x.owner_id=a.owner_id WHERE a.id=? AND a.intent_hash=? AND a.association_json=? AND g.ongoing=1 AND g.state IN ('complete','blocked') AND g.expires_ms>? AND x.revoked_ms IS NULL AND x.expires_ms>?",
        )
        .bind(
          row.id,
          row.intent_hash,
          row.association_json,
          Date.now(),
          Date.now(),
        )
        .first();
      if (!current) throw new ApiError(409, "native_comment_fence_lost");
    };
    await assertCurrent();
    const claimed = await env.STATE.prepare(
      "INSERT OR IGNORE INTO session_effects(attempt_id,step,outcome,reference_id) SELECT id,?,'unknown',? FROM attempts WHERE id=? AND intent_hash=? AND association_json=?",
    )
      .bind(step, bookingId, row.id, row.intent_hash, row.association_json)
      .run();
    if (claimed.meta.changes !== 1) continue;
    try {
      const comment = nativeBookingComment(intent, index);
      const response = await provider.nativeWrite(
        env,
        control,
        { kind: "booking-comment", bookingId, comment },
        assertCurrent,
      );
      if (
        z.object({ comment: z.literal(comment) }).safeParse(response.body)
          .success
      )
        await env.STATE.prepare(
          "UPDATE session_effects SET outcome='observed' WHERE attempt_id=? AND step=? AND outcome='unknown' AND reference_id=?",
        )
          .bind(row.id, step, bookingId)
          .run();
    } catch {
      // Preserve unknown annotation; payment/booking truth is unaffected.
    }
  }
}
