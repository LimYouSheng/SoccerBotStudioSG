import { z } from "zod";
import { ApiError, policy } from "./policy";
import { decideStoredConfirmation, type StoredAttempt } from "./confirmation";

const instant = z
  .number()
  .int()
  .nonnegative()
  .max(8_640_000_000_000_000 - 3600000);
const owner = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const limitSchema = z.number().int().min(1).max(10);
const leaseMs = 30000;
const maxReads = 5;
export type RecoveryClaim = {
  attempt_id: string;
  claimant: string;
  generation: number;
  attempt_version: number;
  tries: number;
  ready_ms: number;
};
const completionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("observation"), observation: z.unknown() }),
  z.strictObject({ kind: z.literal("retry") }),
  z.strictObject({ kind: z.literal("unsupported") }),
]);
type RecoveryInput = StoredAttempt & {
  owner_id: string;
  effects: { step: string; outcome: string; reference_id: string | null }[];
};
// No live implementation exists. The only supplied adapter is an isolated test
// fixture. Reconciliation is a read; this interface has no booking/payment write.
export type RecoveryReader = {
  mode: "synthetic" | "live" | "unavailable";
  read: (input: RecoveryInput, signal: AbortSignal) => Promise<unknown>;
};

export async function claimRecovery(
  db: D1Database,
  id: string,
  claimant: string,
  now: number,
) {
  owner.parse(claimant);
  instant.parse(now);
  const result = await db.batch([
    db
      .prepare(
        "UPDATE recovery_work SET state='claimed',claimant=?,generation=generation+1,tries=tries+1,ready_ms=?,updated_ms=?,attempt_version=(SELECT version+1 FROM attempts WHERE id=attempt_id) WHERE attempt_id=? AND state IN ('due','claimed') AND ready_ms<=? AND EXISTS (SELECT 1 FROM attempts WHERE id=attempt_id AND state IN ('dispatching','observed','recovery_required')) RETURNING *",
      )
      .bind(claimant, now + leaseMs, now, id, now),
    db
      .prepare(
        "UPDATE attempts SET version=version+1,state='recovery_required' WHERE id=? AND changes()=1",
      )
      .bind(id),
  ]);
  return result[0].results[0] as RecoveryClaim | undefined;
}

async function claimedAttempt(
  db: D1Database,
  claim: RecoveryClaim,
  now: number,
) {
  const row = await db
    .withSession("first-primary")
    .prepare(
      "SELECT a.id,a.owner_id,a.created_ms,a.deadline_ms,a.state,a.intent_json,a.association_json,a.observation_json,a.observation_ms,r.tries AS recovery_tries,r.ready_ms AS recovery_lease_ms FROM attempts a JOIN recovery_work r ON r.attempt_id=a.id WHERE a.id=? AND a.version=? AND r.attempt_version=a.version AND r.state='claimed' AND r.claimant=? AND r.generation=? AND r.ready_ms>?",
    )
    .bind(
      claim.attempt_id,
      claim.attempt_version,
      claim.claimant,
      claim.generation,
      now,
    )
    .first<
      StoredAttempt & {
        owner_id: string;
        observation_ms: number | null;
        recovery_tries: number;
        recovery_lease_ms: number;
      }
    >();
  if (!row) throw new ApiError(409, "stale_recovery_claim");
  return row;
}
function decision(
  env: Env,
  row: StoredAttempt & { owner_id: string },
  claim: RecoveryClaim,
  now: number,
) {
  // This assertion is internal, scoped to the acquired claim and never stored
  // as customer access. It cannot renew or bypass an expired customer cookie.
  try {
    return decideStoredConfirmation(
      row,
      {
        owner_id: row.owner_id,
        capability_hash: "internal-recovery-claim",
        issued_ms: now,
        expires_ms: claim.ready_ms,
      },
      now,
      policy(env),
    );
  } catch {
    return { status: "unresolved", reason: "invalid_input" };
  }
}

export async function completeRecovery(
  env: Env,
  claim: RecoveryClaim,
  raw: unknown,
  clock: () => number = Date.now,
) {
  const now = instant.parse(clock());
  const result = completionSchema.parse(raw);
  const row = await claimedAttempt(env.STATE, claim, now);
  claim = {
    ...claim,
    tries: row.recovery_tries,
    ready_ms: row.recovery_lease_ms,
  };
  let state = "manual_review",
    reason = "reconciliation_unsupported";
  let observation: string | null = null;
  if (result.kind === "retry") {
    state = claim.tries < maxReads ? "due" : "manual_review";
    reason = claim.tries < maxReads ? "read_deferred" : "read_budget_exhausted";
  } else if (result.kind === "observation") {
    const json = JSON.stringify(result.observation);
    const timestamps = z
      .object({
        invoice: z.object({ observedAtMs: instant }),
        bookings: z.array(z.object({ observedAtMs: instant })).min(1),
      })
      .safeParse(result.observation);
    const monotonic =
      timestamps.success &&
      (row.observation_ms === null ||
        [timestamps.data.invoice, ...timestamps.data.bookings].every(
          (item) => item.observedAtMs >= row.observation_ms!,
        ));
    if (row.association_json && json && json.length <= 32768 && monotonic) {
      const verdict = decision(
        env,
        { ...row, observation_json: json },
        claim,
        now,
      );
      if (verdict.status === "confirmed" || verdict.status === "invalid") {
        state = "complete";
        reason = "verified_terminal";
        observation = json;
      } else if (verdict.status === "pending") {
        state = claim.tries < maxReads ? "due" : "manual_review";
        reason =
          claim.tries < maxReads
            ? "verification_pending"
            : "read_budget_exhausted";
        observation = json;
      } else reason = "evidence_unresolved";
    } else reason = "evidence_unresolved";
  }
  const commitNow = instant.parse(clock());
  const next =
    state === "due"
      ? commitNow + Math.min(300000, 5000 * 2 ** (claim.tries - 1))
      : commitNow;
  // Re-check ownership at COMMIT, not only before asynchronous validation.
  // D1 batch rollback preserves both owners if either statement fails.
  const committed = await env.STATE.batch([
    env.STATE.prepare(
      "UPDATE recovery_work SET state=?,reason=?,ready_ms=?,updated_ms=?,claimant=NULL WHERE attempt_id=? AND state='claimed' AND claimant=? AND generation=? AND attempt_version=? AND ready_ms>? AND EXISTS (SELECT 1 FROM attempts WHERE id=attempt_id AND version=?)",
    ).bind(
      state,
      reason,
      next,
      commitNow,
      claim.attempt_id,
      claim.claimant,
      claim.generation,
      claim.attempt_version,
      commitNow,
      claim.attempt_version,
    ),
    env.STATE.prepare(
      "UPDATE attempts SET version=version+1,state=CASE WHEN ? IS NOT NULL THEN 'observed' ELSE 'recovery_required' END,observation_json=COALESCE(?,observation_json),observation_ms=CASE WHEN ? IS NOT NULL THEN ? ELSE observation_ms END WHERE id=? AND version=? AND changes()=1",
    ).bind(
      observation,
      observation,
      observation,
      commitNow,
      claim.attempt_id,
      claim.attempt_version,
    ),
  ]);
  if (committed[0].meta.changes !== 1)
    throw new ApiError(409, "stale_recovery_claim");
  return { state, reason };
}

async function boundedRead(reader: RecoveryReader, input: RecoveryInput) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => reader.read(input, controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("recovery_read_deadline"));
        }, 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function runRecoveryBatch(
  env: Env,
  options: { claimant: string; limit: number; now?: () => number },
  reader?: RecoveryReader,
) {
  owner.parse(options.claimant);
  limitSchema.parse(options.limit);
  const clock = options.now ?? Date.now;
  const now = instant.parse(clock());
  // One indexed bounded selection per invocation; no draining loop or wake-up.
  const selected = await env.STATE.withSession("first-primary")
    .prepare(
      "SELECT attempt_id FROM recovery_work INDEXED BY recovery_due WHERE state IN ('due','claimed') AND ready_ms<=? ORDER BY ready_ms,attempt_id LIMIT ?",
    )
    .bind(now, options.limit)
    .all<{ attempt_id: string }>();
  const outcomes = [];
  for (const item of selected.results) {
    const claim = await claimRecovery(
      env.STATE,
      item.attempt_id,
      options.claimant,
      clock(),
    );
    if (!claim) continue;
    const row = await claimedAttempt(env.STATE, claim, clock());
    let result: unknown = { kind: "unsupported" };
    const existing = row.observation_json
      ? decision(env, row, claim, clock())
      : null;
    if (existing?.status === "confirmed" || existing?.status === "invalid") {
      result = {
        kind: "observation",
        observation: JSON.parse(row.observation_json!),
      };
    } else if (claim.tries > maxReads) {
      result = { kind: "retry" };
    } else if (reader?.mode === "synthetic") {
      const effects = await env.STATE.prepare(
        "SELECT step,outcome,reference_id FROM session_effects WHERE attempt_id=? ORDER BY step LIMIT 13",
      )
        .bind(item.attempt_id)
        .all<RecoveryInput["effects"][number]>();
      try {
        result = await boundedRead(reader, {
          ...row,
          effects: effects.results,
        });
      } catch {
        result = { kind: "retry" };
      }
    }
    // Live recovery contracts/admission are unavailable, even if a caller labels
    // a reader live or flips provider settings. No fallback to synthetic reads.
    try {
      completionSchema.parse(result);
    } catch {
      result = { kind: "unsupported" };
    }
    outcomes.push({
      attemptId: item.attempt_id,
      ...(await completeRecovery(env, claim, result, clock)),
    });
  }
  return outcomes;
}

export async function retentionPreview(
  db: D1Database,
  now: number,
  beforeMs: number,
  limit: number,
) {
  instant.parse(now);
  instant.parse(beforeMs);
  limitSchema.parse(limit);
  if (beforeMs > now) throw new ApiError(400, "invalid_retention_cutoff");
  const records = await db
    .withSession("first-primary")
    .prepare(
      "WITH candidates AS MATERIALIZED (SELECT owner_id,expires_ms,capability_hash FROM guest_access WHERE expires_ms<=? AND expires_ms<=? ORDER BY expires_ms,capability_hash LIMIT 100) SELECT owner_id,expires_ms FROM candidates g WHERE NOT EXISTS (SELECT 1 FROM attempts a WHERE a.owner_id=g.owner_id) ORDER BY expires_ms,capability_hash LIMIT ?",
    )
    .bind(now, beforeMs, limit)
    .all<{ owner_id: string; expires_ms: number }>();
  return {
    cleanupEnabled: false,
    candidateLimit: 100,
    expiredOrphanAccess: records.results,
    retained: [
      "attempts",
      "effects",
      "dispatches",
      "recovery",
      "operator_proofs",
      "coordinator_accounting",
    ],
    reason: "retention_decision_required",
  };
}
