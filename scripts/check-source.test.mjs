import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkSource } from "./check-source.mjs";
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
