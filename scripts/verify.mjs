import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { exportInventory } from "./check-export.mjs";
import { siteBasePath } from "../src/content/site-path.ts";
const mode = process.argv[2];
if (!["code", "browser", "all"].includes(mode))
  throw new Error("Use code, browser or all verification scope");
const ignored = new Set([
  "node_modules",
  ".wrangler",
  ".git",
  ".next",
  "out",
  "test-results",
  "playwright-report",
  "coverage",
  "__pycache__",
]);
function fingerprint() {
  const hash = createHash("sha256");
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (
        ignored.has(entry.name) ||
        entry.name === "next-env.d.ts" ||
        entry.name === "runtime.d.ts" ||
        entry.name.endsWith(".tsbuildinfo")
      )
        continue;
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${file}`);
      if (entry.isDirectory()) visit(file);
      else {
        hash.update(path.relative(process.cwd(), file));
        hash.update("\0");
        hash.update(readFileSync(file));
        hash.update("\0");
      }
    }
  }
  visit(process.cwd());
  return hash.digest("hex");
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm",
  dir = "test-results";
mkdirSync(dir, { recursive: true });
const started = new Date().toISOString(),
  baseline = fingerprint();
const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
const receipt = {
  scope: mode,
  started,
  node: process.version,
  sourceFingerprint: baseline,
  gitHead: git.status === 0 ? git.stdout.trim() : null,
  basePath: siteBasePath,
  bookingMode: process.env.NEXT_PUBLIC_BOOKING_MODE || "demo",
  browserExecuted: false,
  status: "running",
  commands: [],
};
const commands =
  mode === "browser"
    ? [["build", "npm", "run", "build"]]
    : [
        ["source", "npm", "run", "check:source"],
        ["policy", "npm", "run", "check:policy"],
        ["tooling", "npm", "run", "check:tooling"],
        ["installer", "npm", "run", "check:installer"],
        ["format", "npm", "run", "format:check"],
        ["lint", "npm", "run", "lint"],
        ["types", "npm", "run", "typecheck"],
        ["unit", "npm", "test"],
        ["unit-receipt", "node", "scripts/verify-test-results.mjs", "unit"],
        ["build", "npm", "run", "build"],
      ];
commands.push(["export", "node", "scripts/check-export.mjs"]);
if (mode !== "code")
  commands.push(
    ["browser", "npm", "run", "test:e2e"],
    ["browser-receipt", "node", "scripts/verify-test-results.mjs", "browser"],
  );
try {
  if (process.version !== "v24.19.0")
    throw new Error(`Use Node 24.19.0 (.nvmrc); found ${process.version}`);
  for (const [name, command, ...args] of commands) {
    if (name === "browser")
      rmSync(`${dir}/browser-engines.json`, { force: true });
    if (name === "unit" || name === "browser")
      rmSync(`${dir}/${name}.json`, { force: true });
    const log = `${dir}/${mode}-${name}.log`;
    writeFileSync(log, `$ ${command} ${args.join(" ")}\n`);
    console.log(`\n[${mode}] ${command} ${args.join(" ")}`);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(command === "npm" ? npm : process.execPath, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (data) => {
          output += data.toString();
          process.stdout.write(data);
        });
      child.on("error", reject);
      child.on("close", (exit) => {
        writeFileSync(log, `$ ${command} ${args.join(" ")}\n${output}`);
        resolve(exit ?? 1);
      });
    });
    receipt.commands.push({ command: [command, ...args], exitCode: code, log });
    if (name === "browser") receipt.browserExecuted = true;
    if (code !== 0)
      throw new Error(`Required ${name} gate failed (${code}); see ${log}`);
  }
  if (fingerprint() !== baseline)
    throw new Error("Source changed during verification; receipt refused");
  const exported = JSON.parse(readFileSync(`${dir}/export.json`, "utf8"));
  if (
    exported.basePath !== siteBasePath ||
    JSON.stringify(exportInventory(path.resolve("out"))) !==
      JSON.stringify(exported.files)
  )
    throw new Error(
      "Export changed after static verification; tested artifact refused",
    );
  receipt.export = exported;
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  receipt.finished = new Date().toISOString();
  writeFileSync(
    `${dir}/verification-${mode}.json`,
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(`Receipt: ${dir}/verification-${mode}.json`);
}
