import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["worker/provider-queue.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { ProviderQueue } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("provider queue advances checkout ahead of waiting months without overlapping active work", async () => {
  const queue = new ProviderQueue();
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  const order = [];
  let active = 0;
  const job = (name, wait) => async () => {
    assert.equal(active++, 0);
    order.push(name);
    if (wait) {
      started.resolve();
      await wait;
    }
    active--;
    return name;
  };
  const first = queue.run("display", job("active-month", gate.promise));
  await started.promise;
  const month = queue.run("display", job("waiting-month"));
  const prepare = queue.run("foreground", job("prepare"));
  const hold = queue.run("foreground", job("hold"));
  const payment = queue.run("foreground", job("payment"));
  const recovery = queue.run("foreground", job("recovery"));
  assert.deepEqual(order, ["active-month"]);
  gate.resolve();
  assert.deepEqual(
    await Promise.all([first, month, prepare, hold, payment, recovery]),
    ["active-month", "waiting-month", "prepare", "hold", "payment", "recovery"],
  );
  assert.deepEqual(order, [
    "active-month",
    "prepare",
    "hold",
    "payment",
    "recovery",
    "waiting-month",
  ]);
  assert.equal(active, 0);
});

test("provider queue preserves FIFO and gives waiting calendars a bounded turn", async () => {
  const queue = new ProviderQueue();
  const gate = Promise.withResolvers();
  const order = [];
  const first = queue.run("display", () => gate.promise);
  const jobs = Array.from({ length: 9 }, (_, i) =>
    queue.run("foreground", async () => {
      order.push(`foreground-${i}`);
    }),
  );
  const display = ["month-1", "month-2"].map((name) =>
    queue.run("display", async () => {
      order.push(name);
    }),
  );
  gate.resolve();
  await Promise.all([first, ...jobs, ...display]);
  assert.deepEqual(order, [
    "foreground-0",
    "foreground-1",
    "foreground-2",
    "foreground-3",
    "month-1",
    "foreground-4",
    "foreground-5",
    "foreground-6",
    "foreground-7",
    "month-2",
    "foreground-8",
  ]);
});

test("provider queue preserves unknown failures without replay and continues after sync or async errors", async () => {
  const queue = new ProviderQueue();
  const gate = Promise.withResolvers();
  const error = new Error("synthetic unknown write");
  let calls = 0;
  const first = queue.run("display", () => gate.promise);
  const failed = queue.run("foreground", async () => {
    calls++;
    throw error;
  });
  const sync = queue.run("foreground", () => {
    calls++;
    throw error;
  });
  const success = queue.run("foreground", async () => {
    calls++;
    return "original-attempt";
  });
  const settled = Promise.allSettled([first, failed, sync, success]);
  gate.resolve();
  const results = await settled;
  assert.equal(results[1].reason, error);
  assert.equal(results[2].reason, error);
  assert.deepEqual(results[3], {
    status: "fulfilled",
    value: "original-attempt",
  });
  assert.equal(calls, 3);
  assert.equal(await queue.run("display", async () => "next"), "next");
});

const tracingBundle = await build({
  entryPoints: ["worker/checkout-tracing.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const tracing = await import(
  `data:text/javascript;base64,${Buffer.from(tracingBundle.outputFiles[0].text).toString("base64")}`
);

test("checkout timing isolates queued requests attributes D1 to dispatch phase and closes before background work", async (t) => {
  const logs = [];
  t.mock.method(console, "log", (message) => logs.push(JSON.parse(message)));
  const queue = new ProviderQueue();
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  const firstTrace = tracing.createCheckoutTrace(crypto.randomUUID());
  const secondTrace = tracing.createCheckoutTrace(crypto.randomUUID());
  let lateD1;
  const first = queue.run("foreground", () =>
    tracing.runCheckoutTrace(firstTrace, async () => {
      tracing.checkoutTokenCache(false)?.();
      const d1 = tracing.checkoutD1();
      const provider = tracing.checkoutProvider("simplybook");
      started.resolve();
      await gate.promise;
      d1(false);
      provider();
      lateD1 = tracing.checkoutD1();
    }),
  );
  await started.promise;
  let secondStarted = false;
  const second = queue.run("foreground", () =>
    tracing.runCheckoutTrace(secondTrace, async () => {
      secondStarted = true;
      tracing.checkoutTokenCache(true)?.();
      const readA = tracing.checkoutProvider("verification");
      const readB = tracing.checkoutProvider("verification");
      readA();
      assert.equal(secondTrace.phase, "verification");
      readB();
      const payment = tracing.checkoutProvider("hitpay");
      payment();
      tracing.checkoutD1()(true);
    }),
  );
  assert.equal(secondStarted, false);
  gate.resolve();
  await first;
  const firstHeader = tracing.finishCheckoutTrace(firstTrace);
  await second;
  const secondHeader = tracing.finishCheckoutTrace(secondTrace);
  lateD1(false);
  assert.equal(tracing.finishCheckoutTrace(firstTrace), undefined);
  assert.equal(logs.length, 2);
  const a = logs.find((log) => log.correlationId === firstTrace.correlationId);
  const b = logs.find((log) => log.correlationId === secondTrace.correlationId);
  assert.equal(a.phases.prepare.d1Count, 1);
  assert.equal(a.phases.booking_work.d1Count, 0);
  assert.equal(a.phases.simplybook.calls, 1);
  assert.equal(a.phases.hitpay.calls, 0);
  assert.equal(b.phases.prepare.d1Count, 0);
  assert.equal(b.phases.verification.calls, 2);
  assert.equal(b.phases.payment_save.d1Errors, 1);
  assert.equal(b.phases.hitpay.calls, 1);
  assert.match(firstHeader, /sb_token;dur=[0-9.]+;desc="cache_miss"/);
  assert.match(secondHeader, /sb_token;dur=[0-9.]+;desc="cached"/);
  for (const log of logs) {
    const phaseTotal = Object.values(log.phases).reduce(
      (sum, phase) => sum + phase.durationMs,
      0,
    );
    assert.ok(phaseTotal <= log.durationMs + 0.001);
    assert.ok(
      Math.abs(log.durationMs - phaseTotal) < 0.001,
      "phase wall times partition checkout duration",
    );
    assert.ok(log.phases.queue.durationMs >= 0);
  }
});
