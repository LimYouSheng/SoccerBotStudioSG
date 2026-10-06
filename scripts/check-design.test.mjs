import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { designAudit } from "./check-design.mjs";
const css = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
test("the interface uses the header blue, readable role hierarchy and contrasting semantic states", () => {
  const audit = designAudit(css);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.contrast.length, 14);
});
test("design policy rejects a teal action token even if it remains a valid CSS colour", () => {
  assert.ok(
    designAudit(
      css.replace(
        "--color-action: var(--color-brand)",
        "--color-action: #006d80",
      ),
    ).errors.some((e) => e.includes("Header blue drift")),
  );
});
test("design policy rejects low-contrast supporting text", () => {
  assert.ok(
    designAudit(
      css.replace("--color-muted: #586174", "--color-muted: #bfc5d0"),
    ).errors.some((e) => e.includes("Insufficient contrast")),
  );
});
test("design policy rejects shrunken text or collapsed heading levels", () => {
  assert.ok(
    designAudit(
      css.replace("--text-meta: 0.875rem", "--text-meta: 0.625rem"),
    ).errors.some((e) => e.includes("Supporting text")),
  );
  assert.ok(
    designAudit(
      css.replace("--text-section: 1.25rem", "--text-section: 1rem"),
    ).errors.some((e) => e.includes("hierarchy")),
  );
});
test("design policy rejects local booking colour and type overrides", () => {
  const audit = designAudit(
    css + "\n.time { background: #00b8d4; font-size: 10px; }",
  );
  assert.ok(audit.errors.some((e) => e.includes("colour bypass")));
  assert.ok(audit.errors.some((e) => e.includes("type size bypass")));
  assert.ok(
    designAudit(
      css +
        "\n.offer-home:focus-visible { outline: 3px solid var(--color-arena-accent); }",
    ).errors.some((e) => e.includes("Decorative accent")),
  );
});
test("design policy rejects invented variable font ranges and undersized controls", () => {
  assert.ok(
    designAudit(
      css.replace("font-weight: 500;", "font-weight: 500 600;"),
    ).errors.some((e) => e.includes("static font")),
  );
  assert.ok(
    designAudit(
      css.replace("--icon-control-size: 44px", "--icon-control-size: 32px"),
    ).errors.some((e) => e.includes("Control size")),
  );
});
test("design policy reports missing or cyclic brand tokens instead of silently accepting them", () => {
  assert.ok(
    designAudit(css.replace("--color-brand: #050a2f;", "")).errors.some((e) =>
      e.includes("Missing design token"),
    ),
  );
  assert.ok(
    designAudit(
      css.replace(
        "--color-brand: #050a2f",
        "--color-brand: var(--color-action)",
      ),
    ).errors.some((e) => e.includes("Cyclic design token")),
  );
});
