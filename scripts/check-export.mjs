import {
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { parse, walk } from "css-tree";
import { siteBasePath } from "../src/content/site-path.ts";

export function exportInventory(directory) {
  const result = {};
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const file = resolve(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink in export: ${file}`);
      if (entry.isDirectory()) visit(file);
      else
        result[relative(directory, file).split(sep).join("/")] = createHash(
          "sha256",
        )
          .update(readFileSync(file))
          .digest("hex");
    }
  }
  visit(resolve(directory));
  return result;
}

export function checkExport(directory, basePath) {
  const root = resolve(directory),
    files = exportInventory(root);
  const required = [
    "index.html",
    "404.html",
    "studio/index.html",
    "enquiry/index.html",
    ...[
      "account",
      "session",
      "time",
      "details",
      "review",
      "payment",
      "confirmation",
    ].map((step) => `book/${step}/index.html`),
  ];
  for (const file of required)
    if (!files[file]) throw new Error(`Missing exported route: ${file}`);
  for (const file of Object.keys(files))
    if (
      /(^|\/)(?:README(?:\.md)?|package(?:-lock)?\.json|node_modules|\.git|src)(?:\/|$)/i.test(
        file,
      )
    )
      throw new Error(`Source leaked into export: ${file}`);
  let scripts = 0,
    styles = 0,
    fonts = 0,
    images = 0;
  function reference(value, from) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return;
    const url = new URL(value, `https://export.invalid${basePath}/${from}`);
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(basePath + "/"))
      throw new Error(`Unprefixed export URL: ${value} in ${from}`);
    let target = resolve(root, "." + pathname.slice(basePath.length));
    if (target !== root && !target.startsWith(root + sep))
      throw new Error(`Escaping export URL: ${value}`);
    try {
      if (statSync(target).isDirectory())
        target = resolve(target, "index.html");
      if (!statSync(target).isFile()) throw new Error("Not a file");
    } catch {
      throw new Error(`Missing export target: ${value} in ${from}`);
    }
    return target;
  }
  for (const file of Object.keys(files)) {
    if (file.endsWith(".html")) {
      const dom = new JSDOM(readFileSync(resolve(root, file), "utf8"));
      const doc = dom.window.document;
      if (
        file === "index.html" &&
        (!doc.querySelector(".arena-booking") ||
          !doc.querySelector("script[src]"))
      )
        throw new Error("Export homepage is not the SoccerBot app");
      for (const node of doc.querySelectorAll("[href], [src]")) {
        for (const attr of ["href", "src"])
          if (node.hasAttribute(attr)) reference(node.getAttribute(attr), file);
        if (node.matches("script[src]")) scripts++;
        if (node.matches('link[rel="stylesheet"]')) styles++;
        if (node.matches("img[src]")) images++;
      }
      dom.window.close();
    } else if (file.endsWith(".css")) {
      walk(parse(readFileSync(resolve(root, file), "utf8")), (node) => {
        if (node.type === "Url") {
          reference(node.value, file);
          if (/\.woff2(?:[?#]|$)/.test(node.value)) fonts++;
        }
      });
    }
  }
  if (!scripts || !styles || !images || fonts < 4)
    throw new Error("Export is missing scripts, styles, imagery or fonts");
  return {
    basePath,
    routes: required.length,
    scripts,
    styles,
    images,
    fonts,
    files,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = checkExport("out", siteBasePath);
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/export.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    `Export passed: ${result.routes} routes, local scripts/styles/images and ${result.fonts} fonts at ${siteBasePath || "/"}`,
  );
}
