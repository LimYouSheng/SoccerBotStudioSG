import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../tests/live-email.spec.ts", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "live-email.spec.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const transport = parsed.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "mechanismTransport",
);
assert.ok(transport);
const code = ts.transpileModule(
  `${transport.getText(parsed)}\nglobalThis.transport = mechanismTransport;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

test("real Worker transport preserves checkout bodies across navigation and repeated requests", async () => {
  const context = vm.createContext({
    URL,
    Headers,
    expect: (value) => ({
      toBeDefined: () => assert.notEqual(value, undefined),
      toBe: (expected) => assert.equal(value, expected),
    }),
  });
  vm.runInContext(code, context);
  let handler,
    sequence = 0;
  const page = {
    route: async (_, callback) => {
      handler = callback;
    },
    unrouteAll: async () => {},
    context: () => ({ cookies: async () => [] }),
    isClosed: () => false,
  };
  const mechanism = {
    origin: "https://worker.example",
    checkoutUrl: "https://checkout.example/pay",
    mf: {
      dispatchFetch: async () =>
        Response.json({
          attemptId: `attempt-${++sequence}`,
          state: "associated",
          paymentAvailable: true,
        }),
    },
  };
  const captured = await context.transport(page, mechanism);
  const replies = [];
  for (let i = 0; i < 2; i++) {
    const request = {
      url: () => "http://127.0.0.1:4173/api/booking/checkout/test",
      method: () => "POST",
      postData: () => "{}",
      postDataJSON: () => ({}),
      allHeaders: async () => ({}),
      failure: () => null,
    };
    const reply = {
      request: () => request,
      status: () => 200,
      json: async () => {
        throw new Error("No resource with given identifier found");
      },
    };
    await handler({
      request: () => request,
      fulfill: async ({ body }) => {
        // Immediate navigation invalidates the browser resource. The exact body
        // delivered by the transport must already be available for assertions.
        await assert.rejects(reply.json(), /No resource/);
        assert.deepEqual(
          JSON.parse(JSON.stringify(captured.json(reply))),
          JSON.parse(body),
        );
      },
    });
    replies.push(reply);
  }
  assert.equal(captured.json(replies[0]).attemptId, "attempt-1");
  assert.equal(captured.json(replies[1]).attemptId, "attempt-2");
  assert.throws(() =>
    captured.json({ request: () => ({}), status: () => 200 }),
  );
  assert.equal(sequence, 2);
  await captured.drain();
});
