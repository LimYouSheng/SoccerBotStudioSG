import { emailSitekey } from "./release-profile.mjs";
const mainOnly =
  "github.ref == 'refs/heads/main' && github.event_name != 'pull_request'";
const releaseCommand =
  "node scripts/prepare-developer-release.mjs\nnode scripts/check-developer-release.mjs\n";
/** Verify that CI preserves the separate Pages and Worker release gates. */
export function checkPagesPolicy(doc) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  require(same(Object.keys(doc.on || {}).sort(), [
    "pull_request",
    "push",
    "workflow_dispatch",
  ]), "Unexpected workflow trigger");
  require(same(Object.keys(doc.jobs || {}).sort(), [
    "backend",
    "cloudflare",
    "deploy",
    "frontend",
    "live-email",
  ]), "Unexpected or missing workflow job");
  require(!doc.env &&
    !doc.defaults, "Workflow environment redirection refused");
  require(doc.concurrency?.group ===
    "verify-${{ github.workflow }}-${{ github.ref }}" &&
    doc.concurrency?.["cancel-in-progress"] ===
      "${{ github.event_name == 'pull_request' }}", "Main deployments must be serialized without cancellation");
  const backend = doc.jobs?.backend || {};
  const backendCheckout = (backend.steps || []).filter((s) =>
    s.uses?.startsWith("actions/checkout@"),
  );
  require(backendCheckout.length === 1 &&
    same(backendCheckout[0].with, { "fetch-depth": 2 }) &&
    !backendCheckout[0].if &&
    !backendCheckout[0].env, "Backend release checkout identity changed");
  require(backend.name === "verify / backend" &&
    backend["runs-on"] === "ubuntu-latest" &&
    backend["timeout-minutes"] === 20 &&
    !backend.if &&
    !backend.permissions &&
    !backend.environment &&
    !backend["continue-on-error"] &&
    !backend.strategy &&
    !backend.defaults, "Backend gate bypass or deployment access refused");
  require(same(backend.env, {
    NEXT_PUBLIC_BASE_PATH: "",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: "test-results/wrangler-logs",
  }), "Backend root-path environment changed");
  require(same(
    (backend.steps || []).filter((s) => s.run).map((s) => s.run),
    [
      "npm ci",
      "npm run verify:worker",
      "npm run test:load:smoke",
      "npx playwright install --with-deps chromium webkit",
      "npm run verify:browser",
      releaseCommand,
    ],
  ), "Backend runtime/root browser gates changed");
  for (const step of backend.steps || [])
    require(!step["continue-on-error"] &&
      (!step.run ||
        (!step.if &&
          (step.run === releaseCommand
            ? same(step.env, {
                RELEASE_SOURCE_REVISION:
                  "${{ github.event.pull_request.head.sha || github.sha }}",
              })
            : !step.env) &&
          !step["working-directory"])), "Backend step bypass refused");
  const frontend = doc.jobs?.frontend || {};
  const expectedLive = structuredClone(backend);
  expectedLive.name = "verify / live-email";
  expectedLive.env = {
    NEXT_PUBLIC_BASE_PATH: "",
    RELEASE_PROFILE: "live-email",
    NEXT_PUBLIC_BOOKING_MODE: "live",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: emailSitekey,
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: "test-results/wrangler-logs",
  };
  for (const step of expectedLive.steps || [])
    if (step.uses?.startsWith("actions/upload-artifact@"))
      step.with.name =
        "live-email-evidence-${{ github.run_id }}-${{ github.run_attempt }}";
  require(same(
    doc.jobs?.["live-email"],
    expectedLive,
  ), "Live email requires independent root browser/runtime/sealed-release gates with exact public binding and no activation");
  require(same(frontend.env, { NEXT_PUBLIC_BASE_PATH: "/SoccerBotStudioSG" }) &&
    !frontend.defaults &&
    !frontend.strategy &&
    !frontend.needs, "Verification site path or job structure changed");
  const steps = frontend.steps || [];
  const upload = steps.filter((s) =>
    s.uses?.startsWith("actions/upload-pages-artifact@"),
  );
  require(upload.length === 1 &&
    upload[0].uses ===
      "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9" &&
    upload[0].if === mainOnly &&
    same(upload[0].with, { path: "out/" }) &&
    !upload[0]
      .env, "Pages must upload only the verified out directory on main");
  require(steps.indexOf(upload[0]) >
    steps.findIndex(
      (s) => s.run === "npm run verify",
    ), "Pages upload precedes verification");
  const setup = steps.filter((s) => s.uses?.startsWith("actions/setup-node@"));
  const checkout = steps.filter((s) => s.uses?.startsWith("actions/checkout@"));
  require(steps.length === 7 &&
    setup.length === 1 &&
    checkout.length === 1 &&
    !setup[0].if &&
    !checkout[0].if &&
    !checkout[0].with &&
    !checkout[0].env, "Verification checkout or steps redirected");
  const deploy = doc.jobs?.deploy || {};
  require(same(Object.keys(deploy).sort(), [
    "environment",
    "if",
    "needs",
    "permissions",
    "runs-on",
    "steps",
    "timeout-minutes",
  ]), "Unexpected deployment job controls");
  require(deploy.needs === "frontend" &&
    deploy.if ===
      mainOnly, "Deployment must depend on successful main verification");
  require(deploy["runs-on"] === "ubuntu-latest" &&
    deploy["timeout-minutes"] === 10, "Deployment runner or timeout changed");
  require(same(deploy.permissions, {
    pages: "write",
    "id-token": "write",
  }), "Deployment permission scope changed");
  require(same(deploy.environment, {
    name: "github-pages",
    url: "${{ steps.deployment.outputs.page_url }}",
  }), "Pages environment changed");
  require(same(deploy.steps, [
    {
      name: "Deploy the verified site",
      id: "deployment",
      uses: "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
    },
  ]), "Deployment must consume the same-run artifact without rebuilds or extra commands");
  require(same(doc.jobs?.cloudflare, {
    name: "deploy / Cloudflare",
    needs: ["frontend", "backend", "live-email"],
    if: "github.ref == 'refs/heads/main' && github.event_name != 'pull_request'",
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 10,
    permissions: {
      contents: "read",
      actions: "read",
    },
    environment: {
      name: "cloudflare-developer",
      url: "https://soccerbot-dev.limyousheng-94.workers.dev",
    },
    steps: [
      {
        uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      },
      {
        uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
        with: {
          "node-version-file": ".nvmrc",
          cache: "npm",
        },
      },
      {
        run: "npm ci",
      },
      {
        name: "Download this run's verified live artifact",
        env: {
          GH_TOKEN: "${{ github.token }}",
        },
        run: 'gh run download "$GITHUB_RUN_ID" --name "live-email-evidence-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" --dir work/deploy-evidence',
      },
      {
        name: "Deploy verified artifact and check the Worker",
        env: {
          CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_LOG_PATH: "work/deploy-evidence/wrangler-logs",
        },
        run: "node scripts/deploy-cloudflare.mjs",
      },
      {
        uses: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
        if: "always()",
        with: {
          name: "cloudflare-deployment-${{ github.run_id }}-${{ github.run_attempt }}",
          path: "work/deploy-evidence/deployment.json",
          "retention-days": 14,
          "if-no-files-found": "warn",
        },
      },
    ],
  }), "Cloudflare deployment must consume same-run verified main artifact after all three gates");
  return errors;
}
