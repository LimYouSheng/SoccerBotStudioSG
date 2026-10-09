import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { releaseProfile } from "./release-profile.mjs";
export function validateEngines(projects) {
  const expected = [
    {
      name: "desktop-chromium",
      browserName: "chromium",
      retries: 0,
      repeatEach: 1,
    },
    { name: "phone-webkit", browserName: "webkit", retries: 0, repeatEach: 1 },
    { name: "tablet-webkit", browserName: "webkit", retries: 0, repeatEach: 1 },
  ];
  return JSON.stringify(projects) === JSON.stringify(expected)
    ? []
    : ["Actual browser engine/retry matrix differs"];
}
export function validateResults(
  kind,
  report,
  inventory,
  root = process.cwd(),
  suite = "demo",
) {
  const errors = [],
    seen = [],
    files = new Set();
  const clean = (file) =>
    path
      .relative(root, path.resolve(root, file || ""))
      .replaceAll(path.sep, "/");
  const expected = inventory.filter((item) =>
    kind === "unit"
      ? /\.test\.tsx?$/.test(item.file)
      : /\.spec\.ts$/.test(item.file) &&
        (suite === "live-email"
          ? item.file === "tests/live-email.spec.ts"
          : item.file !== "tests/live-email.spec.ts"),
  );
  if (!["demo", "live-email"].includes(suite)) return ["Unknown browser suite"];
  if (!expected.length) return ["Expected inventory is empty"];
  if (kind === "unit") {
    if (
      !report.success ||
      !Array.isArray(report.testResults) ||
      report.numFailedTests ||
      report.numPendingTests ||
      report.numTodoTests ||
      report.numRuntimeErrorTestSuites
    )
      errors.push("Unit result is failed, skipped, incomplete or malformed");
    for (const suite of report.testResults || []) {
      const file = clean(suite.name);
      files.add(file);
      if (
        suite.status !== "passed" ||
        !Array.isArray(suite.assertionResults) ||
        !suite.assertionResults.length
      )
        errors.push(`Unit file did not pass: ${file}`);
      for (const result of suite.assertionResults || []) {
        seen.push(`${file}\0${result.title}`);
        if (
          result.status !== "passed" ||
          result.failureMessages?.length ||
          result.retry ||
          result.invocations > 1
        )
          errors.push(`Unit case did not pass once: ${result.title}`);
      }
    }
    if (
      report.numTotalTests !== expected.length ||
      report.numPassedTests !== expected.length ||
      report.numFailedTestSuites
    )
      errors.push("Unit totals differ from expected execution");
  } else if (kind === "browser") {
    const projects = ["desktop-chromium", "phone-webkit", "tablet-webkit"];
    if (
      report.errors?.length ||
      !Array.isArray(report.suites) ||
      report.stats?.unexpected ||
      report.stats?.flaky ||
      report.stats?.skipped
    )
      errors.push(
        "Browser report has errors, retries, skipped or missing results",
      );
    if (
      JSON.stringify(
        (report.config?.projects || []).map((p) => p.name).sort(),
      ) !== JSON.stringify([...projects].sort())
    )
      errors.push("Browser project matrix differs");
    function walk(suites) {
      for (const suite of suites || []) {
        for (const spec of suite.specs || []) {
          const file = spec.file?.startsWith("tests/")
            ? spec.file
            : `tests/${spec.file || suite.file}`;
          files.add(file);
          if (!spec.ok) errors.push(`Browser spec failed: ${spec.title}`);
          for (const t of spec.tests || []) {
            seen.push(`${file}\0${spec.title}\0${t.projectName}`);
            if (
              t.expectedStatus !== "passed" ||
              t.status !== "expected" ||
              t.annotations?.some((a) =>
                ["skip", "fixme", "fail"].includes(a.type),
              ) ||
              t.results?.length !== 1 ||
              t.results[0].status !== "passed" ||
              t.results[0].retry !== 0 ||
              t.results[0].errors?.length
            )
              errors.push(
                `Browser case did not pass once: ${spec.title} / ${t.projectName}`,
              );
          }
        }
        walk(suite.suites);
      }
    }
    walk(report.suites);
    if (report.stats?.expected !== expected.length * projects.length)
      errors.push("Browser totals differ from expected execution");
  } else return ["Unknown receipt kind"];
  const wanted = expected.flatMap((item) =>
    kind === "unit"
      ? [`${item.file}\0${item.title}`]
      : ["desktop-chromium", "phone-webkit", "tablet-webkit"].map(
          (project) => `${item.file}\0${item.title}\0${project}`,
        ),
  );
  if (
    new Set(seen).size !== seen.length ||
    JSON.stringify(seen.sort()) !== JSON.stringify(wanted.sort())
  )
    errors.push("Executed case identities differ from the reviewed inventory");
  if (
    JSON.stringify([...files].sort()) !==
    JSON.stringify([...new Set(expected.map((item) => item.file))].sort())
  )
    errors.push("Executed file inventory differs");
  return errors;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const kind = process.argv[2];
  try {
    const errors = validateResults(
      kind,
      JSON.parse(readFileSync(`test-results/${kind}.json`, "utf8")),
      JSON.parse(readFileSync("scripts/test-inventory.json", "utf8")),
      process.cwd(),
      releaseProfile().browserSuite,
    );
    if (kind === "browser")
      errors.push(
        ...validateEngines(
          JSON.parse(readFileSync("test-results/browser-engines.json", "utf8")),
        ),
      );
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      `${kind} execution identities, file totals and zero-skip/retry receipt passed.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
