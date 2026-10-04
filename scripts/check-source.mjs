import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
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
export function checkSource(root) {
  const errors = [],
    files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        errors.push(`Symlink: ${path.relative(root, full)}`);
        continue;
      }
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(root);
  const testInventory = [];
  const runtime = files.filter(
    (file) => /src[/\\].*\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"),
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
        const testSource = ts.createSourceFile(
          file,
          text,
          ts.ScriptTarget.Latest,
          true,
        );
        function inspectTest(node) {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            ["only", "skip", "fixme"].includes(node.expression.name.text) &&
            ["it", "test", "describe"].includes(
              node.expression.expression.getText(testSource),
            )
          )
            errors.push(`Disabled/exclusive test: ${name}`);
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            ["it", "test"].includes(node.expression.text) &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0]) &&
            (name.endsWith(".test.ts") || name.endsWith(".spec.ts"))
          )
            testInventory.push({
              file: name.replaceAll(path.sep, "/"),
              title: node.arguments[0].text,
            });
          ts.forEachChild(node, inspectTest);
        }
        inspectTest(testSource);
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
    const order = (items) =>
      JSON.stringify(
        [...items].sort((a, b) =>
          (a.file + a.title).localeCompare(b.file + b.title),
        ),
      );
    if (order(expected) !== order(testInventory))
      errors.push("Test inventory differs from the reviewed candidate");
  }
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
    const text = readFileSync(css, "utf8");
    const defined = new Set(
      [...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    );
    for (const [, variable] of text.matchAll(/var\((--[\w-]+)\)/g))
      if (!defined.has(variable))
        errors.push(`Undefined CSS variable: ${variable}`);
  }
  return [...new Set(errors)];
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkSource(process.cwd());
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      "Source ownership, imports, graph, test controls and integrity passed.",
    );
}
