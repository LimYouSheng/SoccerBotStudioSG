import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { checkCss } from "./check-css.mjs";
import { inspectTests, orderedInventory } from "./test-inventory.mjs";
const ignored = new Set([
  "node_modules",
  ".next",
  "out",
  ".git",
  "test-results",
  "playwright-report",
  "coverage",
  "__pycache__",
]);
export function checkCaseCollisions(names) {
  const errors = [];
  const portablePaths = new Map();
  for (const name of names) {
    const parts = name.split("/");
    for (let depth = 1; depth <= parts.length; depth++) {
      const relative = parts.slice(0, depth).join("/");
      const portable = relative.normalize("NFC").toLowerCase();
      if (
        portablePaths.has(portable) &&
        portablePaths.get(portable) !== relative
      )
        errors.push(
          `Case collision: ${relative} / ${portablePaths.get(portable)}`,
        );
      portablePaths.set(portable, relative);
    }
  }
  return [...new Set(errors)];
}
export function checkSource(root) {
  const errors = [],
    files = [],
    names = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).replaceAll(path.sep, "/");
      names.push(relative);
      if (/[\x00-\x1f<>:"|?*]/.test(entry.name) || /[. ]$/.test(entry.name))
        errors.push(`Nonportable path: ${relative}`);
      if (entry.isSymbolicLink()) {
        errors.push(`Symlink: ${path.relative(root, full)}`);
        continue;
      }
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(root);
  errors.push(...checkCaseCollisions(names));
  const testInventory = [];
  const runtime = files.filter(
    (file) => /src[/\\].*\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
  const graph = new Map(runtime.map((file) => [file, []]));
  for (const file of files) {
    const name = path.relative(root, file);
    if (/\.(tsx?|mjs|css|py|json|ya?ml|md|sh)$/.test(name)) {
      const text = readFileSync(file, "utf8");
      if (/^(<{7}|={7}|>{7})/m.test(text))
        errors.push(`Conflict marker: ${name}`);
      if (/ +$/m.test(text)) errors.push(`Trailing whitespace: ${name}`);
      if (/\.(test|spec)\./.test(name)) {
        const checked = inspectTests(name, text);
        errors.push(...checked.errors);
        testInventory.push(...checked.inventory);
      }
      if (/\.(tsx?|mjs)$/.test(name) && !name.endsWith(".d.ts")) {
        const parsed = ts.createSourceFile(
          file,
          text,
          ts.ScriptTarget.Latest,
          true,
          name.endsWith(".tsx")
            ? ts.ScriptKind.TSX
            : name.endsWith(".mjs")
              ? ts.ScriptKind.JS
              : ts.ScriptKind.TS,
        );
        for (const diagnostic of parsed.parseDiagnostics)
          errors.push(
            `Syntax error: ${name}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
          );
        if (
          /src[/\\]/.test(name) &&
          /eslint-disable|@ts-(?:ignore|nocheck)/.test(text)
        )
          errors.push(`Forbidden suppression: ${name}`);
      }
    }
    if (
      /src[/\\]/.test(name) &&
      /(?:backup|patched|fixed|override|\.bak|\.orig)/i.test(name)
    )
      errors.push(`Noncanonical source: ${name}`);
    if (
      /src[/\\].*\.css$/.test(name) &&
      name.replaceAll(path.sep, "/") !== "src/app/globals.css"
    )
      errors.push(`Second CSS owner: ${name}`);
    if (!graph.has(file)) continue;
    const text = readFileSync(file, "utf8");
    if (
      /dangerouslySetInnerHTML|\.innerHTML\s*=|\bADMIN_PASSWORD\b|\badminSignedIn\b|href=["']#admin/.test(
        text,
      )
    )
      errors.push(`Legacy runtime/staff implementation: ${name}`);
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function visit(node) {
      let moduleName;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        moduleName = node.moduleSpecifier?.text;
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0])
      )
        moduleName = node.arguments[0].text;
      if (moduleName?.startsWith("@/") || moduleName?.startsWith(".")) {
        const target = moduleName.startsWith("@/")
          ? path.join(root, "src", moduleName.slice(2))
          : path.resolve(path.dirname(file), moduleName);
        const resolved = [
          target,
          target + ".ts",
          target + ".tsx",
          path.join(target, "index.ts"),
          path.join(target, "index.tsx"),
        ].find((candidate) => files.includes(candidate));
        if (!resolved) errors.push(`Missing import: ${name} -> ${moduleName}`);
        else if (graph.has(resolved)) graph.get(file).push(resolved);
        if (
          /src[/\\](domain|services)[/\\]/.test(file) &&
          resolved &&
          /src[/\\](features|components|app)[/\\]/.test(resolved)
        )
          errors.push(`Forbidden layer: ${name} -> ${moduleName}`);
        if (
          /src[/\\]domain[/\\]/.test(file) &&
          resolved &&
          /src[/\\]services[/\\]/.test(resolved)
        )
          errors.push(`Forbidden layer: ${name} -> ${moduleName}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const inventoryFile = files.find((file) =>
    file.endsWith("/scripts/test-inventory.json"),
  );
  if (inventoryFile) {
    const expected = JSON.parse(readFileSync(inventoryFile, "utf8"));
    if (orderedInventory(expected) !== orderedInventory(testInventory))
      errors.push("Test inventory differs from the reviewed candidate");
  } else if (files.some((file) => path.relative(root, file) === "package.json"))
    errors.push("Missing required test inventory");
  if (
    new Set(testInventory.map((item) => item.file + "\0" + item.title)).size !==
    testInventory.length
  )
    errors.push("Duplicate test identity");

  const visited = new Set(),
    visiting = new Set();
  function dfs(file) {
    if (visiting.has(file)) {
      errors.push(`Dependency cycle: ${path.relative(root, file)}`);
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const child of graph.get(file) || []) dfs(child);
    visiting.delete(file);
    visited.add(file);
  }
  const entries = runtime.filter((file) =>
    /src[/\\]app[/\\].*(?:page|layout|loading|not-found|error|sitemap|robots)\.tsx?$/.test(
      file,
    ),
  );
  entries.forEach(dfs);
  for (const file of runtime)
    if (!visited.has(file))
      errors.push(`Unreachable runtime module: ${path.relative(root, file)}`);
  const css = files.find((file) => file.endsWith("/src/app/globals.css"));
  if (css) {
    errors.push(
      ...checkCss(
        readFileSync(css, "utf8"),
        runtime.map((file) => readFileSync(file, "utf8")).join("\n"),
      ),
    );
    const importers = runtime.filter((file) =>
      /import\s+["'](?:\.\/globals\.css|@\/app\/globals\.css)["']/.test(
        readFileSync(file, "utf8"),
      ),
    );
    if (importers.length !== 1 || !importers[0].endsWith("/src/app/layout.tsx"))
      errors.push("Canonical CSS must be imported once by the root layout");
  }
  return [...new Set(errors)];
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = checkSource(process.cwd());
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      "Source ownership, imports, graph, test controls and integrity passed.",
    );
}
