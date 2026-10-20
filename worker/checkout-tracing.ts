import { AsyncLocalStorage } from "node:async_hooks";

const phases = [
  "queue",
  "prepare",
  "simplybook",
  "booking_work",
  "verification",
  "hitpay",
  "payment_save",
] as const;
type Phase = (typeof phases)[number];
type Metric = {
  durationMs: number;
  calls: number;
  d1Count: number;
  d1DurationMs: number;
  d1Errors: number;
};
type CheckoutTrace = {
  correlationId: string;
  started: number;
  changed: number;
  phase: Phase;
  closed: boolean;
  tokenCached?: boolean;
  tokenDurationMs: number;
  activeProviders: number;
  phases: Record<Phase, Metric>;
};
const context = new AsyncLocalStorage<CheckoutTrace>();
const elapsed = (start: number) => Math.max(0, performance.now() - start);

export function createCheckoutTrace(correlationId: string): CheckoutTrace {
  if (!/^[a-f0-9-]{36}$/.test(correlationId))
    throw new Error("Invalid trace identity");
  const now = performance.now();
  return {
    correlationId,
    started: now,
    changed: now,
    phase: "queue",
    closed: false,
    tokenDurationMs: 0,
    activeProviders: 0,
    phases: Object.fromEntries(
      phases.map((phase) => [
        phase,
        { durationMs: 0, calls: 0, d1Count: 0, d1DurationMs: 0, d1Errors: 0 },
      ]),
    ) as Record<Phase, Metric>,
  };
}

function change(trace: CheckoutTrace, phase: Phase) {
  if (trace.closed) return;
  const now = performance.now();
  trace.phases[trace.phase].durationMs += Math.max(0, now - trace.changed);
  trace.changed = now;
  trace.phase = phase;
}

// Bind inside the queued callback: another request may own the queue's drain.
export function runCheckoutTrace<T>(
  trace: CheckoutTrace | undefined,
  operation: () => Promise<T>,
) {
  if (!trace) return operation();
  return context.run(trace, () => {
    change(trace, "prepare");
    return operation();
  });
}

export function checkoutTokenCache(cached: boolean) {
  const trace = context.getStore();
  if (!trace || trace.closed || trace.tokenCached !== undefined)
    return undefined;
  trace.tokenCached = cached;
  const start = performance.now();
  return () => {
    if (!trace.closed) trace.tokenDurationMs = elapsed(start);
  };
}

// Capture the phase at dispatch, even when a D1 promise settles in a later phase.
export function checkoutD1() {
  const trace = context.getStore();
  if (!trace || trace.closed) return undefined;
  const metric = trace.phases[trace.phase];
  const start = performance.now();
  return (error: boolean) => {
    if (trace.closed) return;
    metric.d1Count++;
    metric.d1DurationMs += elapsed(start);
    if (error) metric.d1Errors++;
  };
}

// Called after admission, immediately before fetch; ends after body consumption.
export function checkoutProvider(
  phase: "simplybook" | "verification" | "hitpay",
) {
  const trace = context.getStore();
  if (!trace || trace.closed) return undefined;
  change(trace, phase);
  trace.phases[phase].calls++;
  trace.activeProviders++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    trace.activeProviders--;
    if (trace.activeProviders === 0)
      change(trace, phase === "hitpay" ? "payment_save" : "booking_work");
  };
}

export function finishCheckoutTrace(trace: CheckoutTrace | undefined) {
  if (!trace || trace.closed) return undefined;
  change(trace, trace.phase);
  trace.closed = true;
  const durationMs = Math.max(0, trace.changed - trace.started);
  // Fixed labels, numbers and one cache boolean only; no identifiers except
  // the existing request correlation ID. Background work cannot amend this.
  console.log(
    JSON.stringify({
      event: "checkout_trace",
      correlationId: trace.correlationId,
      durationMs,
      ...(trace.tokenCached === undefined
        ? {}
        : {
            tokenCached: trace.tokenCached,
            tokenDurationMs: trace.tokenDurationMs,
          }),
      phases: trace.phases,
    }),
  );
  return [
    `checkout;dur=${durationMs.toFixed(2)}`,
    ...phases.flatMap((phase) => {
      const metric = trace.phases[phase];
      return [
        `${phase};dur=${metric.durationMs.toFixed(2)}${metric.calls ? `;desc="${metric.calls} calls"` : ""}`,
        `${phase}_d1;dur=${metric.d1DurationMs.toFixed(2)};desc="${metric.d1Count} calls"`,
      ];
    }),
    ...(trace.tokenCached === undefined
      ? []
      : [
          `sb_token;dur=${trace.tokenDurationMs.toFixed(2)};desc="${trace.tokenCached ? "cached" : "cache_miss"}"`,
        ]),
  ].join(", ");
}
