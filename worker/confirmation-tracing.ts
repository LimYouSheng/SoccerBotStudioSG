import { AsyncLocalStorage } from "node:async_hooks";

const stages = [
  "queue",
  "claim",
  "hitpay",
  "payment_evidence",
  "booking_before",
  "accounting",
  "booking_after",
  "publish",
  "commit",
  "status",
  "context",
  "receipt",
] as const;
type Stage = (typeof stages)[number];
const labels = [
  "d1",
  "admission",
  "public_auth",
  "admin_auth",
  "identity",
  "tariff",
  "booking_read",
  "invoice_read",
  "accounting_write",
  "hitpay_read",
  "hitpay_search",
] as const;
type Label = (typeof labels)[number];
type Metric = { count: number; durationMs: number; errors: number };
type Trace = {
  correlationId: string;
  started: number;
  startedAtMs: number;
  changed: number;
  stage: Stage;
  closed: boolean;
  stages: Record<Stage, { durationMs: number; d1: Metric }>;
  operations: Record<Label, Metric>;
  caches: Record<string, number>;
  result: "pending" | "complete" | "manual_review" | "not_claimed";
};
const context = new AsyncLocalStorage<Trace>();
const fresh = (): Metric => ({ count: 0, durationMs: 0, errors: 0 });

// Join authorized HAR requests and background runs without logging attempt or
// provider IDs. No database, RPC, provider call or stored diagnostic record.
/** Hash attempt identity for sanitized confirmation correlation. */
export async function confirmationTraceKey(attemptId: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("confirmation:" + attemptId),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Initialize counters for one confirmation operation. */
export function createConfirmationTrace(correlationId: string): Trace {
  const now = performance.now();
  return {
    correlationId,
    started: now,
    startedAtMs: Date.now(),
    changed: now,
    stage: "queue",
    closed: false,
    result: "not_claimed",
    caches: {},
    stages: Object.fromEntries(
      stages.map((s) => [s, { durationMs: 0, d1: fresh() }]),
    ) as Trace["stages"],
    operations: Object.fromEntries(
      labels.map((s) => [s, fresh()]),
    ) as Trace["operations"],
  };
}
/** Select the current confirmation stage for timing attribution. */
export function confirmationStage(stage: Stage) {
  const trace = context.getStore();
  if (!trace || trace.closed) return;
  const now = performance.now();
  trace.stages[trace.stage].durationMs += Math.max(0, now - trace.changed);
  trace.changed = now;
  trace.stage = stage;
}
/** Run confirmation work within its asynchronous trace context. */
export function runConfirmationTrace<T>(
  trace: Trace,
  stage: Stage,
  operation: () => Promise<T>,
) {
  return context.run(trace, () => {
    confirmationStage(stage);
    return operation();
  });
}
/** Record the confirmation outcome for the active trace. */
export function confirmationResult(result: Trace["result"]) {
  const trace = context.getStore();
  if (trace && !trace.closed) trace.result = result;
}
/** Record confirmation cache usage without exposing cached data. */
export function confirmationCache(
  family: "public" | "admin" | "identity",
  state: "hit" | "miss" | "shared",
) {
  const trace = context.getStore();
  if (!trace || trace.closed) return;
  const key = `${family}_${state}`;
  trace.caches[key] = (trace.caches[key] ?? 0) + 1;
}
/** Accumulate a confirmation-stage metric. */
export function confirmationMetric(label: Label) {
  const trace = context.getStore();
  if (!trace || trace.closed) return undefined;
  const start = performance.now(),
    stage = trace.stages[trace.stage];
  let ended = false;
  return (error = false) => {
    if (ended || trace.closed) return;
    ended = true;
    const duration = Math.max(0, performance.now() - start);
    for (const metric of [
      trace.operations[label],
      ...(label === "d1" ? [stage.d1] : []),
    ]) {
      metric.count++;
      metric.durationMs += duration;
      if (error) metric.errors++;
    }
  };
}
// Runtime allowlist: never forward URLs, request bodies or dynamic provider data.
/** Attribute provider transport timing to the active confirmation trace. */
export function confirmationTransport(operation: string) {
  const map: Record<string, Label> = {
    "public-auth": "public_auth",
    "admin-auth": "admin_auth",
    identity: "identity",
    tariff: "tariff",
    "booking-read": "booking_read",
    "invoice-read": "invoice_read",
    "invoice-external-payment": "accounting_write",
    "hitpay-read": "hitpay_read",
    "hitpay-search": "hitpay_search",
  };
  const label = Object.hasOwn(map, operation) ? map[operation] : undefined;
  return label ? confirmationMetric(label) : undefined;
}
/** Emit the sanitized confirmation timing and outcome summary. */
export function finishConfirmationTrace(
  trace: Trace,
  key: string,
  boundary: "recovery" | "status" | "context" | "receipt",
  failed: boolean,
) {
  if (trace.closed) return "";
  const now = performance.now();
  trace.stages[trace.stage].durationMs += Math.max(0, now - trace.changed);
  trace.closed = true;
  const durationMs = Math.max(0, now - trace.started);
  console.log(
    JSON.stringify({
      event: "confirmation_trace",
      correlationId: trace.correlationId,
      recoveryKey: key,
      boundary,
      startedAtMs: trace.startedAtMs,
      completedAtMs: Date.now(),
      durationMs,
      outcome: failed ? "error" : "ok",
      ...(boundary === "recovery" ? { result: trace.result } : {}),
      stages: trace.stages,
      operations: trace.operations,
      caches: trace.caches,
    }),
  );
  const d1 = trace.operations.d1;
  return `confirmation_${boundary};dur=${durationMs.toFixed(2)}, confirmation_d1;dur=${d1.durationMs.toFixed(2)};desc="${d1.count} calls"`;
}
