import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { campaign, runCohort } from "./load-runner.mjs";
const mode = process.argv.slice(2);
if (
  mode.length !== 1 ||
  !["--plan", "--smoke", "--campaign"].includes(mode[0])
) {
  console.error(
    "Usage: node scripts/run-load.mjs --plan|--smoke|--campaign (isolated runtime only)",
  );
  process.exit(2);
}
const config = campaign(mode[0] === "--smoke");
if (mode[0] === "--plan") {
  console.log(
    JSON.stringify(
      {
        environment: "isolated-workerd-synthetic-providers",
        cohorts: config,
        loadModel:
          "closed finite burst; one checkout/customer; no steady-state RPS claim",
        latencyGate: "measurement only, not deployed acceptance",
        correctnessGate:
          "zero duplicate effects, complete recovery, preserved deadlines",
        stop: "first failed cohort, 120 seconds/cohort, 2000 synthetic provider calls/cohort",
      },
      null,
      2,
    ),
  );
} else {
  const directory = `test-results/load-${Date.now()}`;
  mkdirSync(directory, { recursive: true });
  const sourceHash = createHash("sha256");
  for (const file of execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--",
      "worker",
      "src/domain",
      "migrations",
      "wrangler.jsonc",
      "package.json",
      "package-lock.json",
    ],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean))
    sourceHash.update(file + "\0").update(readFileSync(file));
  const report = {
    sourceSha256: sourceHash.digest("hex"),
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    dirty: !!execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        ".",
        ":(exclude)node_modules",
      ],
      { encoding: "utf8" },
    ).trim(),
    harnessSha256: createHash("sha256")
      .update(readFileSync("scripts/load-provider.mjs"))
      .update(readFileSync("scripts/load-runner.mjs"))
      .update(readFileSync("scripts/run-load.mjs"))
      .digest("hex"),
    mode: mode[0],
    status: "running",
    cohorts: [],
  };
  const save = () =>
    writeFileSync(
      `${directory}/report.json`,
      JSON.stringify(report, null, 2) + "\n",
    );
  save();
  try {
    for (const item of config) {
      const result = await runCohort(item);
      report.cohorts.push(result);
      save();
      console.log(
        `${item.customers} customers / ${item.profile}: ${result.status}`,
      );
      if (result.status !== "passed") throw new Error(result.failure);
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failure = error.message;
    process.exitCode = 1;
  } finally {
    save();
    console.log(`Evidence: ${directory}/report.json`);
  }
}
