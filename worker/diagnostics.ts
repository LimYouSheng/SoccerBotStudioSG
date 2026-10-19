import { AsyncLocalStorage } from "node:async_hooks";
type Span =
  | "storage"
  | "d1"
  | "coordinator"
  | "coordinator_rpc"
  | "coordinator_wait"
  | "provider";
type Metric = { count: number; durationMs: number; errors: number };
type Trace = {
  correlationId: string;
  started: number;
  httpStatus?: number;
  spans: Record<Span, Metric>;
};
const context = new AsyncLocalStorage<Trace>();
export function traceId() {
  return context.getStore()?.correlationId || crypto.randomUUID();
}
// Fixed metadata only. Never include upstream URLs, headers or body text.
export function traceHitpayFailure(
  operation: "create" | "read" | "search",
  status: number,
  representation: "json" | "html" | "other" | "missing",
) {
  console.log(
    JSON.stringify({
      event: "hitpay_transport_failure",
      correlationId: traceId(),
      operation,
      status,
      representation,
    }),
  );
}
export function traceStatus(status: number) {
  const trace = context.getStore();
  if (trace) trace.httpStatus = status;
}
export function measure<T>(span: Span, operation: () => T): T {
  const trace = context.getStore(),
    start = performance.now();
  const end = (error: boolean) => {
    if (!trace) return;
    const metric = trace.spans[span];
    metric.count++;
    metric.durationMs += Math.max(0, performance.now() - start);
    if (error) metric.errors++;
  };
  try {
    const result = operation();
    if (
      result !== null &&
      (typeof result === "object" || typeof result === "function") &&
      typeof Reflect.get(result, "then") === "function"
    ) {
      // Observe settlement without replacing the caller's promise or error.
      void Promise.resolve(result).then(
        () => end(false),
        () => end(true),
      );
    } else end(false);
    return result;
  } catch (error) {
    end(true);
    throw error;
  }
}
export async function traced<T>(
  correlationId: string,
  boundary: "http" | "coordinator" | "scheduled",
  operation: () => Promise<T>,
): Promise<T> {
  if (!/^[a-f0-9-]{36}$/.test(correlationId))
    throw new Error("Invalid trace identity");
  const fresh = (): Metric => ({ count: 0, durationMs: 0, errors: 0 });
  const trace: Trace = {
    correlationId,
    started: performance.now(),
    spans: {
      storage: fresh(),
      d1: fresh(),
      coordinator: fresh(),
      coordinator_rpc: fresh(),
      coordinator_wait: fresh(),
      provider: fresh(),
    },
  };
  return context.run(trace, async () => {
    let outcome = "ok";
    try {
      return await operation();
    } catch (error) {
      outcome = "error";
      throw error;
    } finally {
      // Strict allowlist: no URL, headers, SQL, arguments, results or error text.
      console.log(
        JSON.stringify({
          event: "foundation_trace",
          boundary,
          correlationId,
          outcome:
            trace.httpStatus && trace.httpStatus >= 400 ? "error" : outcome,
          ...(trace.httpStatus === undefined
            ? {}
            : { httpStatus: trace.httpStatus }),
          durationMs: Math.max(0, performance.now() - trace.started),
          spans: trace.spans,
        }),
      );
    }
  });
}
// Preserve native receivers and promise identities. Only terminal D1 calls are
// timed; prepare/bind/session chaining never logs SQL or values.
export function instrumentStorage<T extends object>(
  target: T,
  span: "storage" | "d1" = "storage",
): T {
  return new Proxy(target, {
    get(object, key) {
      const member: unknown = Reflect.get(object, key);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        const invoke = () => Reflect.apply(member, object, args);
        if (
          ["first", "all", "raw", "run", "exec", "batch"].includes(String(key))
        )
          return measure(span, invoke);
        const result: unknown = invoke();
        if (
          ["prepare", "bind", "withSession"].includes(String(key)) &&
          result &&
          typeof result === "object"
        )
          return instrumentStorage(result, span);
        return result;
      };
    },
  });
}
