import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  cpSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { checkWorker } from "./check-worker.mjs";
function fixture(change) {
  const root = mkdtempSync(path.join(tmpdir(), "worker-policy-"));
  try {
    cpSync("worker", path.join(root, "worker"), { recursive: true });
    cpSync("wrangler.jsonc", path.join(root, "wrangler.jsonc"));
    change(root);
    return checkWorker(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("accepts the reviewed Worker graph and deployment boundary", () =>
  assert.deepEqual(checkWorker(process.cwd()), []));
test("rejects Worker orphan cycle and UI imports", () => {
  for (const [content, expected] of [
    ["export const value=1", "Unreachable"],
    ['import "../src/components/icon";', "Forbidden Worker layer"],
    ['import "./absent";', "Missing Worker import"],
  ])
    assert.ok(
      fixture((root) =>
        writeFileSync(path.join(root, "worker/extra.ts"), content),
      ).some((e) => e.includes(expected)),
    );
  assert.ok(
    fixture((root) =>
      writeFileSync(path.join(root, "worker/policy.ts"), 'import "./access";'),
    ).some((e) => e.includes("Worker cycle")),
  );
});
test("rejects direct provider fetch and suppression", () => {
  assert.ok(
    fixture((root) =>
      writeFileSync(
        path.join(root, "worker/policy.ts"),
        'fetch("https://provider.invalid");',
      ),
    ).some((e) => e.includes("dispatch is disabled")),
  );
  assert.ok(
    fixture((root) =>
      writeFileSync(path.join(root, "worker/policy.ts"), "// @ts-ignore"),
    ).some((e) => e.includes("suppression")),
  );
});
test("rejects provider redirects alternate hosts and unreserved dispatch", () => {
  for (const [from, to] of [
    ['redirect: "manual"', 'redirect: "follow"'],
    ["user-api-v2.simplybook.me/admin/auth", "other.invalid/admin/auth"],
    ['https://user-api.simplybook.me/"', 'https://other.invalid/"'],
    [
      'https://user-api-v2.simplybook.me/admin/invoices/"',
      'https://other.invalid/invoices/"',
    ],
    ["await dispatch.reserve()", 'Promise.resolve("unreserved")'],
  ])
    assert.ok(
      fixture((root) => {
        const p = path.join(root, "worker/provider-transport.ts");
        const source = readFileSync(p, "utf8");
        assert.ok(source.includes(from));
        writeFileSync(p, source.replace(from, to));
      }).some((e) => e.includes("Provider transport")),
    );
});
test("rejects production account alternate entry and enabled providers", () => {
  for (const [key, value] of [
    ["name", "app404"],
    ["account_id", "other-account"],
    ["main", "worker/tests/harness.ts"],
  ])
    assert.ok(
      fixture((root) => {
        const p = path.join(root, "wrangler.jsonc"),
          c = ts.parseConfigFileTextToJson(p, readFileSync(p, "utf8")).config;
        c[key] = value;
        writeFileSync(p, JSON.stringify(c));
      }).some((e) => e.includes("deployment boundary")),
    );
  assert.ok(
    fixture((root) => {
      const p = path.join(root, "wrangler.jsonc"),
        c = ts.parseConfigFileTextToJson(p, readFileSync(p, "utf8")).config;
      c.vars.PROVIDER_ACCESS = "enabled";
      writeFileSync(p, JSON.stringify(c));
    }).some((e) => e.includes("deployment boundary")),
  );
});
test("rejects extra resource and API static-routing changes", () => {
  assert.ok(
    fixture((root) => {
      const p = path.join(root, "wrangler.jsonc"),
        c = ts.parseConfigFileTextToJson(p, readFileSync(p, "utf8")).config;
      c.d1_databases.push(c.d1_databases[0]);
      writeFileSync(p, JSON.stringify(c));
    }).some((e) => e.includes("resource boundary")),
  );
  assert.ok(
    fixture((root) => {
      const p = path.join(root, "wrangler.jsonc"),
        c = ts.parseConfigFileTextToJson(p, readFileSync(p, "utf8")).config;
      c.assets.run_worker_first = [];
      writeFileSync(p, JSON.stringify(c));
    }).some((e) => e.includes("routing boundary")),
  );
});

test("requires backend runtime and root browser checks without deployment permission", async () => {
  const { checkPagesPolicy } = await import("./check-pages-policy.mjs");
  const { default: YAML } = await import("yaml");
  const original = YAML.parse(
    readFileSync(".github/workflows/verify.yml", "utf8"),
  );
  for (const change of [
    (d) => delete d.jobs.backend,
    (d) => (d.jobs.backend.permissions = { contents: "write" }),
    (d) => d.jobs.backend.steps.splice(3, 1),
    (d) => (d.jobs.backend.steps[3].if = "false"),
    (d) => (d.jobs.backend.env.NEXT_PUBLIC_BASE_PATH = "/other"),
  ]) {
    const changed = structuredClone(original);
    change(changed);
    assert.ok(checkPagesPolicy(changed).length > 0);
  }
});

test("rejects wrong database identity binding alias and cross-script coordinator", () => {
  for (const change of [
    (c) => (c.d1_databases[0].database_id = "foreign"),
    (c) => (c.d1_databases[0].binding = "FOREIGN"),
    (c) => (c.durable_objects.bindings[0].name = "OTHER"),
    (c) => (c.durable_objects.bindings[0].script_name = "app404"),
    (c) => (c.vars.DEPLOYMENT_ACCOUNT_ID = "foreign"),
    (c) => (c.vars.APP_ORIGIN = "https://foreign.test"),
  ])
    assert.ok(
      fixture((root) => {
        const p = path.join(root, "wrangler.jsonc"),
          c = ts.parseConfigFileTextToJson(p, readFileSync(p, "utf8")).config;
        change(c);
        writeFileSync(p, JSON.stringify(c));
      }).some((e) => /boundary changed/.test(e)),
    );
});
