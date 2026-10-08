import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const { source: clockSource } = require(
  path.join(
    path.dirname(require.resolve("playwright-core/package.json")),
    "lib/generated/clockSource.js",
  ),
);
const customerSource = readFileSync(
  path.join(root, "tests/customer.spec.ts"),
  "utf8",
);
const parsed = ts.createSourceFile(
  "customer.spec.ts",
  customerSource,
  ts.ScriptTarget.Latest,
  true,
);
const setupCalls = parsed.statements.filter(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(parsed) === "test.beforeEach",
);
assert.equal(setupCalls.length, 1, "Exercise the real browser-suite setup");
const setupCode = ts.transpileModule(
  `globalThis.setup = ${setupCalls[0].expression.arguments[0].getText(parsed)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

// Evaluate the pinned injected clock and application service in a Node VM.
// No Playwright runner, browser process or browser API is launched.
function fixture(t) {
  const storage = new Map();
  const timers = new Set();
  const context = vm.createContext({
    setTimeout: (callback, delay = 0) => {
      const handle = setTimeout(callback, Math.max(0, delay));
      timers.add(handle);
      return handle;
    },
    clearTimeout,
    setInterval,
    clearInterval,
    performance,
    console,
    structuredClone,
    crypto,
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  vm.runInContext(
    `class Event {}; const module = {}; ${clockSource}
    globalThis.clock = module.exports.inject()(globalThis).controller;`,
    context,
  );
  t.after(() => {
    context.clock.uninstall();
    for (const timer of timers) clearTimeout(timer);
  });
  vm.runInContext(setupCode, context);
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const compiledModule = { exports: {} };
    cache.set(file, compiledModule);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const localRequire = (name) => {
      if (!name.startsWith(".") && !name.startsWith("@/")) return require(name);
      const target = name.startsWith("@/")
        ? path.join(root, "src", name.slice(2))
        : path.resolve(path.dirname(file), name);
      return load(target + ".ts");
    };
    vm.runInContext(
      `(function(require, module, exports) { ${code}\n})`,
      context,
    )(localRequire, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }
  const service = load(
    path.join(root, "src/services/demo/booking.ts"),
  ).demoBookingModel;
  const { blankDraft } = load(path.join(root, "src/domain/booking.ts"));
  let nextDay = 6;
  function attempt(outcome) {
    const draft = blankDraft();
    Object.assign(draft, {
      mode: "guest",
      accepted: true,
      slots: [
        {
          date: `2026-10-${String(nextDay++).padStart(2, "0")}`,
          start: "09:00",
          instructor: "faisal",
        },
      ],
    });
    Object.assign(draft.contact, {
      name: "Demo Customer",
      email: "customer@example.com",
      phone: "+65 8123 4567",
    });
    return service.pay(service.checkout(draft, null), outcome);
  }
  function resolveAtDeadline(attempts) {
    return new Promise((resolve, reject) => {
      const delay =
        Math.max(...attempts.map((item) => item.checkUntil)) -
        vm.runInContext("Date.now()", context);
      context.setTimeout(() => {
        try {
          resolve(attempts.map((item) => service.resolve(item)));
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  }
  return { context, service, attempt, resolveAtDeadline };
}

test("browser-suite clock advances payment deadlines for every outcome and pending recovery", async (t) => {
  const { context, service, attempt, resolveAtDeadline } = fixture(t);
  await context.setup({
    page: {
      clock: {
        install: async ({ time }) => context.clock.install(time.getTime()),
        setFixedTime: async (time) =>
          context.clock.setFixedTime(time.getTime()),
      },
    },
  });
  assert.equal(
    vm.runInContext("new Date().toISOString().slice(0, 10)", context),
    "2026-10-05",
  );
  const checking = ["success", "declined", "pending", "late"].map(attempt);
  for (const item of checking)
    assert.equal(service.resolve(item).status, "checking");
  const results = await resolveAtDeadline(checking);
  assert.deepEqual(
    results.map((item) => item.status),
    ["paid", "declined", "pending", "late"],
  );
  const [paid, declined, pending, late] = results;
  assert.equal(
    service.resolve(checking[0]).booking.reference,
    paid.booking.reference,
  );
  assert.equal(service.pay(late, "success"), late);
  const retry = service.pay(declined, "pending");
  const restored = JSON.parse(JSON.stringify(pending));
  const recovered = await resolveAtDeadline([retry, service.check(restored)]);
  assert.deepEqual(
    recovered.map((item) => item.status),
    ["pending", "paid"],
  );
});

test("frozen Date reproduces the payment stall despite a fired timer", async (t) => {
  const { context, attempt, resolveAtDeadline } = fixture(t);
  context.clock.setFixedTime(Date.parse("2026-10-05T00:00:00Z"));
  const results = await resolveAtDeadline([attempt("declined")]);
  assert.equal(results[0].status, "checking");
});
