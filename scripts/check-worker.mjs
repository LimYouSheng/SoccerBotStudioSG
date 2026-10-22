import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
/** Audit Worker boundaries, migrations and required verification controls. */
export function checkWorker(root) {
  const errors = [],
    dir = path.join(root, "worker");
  const names = readdirSync(dir).filter(
    (n) => n.endsWith(".ts") && !n.endsWith(".d.ts"),
  );
  const graph = new Map(names.map((n) => [n, []]));
  for (const name of names) {
    const text = readFileSync(path.join(dir, name), "utf8");
    const source = ts.createSourceFile(
      name,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    if (name === "provider-transport.ts") {
      if (
        (text.match(/\bfetch\(/g) || []).length !== 3 ||
        (text.match(/redirect: "manual"/g) || []).length !== 3 ||
        !text.includes("await dispatch.reserve({") ||
        !text.includes("await reserve();") ||
        !text.includes("signal: controller.signal")
      )
        errors.push("Provider transport reservation/redirect boundary changed");
      const urls = [...text.matchAll(/https:\/\/[^\s"']+/g)].map((m) => m[0]);
      if (
        JSON.stringify(urls.sort()) !==
        JSON.stringify(
          [
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            "https://api.resend.com/emails",
            "https://api.sandbox.hit-pay.com/v1/payment-requests",
            "https://user-api.simplybook.me/login",
            "https://user-api.simplybook.me/",
            "https://user-api-v2.simplybook.me/admin/invoices/",
            "https://user-api-v2.simplybook.me/admin/bookings/",
            "https://user-api-v2.simplybook.me/admin/webhooks",
            "https://user-api-v2.simplybook.me/admin/webhooks",
            "https://user-api-v2.simplybook.me/admin/webhooks/",
            "https://soccerbot-dev.limyousheng-94.workers.dev",
            "https://user-api-v2.simplybook.me/admin/auth",
            "https://user-api-v2.simplybook.me/admin/company/info",
            "https://user-api-v2.simplybook.me/admin/tariff/current",
            "https://user-api-v2.simplybook.me/admin/bookings/23",
            "https://user-api-v2.simplybook.me/admin/invoices/23",
          ].sort(),
        )
      )
        errors.push("Provider transport host/operation boundary changed");
    }
    if (/@ts-(?:ignore|nocheck)|eslint-disable|\bany\b/.test(text))
      errors.push(`Worker suppression/unsafe type: ${name}`);
    /** Inspect Worker syntax for prohibited runtime dependencies and patterns. */
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const spec = node.moduleSpecifier?.text;
        if (spec?.startsWith(".")) {
          if (spec.startsWith("./")) {
            const target = spec.slice(2) + ".ts";
            if (!graph.has(target))
              errors.push(`Missing Worker import: ${name} -> ${spec}`);
            else graph.get(name).push(target);
          } else if (
            ![
              "../src/domain/confirmation",
              "../src/domain/native-checkout",
              "../src/domain/booking-policy",
              "../src/domain/catalog",
              "../src/domain/contact",
              "../src/domain/session-pricing",
            ].includes(spec)
          )
            errors.push(`Forbidden Worker layer: ${name} -> ${spec}`);
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "fetch" &&
        name !== "provider-transport.ts" &&
        name !== "telemetry.ts"
      )
        errors.push(`Provider dispatch is disabled: ${name}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const visited = new Set(),
    visiting = new Set();
  function dfs(name) {
    if (visiting.has(name)) {
      errors.push(`Worker cycle: ${name}`);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const child of graph.get(name) || []) dfs(child);
    visiting.delete(name);
    visited.add(name);
  }
  dfs("index.ts");
  if (visited.has("telemetry.ts"))
    errors.push("Telemetry must remain outside the booking graph");
  if ((graph.get("telemetry.ts") || []).length)
    errors.push("Telemetry cannot import booking modules");
  dfs("telemetry.ts");
  for (const name of names)
    if (!visited.has(name)) errors.push(`Unreachable Worker module: ${name}`);
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync(path.join(root, "wrangler.jsonc"), "utf8"),
  ).config;
  if (
    config.name !== "soccerbot-dev" ||
    config.account_id !== "517f4f85eb8f982b483dbc05b797fd88" ||
    config.main !== "worker/index.ts" ||
    config.version_metadata?.binding !== "CF_VERSION_METADATA" ||
    config.vars.DEPLOYMENT_ACCOUNT_ID !== config.account_id ||
    config.vars.STATE_DATABASE_ID !== "297a991b-70a7-438d-a0e3-39fa3a7f2cee" ||
    config.vars.APP_ORIGIN !==
      "https://soccerbot-dev.limyousheng-94.workers.dev" ||
    config.vars.PROVIDER_ACCESS !== "disabled" ||
    config.vars.PROVIDER_CALL_CEILING !== "80" ||
    config.vars.IDENTITY_DELIVERY !== "disabled" ||
    config.vars.HITPAY_CHECKOUT !== "disabled" ||
    config.vars.HITPAY_RECOVERY !== "disabled" ||
    config.vars.HITPAY_WEBHOOK !== "disabled" ||
    config.vars.CAMPAIGN_ID !== "developer-20261008" ||
    config.vars.CAMPAIGN_END_MS !== "0"
  )
    errors.push("Worker deployment boundary changed");
  if (config.routes || config.route || config.env || config.triggers)
    errors.push("Unreviewed Worker routing or automation");
  if (
    config.d1_databases?.length !== 1 ||
    config.d1_databases[0].binding !== "STATE" ||
    config.d1_databases[0].database_id !== config.vars.STATE_DATABASE_ID ||
    config.durable_objects?.bindings?.[0]?.name !== "COORDINATOR" ||
    config.durable_objects?.bindings?.[0]?.script_name !== undefined ||
    config.durable_objects?.bindings?.[0]?.environment !== undefined ||
    config.d1_databases[0].database_name !== "soccerbot-dev-state" ||
    config.durable_objects?.bindings?.length !== 1 ||
    config.durable_objects.bindings[0].class_name !==
      "SoccerBotAccountCoordinator" ||
    JSON.stringify(config.migrations) !==
      JSON.stringify([
        { tag: "v1", new_sqlite_classes: ["SoccerBotAccountCoordinator"] },
      ])
  )
    errors.push("Worker resource boundary changed");
  if (
    JSON.stringify(config.assets?.run_worker_first) !==
      JSON.stringify(["/api", "/api/*"]) ||
    config.assets?.directory !== "./out"
  )
    errors.push("API/static routing boundary changed");
  const telemetry = ts.parseConfigFileTextToJson(
    "wrangler.telemetry.jsonc",
    readFileSync(path.join(root, "wrangler.telemetry.jsonc"), "utf8"),
  ).config;
  if (
    telemetry.name !== "soccerbot-telemetry" ||
    telemetry.main !== "worker/telemetry.ts" ||
    telemetry.account_id !== config.account_id ||
    telemetry.workers_dev !== false ||
    telemetry.preview_urls !== false ||
    telemetry.vars?.EXPORT_ENABLED !== "false" ||
    telemetry.vars?.GRAFANA_OTLP_ENDPOINT !== "" ||
    telemetry.vars?.SUCCESS_SAMPLE_RATE !== "0.1" ||
    telemetry.limits?.cpu_ms !== 50 ||
    JSON.stringify(telemetry.secrets?.required) !==
      JSON.stringify(["GRAFANA_AUTHORIZATION"]) ||
    telemetry.routes ||
    telemetry.route ||
    telemetry.env ||
    telemetry.triggers ||
    telemetry.tail_consumers ||
    telemetry.d1_databases ||
    telemetry.durable_objects ||
    telemetry.services
  )
    errors.push("Telemetry deployment boundary changed");
  if (
    config.tail_consumers ||
    config.observability?.traces?.enabled ||
    config.observability?.logs?.destinations?.length
  )
    errors.push("Telemetry export requires separate activation review");
  return errors;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = checkWorker(process.cwd());
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("Worker source/layer and development boundaries passed.");
}
