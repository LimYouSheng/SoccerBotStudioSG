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

test("provider queue reserves recovery capacity bounds waiting and never dispatches rejected jobs", async () => {
  const queue = new ProviderQueue({
    capacity: 3,
    recoveryReserve: 1,
    waitMs: 50,
  });
  const gate = Promise.withResolvers();
  const order = [];
  const active = queue.run("foreground", () => gate.promise);
  const jobs = [0, 1].map((i) =>
    queue.run("foreground", async () => order.push(i)),
  );
  await assert.rejects(
    queue.run("display", async () => order.push("overflow")),
    { code: "provider_queue_busy", status: 503 },
  );
  const recovery = queue.run("recovery", async () => order.push("recovery"));
  await assert.rejects(
    queue.run("recovery", async () => order.push("overflow-recovery")),
    { code: "provider_queue_busy" },
  );
  gate.resolve();
  await Promise.all([active, ...jobs, recovery]);
  assert.deepEqual(order, ["recovery", 0, 1]);
  const secondGate = Promise.withResolvers();
  const second = queue.run("foreground", () => secondGate.promise);
  await assert.rejects(
    queue.run("foreground", async () => order.push("expired")),
    { code: "provider_queue_busy" },
  );
  secondGate.resolve();
  await second;
  assert.deepEqual(order, ["recovery", 0, 1]);
  assert.equal(
    await queue.run("display", async () => "available"),
    "available",
  );
});

test("provider queue prioritizes recovery while bounding starvation under mixed customer loads", async () => {
  for (const customers of [1, 3, 5, 10]) {
    const queue = new ProviderQueue();
    const gate = Promise.withResolvers();
    const order = [];
    let active = 0;
    const first = queue.run("display", () => gate.promise);
    const job = (name) => async () => {
      assert.equal(active++, 0);
      order.push(name);
      await Promise.resolve();
      active--;
    };
    const jobs = Array.from({ length: customers }, (_, i) =>
      queue.run("foreground", job(`customer-${i}`)),
    );
    const display = queue.run("display", job("display"));
    const recoveries = Array.from({ length: 5 }, (_, i) =>
      queue.run("recovery", job(`recovery-${i}`)),
    );
    gate.resolve();
    await Promise.all([first, ...jobs, display, ...recoveries]);
    assert.deepEqual(order.slice(0, 3), [
      "recovery-0",
      "recovery-1",
      "customer-0",
    ]);
    assert.equal(new Set(order).size, customers + 6);
    assert.ok(order.indexOf("display") <= 12);
  }
});
