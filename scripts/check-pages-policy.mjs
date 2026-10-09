const mainOnly =
  "github.ref == 'refs/heads/main' && github.event_name != 'pull_request'";
const releaseCommand =
  "node scripts/prepare-developer-release.mjs\nnode scripts/check-developer-release.mjs\n";
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
    "deploy",
    "frontend",
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
  return errors;
}
