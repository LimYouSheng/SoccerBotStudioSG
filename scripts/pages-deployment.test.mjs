import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { checkPolicy, policyInputs } from "./check-policy.mjs";
import { checkExport } from "./check-export.mjs";
import { exportServer } from "./serve-export.mjs";

for (const [name, mutate] of [
  ["missing verification dependency", (d) => delete d.jobs.deploy.needs],
  [
    "deploy despite failed verification",
    (d) => (d.jobs.deploy.if = "always()"),
  ],
  [
    "deployment from a PR",
    (d) => (d.jobs.deploy.if = "github.event_name == 'pull_request'"),
  ],
  [
    "PR write permissions",
    (d) => (d.jobs.frontend.permissions = { pages: "write" }),
  ],
  ["wrong export directory", (d) => (d.jobs.frontend.steps[5].with.path = ".")],
  [
    "upload before testing",
    (d) => d.jobs.frontend.steps.unshift(d.jobs.frontend.steps.splice(5, 1)[0]),
  ],
  ["upload on failed test", (d) => (d.jobs.frontend.steps[5].if = "always()")],
  [
    "unverified rebuild during deployment",
    (d) => d.jobs.deploy.steps.unshift({ run: "npm run build" }),
  ],
  [
    "unpinned deployment action",
    (d) => (d.jobs.deploy.steps[0].uses = "actions/deploy-pages@main"),
  ],
  [
    "root path on project hosting",
    (d) => (d.jobs.frontend.env.NEXT_PUBLIC_BASE_PATH = ""),
  ],
  [
    "deployment write permission outside Pages",
    (d) => (d.jobs.deploy.permissions.contents = "write"),
  ],
  [
    "main deployment cancellation",
    (d) => (d.concurrency["cancel-in-progress"] = true),
  ],
  [
    "combined gate replaced",
    (d) => (d.jobs.frontend.steps[4].run = "npm run build"),
  ],
  [
    "alternate checkout revision",
    (d) => (d.jobs.frontend.steps[0].with = { ref: "old-branch" }),
  ],
])
  test(`Pages policy rejects ${name}`, () => {
    const inputs = policyInputs(process.cwd()),
      doc = YAML.parse(inputs.workflow);
    mutate(doc);
    inputs.workflow = YAML.stringify(doc);
    assert.ok(checkPolicy(inputs).length);
  });

function fixture(t, basePath) {
  const root = mkdtempSync(join(tmpdir(), "soccerbot-export-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    const path = join(root, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, value);
  };
  const html = `<main><a class="arena-booking" href="${basePath}/book/account/">Book</a><img src="${basePath}/assets/photo.jpg"></main><script src="${basePath}/_next/app.js"></script><link rel="stylesheet" href="${basePath}/_next/app.css">`;
  for (const file of [
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
    ].map((s) => `book/${s}/index.html`),
  ])
    write(file, html);
  write("_next/app.js", "export {};");
  write("assets/photo.jpg", "synthetic image");
  write(
    "_next/app.css",
    [1, 2, 3, 4]
      .map(
        (n) =>
          `@font-face{font-family: Test${n};src:url(${basePath}/assets/font${n}.woff2)}`,
      )
      .join("\n"),
  );
  for (const n of [1, 2, 3, 4])
    write(`assets/font${n}.woff2`, "synthetic font");
  return { root, write };
}
for (const basePath of ["", "/SoccerBotStudioSG"]) {
  test(`export integrity and HTTP mount at ${basePath || "root"}`, async (t) => {
    const { root } = fixture(t, basePath);
    assert.equal(checkExport(root, basePath).routes, 11);
    const server = exportServer(root, basePath);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(
      () =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    );
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const route of [
      "/",
      "/book/payment/",
      "/_next/app.js",
      "/assets/font1.woff2",
    ])
      assert.equal((await fetch(origin + basePath + route)).status, 200, route);
    assert.equal((await fetch(origin + basePath + "/admin/")).status, 404);
    assert.equal(
      (await fetch(origin + basePath + "/%2e%2e%2fpackage.json")).status,
      404,
    );
    if (basePath) {
      assert.equal((await fetch(origin + "/assets/photo.jpg")).status, 404);
      assert.equal((await fetch(origin + basePath + "-other/")).status, 404);
      const redirect = await fetch(origin + basePath, { redirect: "manual" });
      assert.equal(redirect.status, 308);
      assert.equal(redirect.headers.get("location"), basePath + "/");
    }
  });
}
for (const [name, mutate, error] of [
  [
    "README homepage",
    (f) => f.write("index.html", "<h1>SoccerBotStudioSG README</h1>"),
    /not the SoccerBot app/,
  ],
  [
    "root-relative image",
    (f) => f.write("studio/index.html", '<img src="/assets/photo.jpg">'),
    /Unprefixed/,
  ],
  [
    "root-relative font",
    (f) => f.write("_next/app.css", "@font-face{src:url(/assets/font1.woff2)}"),
    /Unprefixed/,
  ],
  [
    "missing booking route",
    (f) => rmSync(join(f.root, "book/payment/index.html")),
    /Missing exported route/,
  ],
  [
    "missing image",
    (f) => rmSync(join(f.root, "assets/photo.jpg")),
    /Missing export target/,
  ],
  [
    "source file leakage",
    (f) => f.write("package.json", "{}"),
    /Source leaked/,
  ],
])
  test(`export rejects ${name}`, (t) => {
    const f = fixture(t, "/SoccerBotStudioSG");
    mutate(f);
    assert.throws(() => checkExport(f.root, "/SoccerBotStudioSG"), error);
  });

test("site paths support repository and root builds, refusing unreviewed prefixes", () => {
  for (const [prefix, status, expected] of [
    ["", 0, "/book/account/"],
    ["/SoccerBotStudioSG", 0, "/SoccerBotStudioSG/book/account/"],
    ["//wrong", 1, null],
  ]) {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import {sitePath} from "./src/content/site-path.ts"; console.log(sitePath("/book/account/"));',
      ],
      {
        env: { ...process.env, NEXT_PUBLIC_BASE_PATH: prefix },
        encoding: "utf8",
      },
    );
    assert.equal(child.status, status, child.stderr);
    if (expected) assert.equal(child.stdout.trim(), expected);
  }
});
