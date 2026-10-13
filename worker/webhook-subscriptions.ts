import { z } from "zod";
import { ApiError, digest, policy } from "./policy";
import { providerSecrets } from "./provider-transport";
import { subscriptionSnapshot } from "./native-setup";
import type { ProviderSession, ProviderControl } from "./provider-session";

const denied = () => new ApiError(503, "webhook_subscription_unavailable");
const schema = z.object({
  window_id: z.string().uuid(),
  source_revision: z.string().regex(/^[a-f0-9]{40}$/),
  account_id: z.string(),
  company_login: z.string(),
  environment: z.literal("developer"),
  origin: z.literal("https://soccerbot-dev.limyousheng-94.workers.dev"),
  opened_ms: z.number().int().nonnegative().safe(),
  expires_ms: z.number().int().positive().safe(),
  window_state: z.enum(["open", "closed"]),
  starting_used: z.number().int().nonnegative().safe(),
  maximum_used: z.number().int().positive().safe(),
  calls_used: z.number().int().min(0).max(20),
  state: z.string(),
  baseline_json: z.string().nullable(),
  subscription_id: z.string().nullable(),
});
type Entry = Awaited<ReturnType<typeof subscriptionSnapshot>>[number];
const canonical = (entries: Entry[]) =>
  JSON.stringify([...entries].sort((a, b) => a.id.localeCompare(b.id)));

// Operator-only, one create and one delete. All physical traffic uses the same
// durable account budget. Unknown effects retain their phase and never replay.
export async function manageWebhookSubscription(
  env: Env,
  provider: ProviderSession,
  control: ProviderControl,
  accounting: () => { used: number; active: number },
  capabilityHash: string,
  action: "create" | "cleanup",
) {
  if (!/^[a-f0-9]{64}$/.test(capabilityHash)) throw denied();
  const db = env.STATE.withSession("first-primary");
  const read = async () => {
    const row = schema.safeParse(
      await db
        .prepare(
          `SELECT g.*,w.source_revision,w.account_id,w.company_login,w.environment,w.origin,w.opened_ms,w.expires_ms,w.state AS window_state FROM webhook_subscription_grants g JOIN webhook_capture_windows w ON w.id=g.window_id WHERE ${action === "create" ? "create_hash" : "cleanup_hash"}=?`,
        )
        .bind(capabilityHash)
        .first(),
    );
    if (!row.success) throw denied();
    const value = row.data,
      p = policy(env),
      now = Date.now();
    if (
      p.PROVIDER_ACCESS !== "trusted-reads" ||
      p.CAMPAIGN_END_MS <= now ||
      value.source_revision !== p.SOURCE_REVISION ||
      value.account_id !== p.DEPLOYMENT_ACCOUNT_ID ||
      value.company_login !== providerSecrets(env).company ||
      value.company_login.toLowerCase() === "soccerbotstudio" ||
      value.origin !== p.APP_ORIGIN ||
      value.opened_ms > now ||
      value.expires_ms <= now ||
      value.expires_ms > p.CAMPAIGN_END_MS ||
      value.expires_ms - value.opened_ms > 1200000 ||
      value.maximum_used > p.PROVIDER_CALL_CEILING - 16 ||
      value.maximum_used > value.starting_used + 80 ||
      value.maximum_used <= value.starting_used ||
      (action === "create" && value.window_state !== "open")
    )
      throw denied();
    return value;
  };
  const initial = await read();
  const used = accounting();
  if (
    (action === "create" &&
      (initial.state !== "granted" ||
        used.used !== initial.starting_used ||
        used.active !== 0)) ||
    (action === "cleanup" &&
      !["active", "create_unknown"].includes(initial.state))
  )
    throw denied();
  const claimed = await db
    .prepare(
      "UPDATE webhook_subscription_grants SET state=? WHERE window_id=? AND state=? RETURNING window_id",
    )
    .bind(
      action === "create" ? "inspecting" : "cleaning",
      initial.window_id,
      initial.state,
    )
    .first();
  if (!claimed) throw denied();
  let phase = action === "create" ? "inspecting" : "cleaning",
    last = Date.now();
  const assertGranted = async () => {
    const current = await read();
    if (
      current.state !== phase ||
      Date.now() + 15000 >= current.expires_ms ||
      accounting().used < current.starting_used ||
      accounting().used >= current.maximum_used
    )
      throw denied();
  };
  const bounded: ProviderControl = {
    ...control,
    reserve: async () => {
      const wait = Math.max(0, last + 300 - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      await assertGranted();
      // Reserve both operation-local and account-global budgets before fetch.
      const reserved = await db
        .prepare(
          "UPDATE webhook_subscription_grants SET calls_used=calls_used+1 WHERE window_id=? AND state=? AND calls_used<20 RETURNING calls_used",
        )
        .bind(initial.window_id, phase)
        .first();
      if (!reserved) throw denied();
      last = Date.now();
      return control.reserve();
    },
  };
  const move = async (
    next: string,
    extra = "",
    values: (string | null)[] = [],
  ) => {
    const changed = await db
      .prepare(
        `UPDATE webhook_subscription_grants SET state=?${extra} WHERE window_id=? AND state=? RETURNING window_id`,
      )
      .bind(next, ...values, initial.window_id, phase)
      .first();
    if (!changed) throw denied();
    phase = next;
  };
  let deleteAcknowledgement:
    | {
        httpStatus: number;
        contentType: "absent" | "json" | "other";
        bodyPresent: boolean;
      }
    | undefined;
  const list = async () => {
    await assertGranted();
    await provider.identity(env, bounded);
    return subscriptionSnapshot(
      (
        await provider.nativeRead(env, bounded, {
          kind: "webhook-subscriptions",
        })
      ).body,
    );
  };
  try {
    const destination = await digest(initial.origin + "/api/provider/webhook");
    const before = await list();
    if (before.some((entry) => !entry.active)) throw denied();
    if (action === "create") {
      if (
        before.some((entry) => entry.destinationSha256 === destination) ||
        before.filter((entry) => entry.event === "new_booking").length >= 5
      )
        throw denied();
      await move("creating", ",baseline_json=?", [canonical(before)]);
      await provider.nativeWrite(
        env,
        bounded,
        { kind: "webhook-create", origin: initial.origin },
        assertGranted,
      );
      const after = await list();
      const added = after.filter(
        (entry) => !before.some((old) => old.id === entry.id),
      );
      if (
        added.length !== 1 ||
        added[0].event !== "new_booking" ||
        !added[0].active ||
        added[0].destinationSha256 !== destination ||
        canonical(after.filter((entry) => entry.id !== added[0].id)) !==
          canonical(before)
      )
        throw denied();
      await move("active", ",subscription_id=?", [added[0].id]);
    } else {
      if (initial.baseline_json === null) throw denied();
      const baseline: unknown = JSON.parse(initial.baseline_json);
      // Reparse the stored projection with no provider/customer values.
      const entries = z
        .array(
          z.object({
            id: z.string().regex(/^[1-9]\d{0,14}$/),
            event: z.string(),
            active: z.boolean(),
            destinationSha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .max(64)
        .parse(baseline);
      const candidates = before.filter(
        (entry) => !entries.some((old) => old.id === entry.id),
      );
      if (
        candidates.length !== 1 ||
        candidates[0].event !== "new_booking" ||
        !candidates[0].active ||
        candidates[0].destinationSha256 !== destination ||
        (initial.subscription_id !== null &&
          candidates[0].id !== initial.subscription_id) ||
        canonical(before.filter((entry) => entry.id !== candidates[0].id)) !==
          initial.baseline_json
      )
        throw denied();
      await move("deleting", ",subscription_id=?", [candidates[0].id]);
      const acknowledgement = await provider.nativeWrite(
        env,
        bounded,
        { kind: "webhook-delete", subscriptionId: candidates[0].id },
        assertGranted,
      );
      deleteAcknowledgement = z
        .object({
          httpStatus: z.number().int().min(200).max(299),
          contentType: z.enum(["absent", "json", "other"]),
          bodyPresent: z.boolean(),
        })
        .strict()
        .parse(acknowledgement.body);
      const after = await list();
      if (canonical(after) !== initial.baseline_json) throw denied();
      await move("closed");
    }
    return {
      verified: true,
      state: phase,
      accounting: accounting(),
      ...(deleteAcknowledgement ? { deleteAcknowledgement } : {}),
    };
  } catch (error) {
    const next =
      phase === "creating"
        ? "create_unknown"
        : phase === "deleting"
          ? "delete_unknown"
          : "blocked";
    await move(next);
    return {
      verified: false,
      state: next,
      ...(deleteAcknowledgement ? { deleteAcknowledgement } : {}),
      reason:
        error instanceof ApiError
          ? error.code
          : "webhook_subscription_proof_incomplete",
      accounting: accounting(),
    };
  }
}
