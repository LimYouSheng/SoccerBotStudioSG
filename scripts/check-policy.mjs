import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { checkPagesPolicy } from "./check-pages-policy.mjs";
export function checkPolicy({
  pkg,
  lock,
  workflow,
  nodeVersion,
  vitest,
  playwright,
  eslint,
}) {
  const errors = [],
    require = (value, message) => {
      if (!value) errors.push(message);
    };
  require(lock.lockfileVersion === 3, "Require lockfile version 3");
  const locked = lock.packages?.[""];
  require(!!locked, "Missing lockfile root");
  for (const key of [
    "name",
    "version",
    "engines",
    "dependencies",
    "devDependencies",
  ])
    require(JSON.stringify(pkg[key]) ===
      JSON.stringify(locked?.[key]), `Package/lock mismatch: ${key}`);
  for (const group of ["dependencies", "devDependencies"])
    for (const [name, version] of Object.entries(pkg[group] || {})) {
      require(name === "miniflare"
        ? version === "5.20261006.0-alpha"
        : /^\d+\.\d+\.\d+$/.test(version), `Dependency must be exact: ${name}`);
      require(lock.packages?.[`node_modules/${name}`]?.version ===
        version, `Locked direct version mismatch: ${name}`);
    }
  for (const [name, entry] of Object.entries(lock.packages || {}))
    if (entry.resolved) {
      require(entry.resolved.startsWith(
        "https://registry.npmjs.org/",
      ), `Unexpected dependency registry: ${name}`);
      require(typeof entry.integrity ===
        "string", `Missing dependency integrity: ${name}`);
    }
  require(nodeVersion.trim() === "24.19.0" &&
    pkg.engines?.node === ">=24.19.0 <25" &&
    pkg.devDependencies?.["@types/node"]?.startsWith(
      "24.",
    ), "Node runtime/types must use the reviewed Node 24 baseline");
  require(pkg.scripts?.typecheck ===
    "node scripts/reset-next-types.mjs && next typegen && tsc --noEmit", "Reset and generate Next types before typecheck");
  require(pkg.scripts?.verify ===
    "node scripts/verify.mjs all", "Complete verification entry changed");
  require(pkg.scripts?.["verify:code"] ===
    "node scripts/verify.mjs code", "Non-browser verification entry changed");
  require(pkg.scripts?.["verify:browser"] ===
    "node scripts/verify.mjs browser", "Browser verification entry changed");
  require(/noInlineConfig:\s*true/.test(
    eslint,
  ), "ESLint suppression guard missing");
  require(/retry:\s*0/.test(vitest) &&
    /allowOnly:\s*false/.test(vitest) &&
    /jsdom/.test(vitest) &&
    /test\.tsx/.test(vitest), "Unit/component test policy changed");
  require(/retries:\s*0/.test(playwright) &&
    /forbidOnly:\s*true/.test(playwright) &&
    /reuseExistingServer:\s*false/.test(
      playwright,
    ), "Browser retries/exclusive/server policy changed");
  for (const name of ["desktop-chromium", "phone-webkit", "tablet-webkit"])
    require(playwright.includes(name), `Missing browser project: ${name}`);
  let doc;
  try {
    doc = YAML.parse(workflow, { uniqueKeys: true });
  } catch {
    return [...errors, "Invalid workflow YAML"];
  }
  require(!!doc.on &&
    Object.hasOwn(doc.on, "pull_request") &&
    Object.hasOwn(doc.on, "push") &&
    JSON.stringify(doc.on.push?.branches) ===
      '["main"]', "PR/main verification triggers missing");
  require(!doc.on?.pull_request?.paths &&
    !doc.on?.pull_request?.["paths-ignore"] &&
    !doc.on?.push?.paths &&
    !doc.on?.push?.["paths-ignore"], "Workflow path bypass refused");
  require(JSON.stringify(doc.permissions) ===
    '{"contents":"read"}', "Workflow must be read-only");
  const job = doc.jobs?.frontend;
  require(!!job &&
    job["runs-on"] === "ubuntu-latest" &&
    job["timeout-minutes"] === 20, "Frontend runner/timeout changed");
  require(!Object.hasOwn(job || {}, "if") &&
    !job?.["continue-on-error"] &&
    !job?.permissions &&
    !job?.environment, "Required job bypass or deployment access refused");
  const steps = job?.steps || [];
  require(JSON.stringify(steps.filter((s) => s.run).map((s) => s.run)) ===
    JSON.stringify([
      "npm ci",
      "npx playwright install --with-deps chromium webkit",
      "npm run verify",
    ]), "Required gate order/commands changed");
  for (const step of steps) {
    require(!step["continue-on-error"], "Step failure masking refused");
    if (step.run)
      require(!Object.hasOwn(step, "if") &&
        !step.env &&
        !step[
          "working-directory"
        ], "Conditional or redirected required gate refused");
    if (step.uses)
      require(/^actions\/(?:checkout|setup-node|upload-artifact|upload-pages-artifact)@[a-f0-9]{40}$/.test(
        step.uses,
      ), "Actions must be pinned to commit SHAs");
  }
  const setup = steps.find((s) => s.uses?.startsWith("actions/setup-node@"));
  require(setup?.with?.["node-version-file"] === ".nvmrc" &&
    setup?.with?.cache ===
      "npm", "CI must use the local Node pin and npm cache");
  const artifact = steps.find((s) =>
    s.uses?.startsWith("actions/upload-artifact@"),
  );
  require(artifact?.if === "always()" &&
    artifact?.with?.path?.includes(
      "test-results/",
    ), "Always retain verification evidence");
  require(!/secrets\.|pull_request_target/.test(
    workflow,
  ), "Verification must not use deployment credentials");
  errors.push(...checkPagesPolicy(doc));
  return errors;
}
export function policyInputs(root) {
  const read = (name) => readFileSync(`${root}/${name}`, "utf8");
  return {
    pkg: JSON.parse(read("package.json")),
    lock: JSON.parse(read("package-lock.json")),
    workflow: read(".github/workflows/verify.yml"),
    nodeVersion: read(".nvmrc"),
    vitest: read("vitest.config.ts"),
    playwright: read("playwright.config.ts"),
    eslint: read("eslint.config.mjs"),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = checkPolicy(policyInputs(process.cwd()));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log("Runtime, lockfile, lint/test and parsed CI policy passed.");
}
