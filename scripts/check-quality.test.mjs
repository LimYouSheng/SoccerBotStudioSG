import { test } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";
import { checkPolicy, policyInputs } from "./check-policy.mjs";
import { validateResults } from "./verify-test-results.mjs";
import { checkCss } from "./check-css.mjs";
const inputs = () => structuredClone(policyInputs(process.cwd()));
test("accepts the reviewed runtime lock and CI policy", () =>
  assert.deepEqual(checkPolicy(inputs()), []));
for (const [name, mutate] of [
  [
    "stale generated types",
    (p) => (p.pkg.scripts.typecheck = "next typegen && tsc --noEmit"),
  ],
  ["loose dependency", (p) => (p.pkg.devDependencies.yaml = "^2.9.1")],
  [
    "wrong lock resolution",
    (p) => (p.lock.packages["node_modules/yaml"].version = "0.0.0"),
  ],
  [
    "Node types drift",
    (p) => (p.pkg.devDependencies["@types/node"] = "26.0.0"),
  ],
  [
    "conditional required job",
    (p) =>
      (p.workflow = p.workflow.replace(
        "runs-on: ubuntu-latest",
        "if: false\n    runs-on: ubuntu-latest",
      )),
  ],
  [
    "workflow path bypass",
    (p) =>
      (p.workflow = p.workflow.replace(
        "pull_request:",
        "pull_request:\n    paths: [src/**]",
      )),
  ],
  [
    "missing code gate",
    (p) => (p.workflow = p.workflow.replace("npm run verify", "echo passed")),
  ],
  [
    "masked failure",
    (p) => (p.workflow = p.workflow.replace("npm ci", "npm ci || true")),
  ],
  [
    "release gate bypass",
    (p) =>
      (p.workflow = p.workflow.replace(
        "node scripts/check-developer-release.mjs",
        "echo release-passed",
      )),
  ],
  [
    "release source redirection",
    (p) =>
      (p.workflow = p.workflow.replace(
        "${{ github.event.pull_request.head.sha || github.sha }}",
        "main",
      )),
  ],
  [
    "unversioned action",
    (p) =>
      (p.workflow = p.workflow.replace(
        /actions\/checkout@[a-f0-9]+/,
        "actions/checkout@main",
      )),
  ],
  [
    "deployment permission",
    (p) =>
      (p.workflow = p.workflow.replace("contents: read", "contents: write")),
  ],
  [
    "missing artifact retention",
    (p) => (p.workflow = p.workflow.replace("if: always()", "if: success()")),
  ],
  [
    "inline lint bypass",
    (p) =>
      (p.eslint = p.eslint.replace(
        "noInlineConfig: true",
        "noInlineConfig: false",
      )),
  ],
])
  test(`policy rejects ${name}`, () => {
    const p = inputs();
    mutate(p);
    assert.ok(checkPolicy(p).length);
  });
const inventory = [
  { file: "src/example.test.ts", title: "required behaviour" },
];
const unit = () => ({
  success: true,
  numTotalTests: 1,
  numPassedTests: 1,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: "src/example.test.ts",
      status: "passed",
      assertionResults: [
        { title: "required behaviour", status: "passed", failureMessages: [] },
      ],
    },
  ],
});
test("accepts complete unit execution identities", () =>
  assert.deepEqual(validateResults("unit", unit(), inventory), []));
for (const [name, mutate] of [
  ["missing file", (r) => (r.testResults = [])],
  [
    "skipped case",
    (r) => (r.testResults[0].assertionResults[0].status = "pending"),
  ],
  [
    "duplicate case",
    (r) =>
      r.testResults[0].assertionResults.push(
        r.testResults[0].assertionResults[0],
      ),
  ],
  [
    "wrong identity",
    (r) => (r.testResults[0].assertionResults[0].title = "other"),
  ],
  ["retry", (r) => (r.testResults[0].assertionResults[0].retry = 1)],
  ["truncated totals", (r) => delete r.numPassedTests],
])
  test(`receipt rejects ${name}`, () => {
    const r = unit();
    mutate(r);
    assert.ok(validateResults("unit", r, inventory).length);
  });
const browser = () => ({
  config: {
    projects: ["desktop-chromium", "phone-webkit", "tablet-webkit"].map(
      (name) => ({ name }),
    ),
  },
  errors: [],
  stats: { expected: 3, unexpected: 0, flaky: 0, skipped: 0 },
  suites: [
    {
      specs: [
        {
          file: "customer.spec.ts",
          title: "required journey",
          ok: true,
          tests: ["desktop-chromium", "phone-webkit", "tablet-webkit"].map(
            (projectName) => ({
              projectName,
              expectedStatus: "passed",
              status: "expected",
              annotations: [],
              results: [{ status: "passed", retry: 0, errors: [] }],
            }),
          ),
        },
      ],
    },
  ],
});
const browserInventory = [
  { file: "tests/customer.spec.ts", title: "required journey" },
];
test("accepts the full browser matrix receipt", () =>
  assert.deepEqual(
    validateResults("browser", browser(), browserInventory),
    [],
  ));
test("rejects a browser retry even if its final attempt passes", () => {
  const r = browser();
  r.suites[0].specs[0].tests[0].results.push({ status: "passed", retry: 1 });
  assert.ok(validateResults("browser", r, browserInventory).length);
});
test("rejects a missing WebKit project", () => {
  const r = browser();
  r.config.projects.pop();
  assert.ok(validateResults("browser", r, browserInventory).length);
});
test("CSS accepts font descriptors and rejects malformed or unsupported values", () => {
  assert.deepEqual(
    checkCss(
      '@font-face {font-family: Demo; src: url("font.woff2") format("woff2"); font-weight: 500 600; font-display: swap;} body {display: grid;}',
    ),
    [],
  );
  assert.ok(checkCss("body {color:").length);
  assert.ok(checkCss("body { display: imaginary; }").length);
});
test("semantic lint rejects conditional Hooks and cannot be bypassed with a directive", async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(
    'import {useState} from "react"; export default function Card({on}:{on:boolean}) { if(on) useState(0); return null; }',
    { filePath: "src/components/lint-fixture.tsx" },
  );
  assert.ok(
    result.messages.some(
      (message) => message.ruleId === "react-hooks/rules-of-hooks",
    ),
  );
  const [suppressed] = await eslint.lintText(
    '/* eslint-disable react-hooks/rules-of-hooks */\nimport {useState} from "react"; export default function Card({on}:{on:boolean}) { if(on) useState(0); return null; }',
    { filePath: "src/components/lint-fixture.tsx" },
  );
  assert.ok(
    suppressed.messages.some(
      (message) => message.ruleId === "react-hooks/rules-of-hooks",
    ),
  );
  assert.ok(suppressed.warningCount + suppressed.errorCount > 0);
});
