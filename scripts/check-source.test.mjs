import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkCaseCollisions, checkSource } from "./check-source.mjs";
function fixture(files, check) {
  const root = mkdtempSync(path.join(tmpdir(), "soccerbot-check-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(root, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    check(checkSource(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("accepts a reachable layered source graph", () =>
  fixture(
    {
      "src/app/page.tsx":
        "import {value} from '../domain/rules'; export default value;",
      "src/domain/rules.ts": "export const value = 1;",
    },
    (errors) => assert.deepEqual(errors, []),
  ));

const offlineFixture = {
  "src/app/page.tsx": "export default 1;",
  "src/domain/confirmation.ts":
    "export const verifyConfirmation = () => false;",
  "src/domain/confirmation.test.ts":
    'import { verifyConfirmation } from "./confirmation"; it("offline decision", () => verifyConfirmation());',
};
test("accepts the named offline entry with direct reviewed tests", () =>
  fixture(offlineFixture, (errors) => assert.deepEqual(errors, [])));
for (const [label, additions, expected] of [
  [
    "missing tests",
    { "src/domain/confirmation.test.ts": "" },
    "Missing direct offline entry tests",
  ],
  [
    "unrelated test import",
    {
      "src/domain/confirmation.test.ts":
        'import { other } from "./other"; it("offline decision", () => other());',
    },
    "Missing direct offline entry tests",
  ],
  [
    "type-only test import",
    {
      "src/domain/confirmation.test.ts":
        'import type { verifyConfirmation } from "./confirmation"; it("offline decision", () => {});',
    },
    "Missing direct offline entry tests",
  ],
  [
    "application exposure",
    {
      "src/app/page.tsx":
        'import { verifyConfirmation } from "../domain/confirmation"; export default verifyConfirmation;',
    },
    "Offline entry exposed",
  ],
  [
    "offline cycle",
    {
      "src/domain/confirmation.ts":
        'import "./cycle"; export const verifyConfirmation = () => false;',
      "src/domain/cycle.ts": 'import "./confirmation";',
    },
    "Dependency cycle",
  ],
  [
    "offline UI dependency",
    {
      "src/domain/confirmation.ts":
        'import "../components/card"; export const verifyConfirmation = () => false;',
      "src/components/card.tsx": "export default 1;",
    },
    "Forbidden layer",
  ],
  [
    "unreviewed standalone module",
    {
      "src/domain/unreviewed.ts": "export const value=1;",
      "src/domain/unreviewed.test.ts":
        'import {value} from "./unreviewed"; it("other decision", () => value);',
    },
    "Unreachable runtime module: src/domain/unreviewed.ts",
  ],
])
  test(`rejects ${label} for offline entries`, () =>
    fixture({ ...offlineFixture, ...additions }, (errors) =>
      assert.ok(
        errors.some((error) => error.includes(expected)),
        errors.join("\n"),
      ),
    ));

test("rejects an offline test whose named owner is absent", () =>
  fixture(
    {
      "src/app/page.tsx": offlineFixture["src/app/page.tsx"],
      "src/domain/confirmation.test.ts":
        offlineFixture["src/domain/confirmation.test.ts"],
    },
    (errors) =>
      assert.ok(
        errors.some((error) => error.includes("Missing offline entry")),
      ),
  ));
for (const [label, files, expected] of [
  [
    "missing imports",
    { "src/app/page.tsx": "import '../missing';" },
    "Missing import",
  ],
  [
    "dead modules",
    {
      "src/app/page.tsx": "export default 1;",
      "src/domain/dead.ts": "export const value=1;",
    },
    "Unreachable",
  ],
  [
    "cycles",
    {
      "src/app/page.tsx": "import '../domain/a';",
      "src/domain/a.ts": "import './b';",
      "src/domain/b.ts": "import './a';",
    },
    "Dependency cycle",
  ],
  [
    "layer violation",
    {
      "src/app/page.tsx": "import '../domain/a';",
      "src/domain/a.ts": "import '../components/card';",
      "src/components/card.tsx": "export const a = 1;",
    },
    "Forbidden layer",
  ],
  [
    "second CSS owner",
    {
      "src/app/page.tsx": "export default 1;",
      "src/components/card.css": "a {}",
    },
    "Second CSS owner",
  ],
  [
    "exclusive tests",
    {
      "src/app/page.tsx": "export default 1;",
      "src/domain/a.test.ts": 'test.only("x", () => {});',
    },
    "Disabled/exclusive test",
  ],
  [
    "legacy injection",
    { "src/app/page.tsx": "node.innerHTML = text;" },
    "Legacy runtime",
  ],
])
  test(`rejects ${label}`, () =>
    fixture(files, (errors) =>
      assert.ok(errors.some((error) => error.includes(expected))),
    ));

test("rejects a missing declared application test", () =>
  fixture(
    {
      "src/app/page.tsx": "export default 1;",
      "scripts/test-inventory.json": JSON.stringify([
        { file: "src/domain/required.test.ts", title: "required behaviour" },
      ]),
    },
    (errors) =>
      assert.ok(
        errors.some((error) => error.includes("Test inventory differs")),
      ),
  ));

// Test the production path checker with logical names. A case-insensitive disk
// cannot materialize both spellings, so on-disk fixtures erase the collision.
for (const [label, names, expected] of [
  [
    "case-colliding files",
    ["src/app/page.tsx", "Notes.md", "notes.md"],
    "Case collision: notes.md / Notes.md",
  ],
  [
    "case-colliding parent directories",
    ["src/app/page.tsx", "Docs/a.md", "docs/b.md"],
    "Case collision: docs / Docs",
  ],
  [
    "Unicode-normalized colliding files",
    ["docs/caf\u00e9.md", "docs/cafe\u0301.md"],
    "Case collision: docs/cafe\u0301.md / docs/caf\u00e9.md",
  ],
])
  test(`rejects ${label}`, () => {
    assert.deepEqual(checkCaseCollisions(names), [expected]);
  });

test("accepts distinct paths and repeated shared parents", () => {
  assert.deepEqual(
    checkCaseCollisions(["docs/a.md", "docs/b.md", "docs/nested/c.md", "docs"]),
    [],
  );
});

for (const [label, files, expected] of [
  [
    "invalid TypeScript",
    { "src/app/page.tsx": "export const broken = ;" },
    "Syntax error",
  ],
  [
    "missing inventory",
    { "package.json": "{}", "src/app/page.tsx": "export default 1;" },
    "Missing required test inventory",
  ],
  [
    "todo test",
    {
      "src/app/page.tsx": "export default 1;",
      "src/domain/rule.test.ts": 'test.todo("later");',
    },
    "Disabled/exclusive test",
  ],
  [
    "chained exclusive test",
    {
      "src/app/page.tsx": "export default 1;",
      "src/domain/rule.test.ts": 'test.describe.only("group",()=>{});',
    },
    "Disabled/exclusive test",
  ],
  [
    "inline lint suppression",
    { "src/app/page.tsx": "// eslint-disable-next-line\nexport default 1;" },
    "Forbidden suppression",
  ],
  [
    "duplicate CSS property",
    {
      "src/app/layout.tsx": "import './globals.css'; export default 1;",
      "src/app/globals.css": "body { color: red; color: blue; }",
    },
    "Duplicate CSS property",
  ],
  [
    "invalid CSS value",
    {
      "src/app/layout.tsx": "import './globals.css'; export default 1;",
      "src/app/globals.css": "body { display: banana; }",
    },
    "Invalid CSS value",
  ],
  [
    "missing CSS mount owner",
    {
      "src/app/page.tsx": "export default 1;",
      "src/app/globals.css": "body { color: red; }",
    },
    "Canonical CSS",
  ],
])
  test(`rejects ${label}`, () =>
    fixture(files, (errors) =>
      assert.ok(
        errors.some((error) => error.includes(expected)),
        errors.join("\n"),
      ),
    ));

test("rejects a frontend import of a Worker owner", () =>
  fixture(
    {
      "src/app/page.tsx": 'import "../../worker/access"; export default 1;',
      "worker/access.ts": "export const capability = 1;",
    },
    (errors) =>
      assert.ok(
        errors.some((error) => error.includes("Forbidden server import")),
      ),
  ));
