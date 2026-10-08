import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const dir = "test-results";
mkdirSync(dir, { recursive: true });
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: "test-results/wrangler-logs",
};
const commands = [
  ["source", "node", ["scripts/check-worker.mjs"]],
  [
    "types-generate",
    "node",
    ["node_modules/wrangler/bin/wrangler.js", "types", "worker/runtime.d.ts"],
  ],
  [
    "types",
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "worker/tsconfig.json"],
  ],
  [
    "runtime",
    "node",
    ["--test", "--test-reporter=tap", "worker/tests/runtime.test.mjs"],
  ],
];
const receipt = { status: "running", providerRequests: 0, commands: [] };
for (const [name, cmd, args] of commands) {
  const r = spawnSync(cmd, args, { env, encoding: "utf8" });
  const output = (r.stdout || "") + (r.stderr || "");
  writeFileSync(`${dir}/worker-${name}.log`, output);
  process.stdout.write(output);
  receipt.commands.push({ name, exitCode: r.status });
  if (r.status !== 0) {
    receipt.status = "failed";
    break;
  }
  if (name === "runtime") {
    const expected = JSON.parse(
      readFileSync("scripts/worker-test-inventory.json", "utf8"),
    );
    const titles = [...output.matchAll(/^# Subtest: (.+)$/gm)].map((m) => m[1]);
    if (
      JSON.stringify(titles) !== JSON.stringify(expected) ||
      !/^# fail 0$/m.test(output) ||
      !/^# skipped 0$/m.test(output) ||
      !/^# cancelled 0$/m.test(output) ||
      !/^# todo 0$/m.test(output)
    ) {
      receipt.status = "failed";
      receipt.error = "Runtime inventory or strict outcome mismatch";
      break;
    }
  }
}
if (receipt.status === "running") receipt.status = "passed";
writeFileSync(
  `${dir}/verification-worker.json`,
  JSON.stringify(receipt, null, 2) + "\n",
);
if (receipt.status !== "passed") process.exitCode = 1;
