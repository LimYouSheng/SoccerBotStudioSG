import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetNextTypes } from "./reset-next-types.mjs";

function fixture(run) {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "soccerbot-types-")),
  );
  const write = (name, content = name) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  };
  try {
    run(root, write);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("clears duplicate production and development types while preserving other files on rerun", () => {
  fixture((root, write) => {
    for (const dir of [".next/types", ".next/dev/types"])
      for (const name of [
        "cache-life.d.ts",
        "cache-life.d 2.ts",
        "routes.d.ts",
        "routes.d 2.ts",
      ])
        write(`${dir}/${name}`);
    const preserved = [
      "src/page.tsx",
      "next-env.d.ts",
      "tsconfig.json",
      ".next/cache/keep",
      ".next/server/keep",
      ".next/dev/keep",
    ];
    for (const name of preserved) write(name);
    resetNextTypes(root);
    resetNextTypes(root);
    for (const name of [".next/types", ".next/dev/types"])
      assert.equal(existsSync(path.join(root, name)), false);
    for (const name of preserved)
      assert.equal(readFileSync(path.join(root, name), "utf8"), name);
  });
});

test("accepts a fresh checkout without generated type directories", () => {
  fixture((root, write) => {
    write("src/page.tsx");
    resetNextTypes(root);
    assert.equal(existsSync(path.join(root, ".next")), false);
  });
});

test("refuses a symlinked cache ancestor before deleting generated files", () => {
  fixture((root, write) => {
    write("external/types/routes.d.ts");
    symlinkSync(path.join(root, "external"), path.join(root, ".next"), "dir");
    assert.throws(() => resetNextTypes(root), /Symlinked/);
    assert.equal(
      readFileSync(path.join(root, "external/types/routes.d.ts"), "utf8"),
      "external/types/routes.d.ts",
    );
  });
});

test("validates both generated trees before deleting either when a nested symlink exists", () => {
  fixture((root, write) => {
    write(".next/types/routes.d.ts");
    write(".next/dev/types/routes.d.ts");
    write("source.ts");
    symlinkSync(
      path.join(root, "source.ts"),
      path.join(root, ".next/dev/types/linked.ts"),
    );
    assert.throws(() => resetNextTypes(root), /Symlinked/);
    assert.equal(existsSync(path.join(root, ".next/types/routes.d.ts")), true);
    assert.equal(
      readFileSync(path.join(root, "source.ts"), "utf8"),
      "source.ts",
    );
  });
});

test("refuses a regular file in place of a generated directory", () => {
  fixture((root, write) => {
    write(".next/types/routes.d.ts");
    write(".next/dev/types");
    assert.throws(
      () => resetNextTypes(root),
      /Expected generated-type directory/,
    );
    assert.equal(existsSync(path.join(root, ".next/types/routes.d.ts")), true);
    assert.equal(
      readFileSync(path.join(root, ".next/dev/types"), "utf8"),
      ".next/dev/types",
    );
  });
});
