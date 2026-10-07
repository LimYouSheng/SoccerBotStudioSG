# SoccerBotStudioSG Codex Cloud workflow

Adapted 6 October 2026 against OneFitfinity PR #8's `docs/CODEX_CLOUD.md`, `NORTH_STAR.md`, `PROGRESS.md` and `AGENTS.md` at `16eea945f9324b6f20610d0a0b98b1a1cb6014e9`, after its main advanced to `7970f65b5975a6554c46eb521c7ca118939e4bb9`. The source-cutover, C1–C4 ledger, six-section agent checklist, bounded Ralph loop and receipt conventions follow that current reference. SoccerBot retains its own runtime, commands, provider contracts and release boundaries. Updated 7 October 2026 to document verified C3 restoration using the retained Docker runtime. C4 CI evidence is recorded in Progress; usable user preview acceptance remains blocked.

## 1. Canonical files

| File                                                          | Owns                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [AGENTS.md](../AGENTS.md)                                     | Short agent entry instructions                                                   |
| [NORTH_STAR.md](../NORTH_STAR.md)                             | One bounded milestone, objective acceptance and exclusions                       |
| [PROGRESS.md](../PROGRESS.md)                                 | One current task ledger, blockers, evidence and next action                      |
| [Rules and Architecture](SOCCERBOT_RULES_AND_ARCHITECTURE.md) | Canonical product rules, architecture, engineering policy and M1–M9              |
| [Service Contracts](SERVICE_CONTRACTS.md)                     | Implemented demo operations, observed provider reads and planned live boundaries |
| [Journey](SOCCERBOT_JOURNEY.md)                               | Dated decisions, failures and completed milestone evidence                       |
| This guide                                                    | Cloud setup, verification commands and source cutover                            |

The three existing domain/engineering documents remain canonical. North Star and Progress hold bounded task state; this guide supplies operating instructions. Do not duplicate rules into ENGINEERING_RULES or create another task ledger. Read relevant sections using search, not the full history every loop.

Fitfinity's additional AWS runbook records implemented AWS operations. SoccerBot's observed SimplyBook reads already belong in Service Contracts and Journey; no placeholder AWS/deployment runbook is imported. When approved deployment operators exist, their proven steps and recovery evidence need one clearly owned operations reference, without replacing the three canonical documents.

## 2. Current source and experiment boundary

- Repository: `LimYouSheng/SoccerBotStudioSG`.
- Verified main: `e883c1af117a960eeae9359c4db9923d774888dd`, after YS merged PR #7. Main run `37581074421` passed independent verification and the existing Pages deployment.
- Current branch: `docs/developer-api-cloudflare-plan-2026-10-07`, created in an isolated worktree from verified main. Publish a new draft PR; preserve the historical experiment checkout, prior feature branches and receipts. PR #7 is already merged by YS.
- The original Mac source was inspected and synchronized in PR #4, but its merge was unauthorized. Journey preserves that incident. No new Mac pull, branch switch or Cloud-document installation is claimed.
- Required status check: `verify / frontend` from GitHub Actions. Preserve the inherited workflow and repository protections.

Routine Cloud development uses the reviewed GitHub branch directly. A Mac installer and local provider login are not prerequisites. Optional Mac updates still use the existing guarded delivery/source checks and preserve new local edits.

Before a task changes source, read branch, HEAD, index/diff and the PR's current head. Refresh actual remote main and its CI; the recorded SHA is a checkpoint, not a permanent branch target. Confirm verified current main is an ancestor. If the Cloud checkout starts on main or a detached revision, create the task feature branch from verified main after checking for existing work; never reset, clean, force push or discard changes. If main advances, inspect the delta and integrate it on the task feature branch without overwriting concurrent work. Refresh the recorded base/evidence as needed.

YS merged PR #6 and moved application inspection to deployed main. That explicit user decision supersedes the earlier first-merge process requirement; do not retroactively mark visual review complete. Future publication and green checks do not authorize a merge. Every future merge needs explicit approval for that PR. The GitHub plugin's ask-before-write setting is separate from Cloud/CLI credentials; Markdown is not a technical permission control.

## 3. Reuse the verified Cloud runtime

The retained runtime at `/workspace/soccerbot-cloud-container/` is the verified Cloud restoration path. It isolates browser dependencies from the host and leaves the repository intact. Docker is development infrastructure only; the application remains a static demo with no Docker, PostgreSQL or AWS backend requirement. The runner, recipe, image metadata and archive are retained environment assets, not repository files or a portable installer delivered by this PR. A different environment must have that reviewed preparation available before restoration can be claimed.

### Historical restoration requirements — not the current feature-branch startup

- Checkout: `/workspace/SoccerBotStudioSG` on `experiment/codex-cloud-workflow-2026-10-06`. Read AGENTS, North Star, Progress and this guide; record branch, full HEAD, source/index status and inherited variables before work.
- Host: Python, Git, Docker client and access to the managed local daemon at `unix:///var/run/docker.sock`. The verified daemon was Docker `28.4.0` with `vfs`; the runner requires at least 5 GiB free for its container copy and fresh application build.
- Container: Debian 12, Node `24.19.0`, npm `11.9.0`, Python `3.11.2`, Git `2.39.5` and lockfile-pinned Playwright `1.58.2` with Chromium/WebKit and native libraries already prepared. Host Node/browser caches are not the restoration runtime.
- Inherited variables must match exactly; the runner rejects missing/mismatched values instead of supplying fallback exports. It passes them into the container. Do not create host caches or change environment settings merely to make restoration pass.

| Key                        | Required inherited value                    |
| -------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_BASE_PATH`    | `/SoccerBotStudioSG`                        |
| `npm_config_cache`         | `/workspace/soccerbot-cloud-cache/npm`      |
| `PLAYWRIGHT_BROWSERS_PATH` | `/workspace/soccerbot-cloud-cache/browsers` |

### Restoration command and identity guards

For an explicitly requested fresh restoration verification, use the retained runner:

```bash
python3 /workspace/soccerbot-cloud-container/container.py smoke
```

Do not rerun a successful restoration or local application suite merely to publish documentation. The runner requires a clean source/index on the experiment branch and ancestry from both base `0cea68168738c722d05be9d3580938b65a4860c7` and reviewed checkpoint `897cbfe737d31069ae25dca39c638cdededf3593`. Preserve dirty work and report the blocker; never reset, stash or discard it to satisfy preflight. Tests consume a read-only archive of committed HEAD, not uncommitted files.

The runner recomputes the preparation key from `Dockerfile`, `run-smoke.sh`, `validate-smoke.mjs`, `package.json` and `package-lock.json`, then compares `/workspace/soccerbot-cloud-container/image.json`. The verified preparation identities are:

- Preparation key: `8c9b6fadfc4cfa4319895a630f940fae8569e76a0dbc6cdf103e76db1c8d6a0a`.
- Image: `sha256:f574dd94b351dfcb0cb769d9a541d37bc5d3246f054d2a88598ba5365df3e76c`.
- Retained archive: `/workspace/soccerbot-cloud-cache/container-images/8c9b6fadfc4cfa4319895a630f940fae8569e76a0dbc6cdf103e76db1c8d6a0a.tar`.
- Archive SHA-256: `df4309e5cc195ad5ee2844b178a5c819910bc4f183427a294682067b0cd00865`.
- Lockfile SHA-256: `8699ac69d1dc161826288dd055af9f5fd2370a2db217962b7c0d29c550836b37`.

Reuse the matching local image. Only if it is absent may the runner checksum the retained archive, load it and require the exact image ID. A changed recipe/pin, missing archive or identity mismatch blocks restoration; do not reinstall packages, rebuild the runtime image, invoke `prepare` or run an installer to conceal a failure. A deliberate preparation refresh is a separate authorized task with its own evidence and environment review. Preserve inherited proxies, CA trust and authentication settings; restoration runs with `--network=none` and needs no downloads or provider credentials.

The runner selects the local socket while clearing inherited Docker endpoint/context/TLS selectors for its subprocesses. If sandbox access to the socket is denied, retain that failure and use the supported permission path for the same bounded command. Missing daemon access or unavailable preparation remains a blocker; do not redirect to another daemon or alter the environment configuration.

### What the scoped smoke proves

The ephemeral container checks runtime pins and exact package/lockfile bytes against its prepared dependencies, then runs `npm run check:policy`, one fresh `npm run build`, and the existing public-route/viewport case across all three projects. The retained validator requires exactly **3 passed**: `desktop-chromium`, `phone-webkit`, `tablet-webkit`, with zero failures, skips, retries or flaky results and valid engine/case identities. The case selector is `(^| )public routes remove staff access and fit the viewport$`. Assertions, projects and runner settings stay unchanged.

Evidence is written under `/workspace/soccerbot-cloud-evidence/container-smoke-*/`, including source/variables, index snapshot, image identity, logs, browser results, validation and exit receipt. Require exit 0 and preserved source/index. Keep the first failure and all original receipts. The retained runner's generic `C3_restoration` field is not automatically updated; record the fresh-task restoration conclusion in Progress without rewriting that field.

C3 restoration passed on 7 October 2026 at checkpoint `897cbfe737d31069ae25dca39c638cdededf3593`; original evidence is `/workspace/soccerbot-cloud-evidence/container-smoke-cb1zpd4r/`. The local image was already present, so no archive load was needed. The initial sandbox failure remains at `/workspace/soccerbot-cloud-evidence/container-smoke-pkwfxnog/receipt.json`. See Progress for the exact evidence and C4 review. This scoped smoke does not replace full final-candidate GitHub Actions CI.

### Preview boundary

The test harness owns `127.0.0.1:4173/SoccerBotStudioSG/` inside the network-disabled container, publishes no host port and stops its preview when tests finish. No supported Cloud forwarding surface is exposed in the verified task, so a user-accessible candidate preview remains **blocked**. A localhost URL, passing smoke or merged-main Pages cannot satisfy this criterion. No persistent preview or environment-setting change is part of restoration.

## 4. Verification and preview

Use current package scripts and check their owners when they change. Keep case/project/engine identities authoritative in `scripts/test-inventory.json` and `scripts/verify-test-results.mjs`; counts belong to revisions.

| Purpose                               | Existing command                       |
| ------------------------------------- | -------------------------------------- |
| Source ownership/graph/CSS/design     | `npm run check:source`                 |
| Runtime/lock/workflow policy          | `npm run check:policy`                 |
| Tooling negatives                     | `npm run check:tooling`                |
| Installer negatives                   | `npm run check:installer`              |
| Formatting                            | `npm run format:check`                 |
| Semantic lint and strict types        | `npm run lint` and `npm run typecheck` |
| Unit/component/service                | `npm test`                             |
| Complete non-browser/export gate      | `npm run verify:code`                  |
| Fresh build and complete browser gate | `npm run verify:browser`               |
| Combined gate, one build              | `npm run verify`                       |

- Codex Cloud may prepare browsers, run Playwright and inspect screenshots/traces/internal previews. This supersedes the former user-only browser execution rule. Physical-device acceptance stays with YS/client.
- Use meaningful affected checks during iteration. Full PR/main CI remains required. For a substantial integrated Cloud run use `npm run verify` once, not separate code/browser gates followed by another identical full run.
- A focused browser command needs a fresh build and free preview port. Do not use stale output or report a selected case as the whole matrix. Keep retries/skips at zero and all applicable projects intact.
- Docs-only changes need document/link/diff integrity and affected tooling checks. They do not need repeated full application runs; the unchanged required PR CI still runs.
- Retain commands, versions, source/configuration fingerprints, exits, per-case logs and failure traces. Preserve nonzero exits through log capture. Setup/network failure is not a passing or skipped test.

### User preview acceptance

The retained smoke's internal demo preview is scoped to its container lifetime. The repository's static server binds `127.0.0.1:4173` and uses `/SoccerBotStudioSG/`; it is not exposed by the restoration runner. Host `npm run build`/`npm run preview` is not the reusable Docker restoration procedure.

- Resume user preview verification only when a supported Cloud forwarding surface is available. Record the actual URL, source revision, base path, demo mode and lifetime; verify Home, Studio and a direct booking route.
- Leave preview acceptance blocked until that evidence exists. Do not change network mode, publish ports, launch a permanent process or provision hosting as an implicit part of restoration.
- Stop manual preview/dev processes before any separately authorized verification; the browser harness owns port 4173 and refuses reuse.
- Existing GitHub Pages deploys merged main only. It is not a PR preview. New isolated preview hosting requires a separately reviewed task; never merge merely to obtain a preview.
- Cloud/CI browser evidence does not replace YS/client physical-device acceptance or live-provider evidence.

### Exact-revision local review proposal — user-run only

No supported Cloud forwarding surface has been established. YS has now chosen deployed main for application inspection; identify its exact deployed SHA and demo mode when recording observations. Inspection is pending, and Pages is not a Cloud feature-PR preview. The optional isolated local walkthrough below is retained for exact-revision diagnosis; it has not been executed on YS’s computer.

1. In the existing local repository, inspect branch/HEAD/index/working tree and preserve all work. Fetch the branch containing the agreed review SHA; verify that full SHA exists. Create a **new detached worktree at that SHA** in an unused sibling directory. Never switch/reset the working checkout or overwrite an existing review directory.
2. Require Node 24.19.0 and npm 11.9.0. Reuse an existing dependency installation only when its package/lock bytes match the review checkout; an absolute `node_modules` symlink in the new worktree can reuse that installation. If matching dependencies are unavailable, stop and report the local preparation blocker rather than implicitly reinstalling or changing the original checkout.
3. In the review worktree, confirm `git rev-parse HEAD` equals the full PR candidate and `git status --short` is clean. Build with process-scoped `NEXT_PUBLIC_BASE_PATH=/SoccerBotStudioSG npm run build`, then run `npm run preview`. Open `http://127.0.0.1:4173/SoccerBotStudioSG/` locally; this serves only while the command runs. No hosting, provider or deployment operation is involved.
4. Review Home/Studio and the guest booking journey with synthetic contact details. On today's Singapore date, elapsed times must be disabled for new selection. Future dates/multiple sessions remain usable. A selected slot crossing its start must stay in the basket, visibly labelled and removable, with Continue blocked. Restored stale drafts follow the same rule; confirmed paid records remain confirmed.
5. For an exact-boundary walkthrough without waiting for wall time, stop the manual preview so port 4173 is free. With the already installed browser runtime, the user may run `./node_modules/.bin/playwright test tests/customer.spec.ts --grep '(^| )elapsed selections' --project=desktop-chromium --debug` against that fresh build and step through the controlled-clock regression. Its advancing timer exercises before/at/after start and future multi-session payment. This optional visual walkthrough is distinct from the required full three-project CI and physical-device acceptance.
6. Record the reviewed SHA, local URL/base path, demo mode, browser/device, observations and explicit acceptance or defects. Stop the preview afterward. Visual acceptance remains a separate record even though YS merged PR #6; it is not inferred from opening a URL or green automation.

## 5. Efficient Ralph runs

- Treat Ralph as a bounded work cycle: read the small state files, choose one ready task, implement, verify, checkpoint, stop. No perpetual process is installed.
- A North Star states one milestone outcome, exclusions, objective evidence and stopping point. Do not use “finish SoccerBot” or the entire production roadmap as one autonomous run.
- The task ledger is the only queue. Each entry has a completion test, state and next action. An unresolved external dependency becomes a blocker, not a reason to spin or change goals.
- Reuse discovered owner paths and previous evidence. Search only relevant code/contracts; carry forward a concise diagnosis. Re-read after relevant changes or contradictory evidence.
- Run focused checks after each material fix and the complete required CI once the candidate is ready. Reuse an existing run for the same commit; do not start duplicate full suites or repeatedly poll while waiting.
- Stop a repeated failure when there is no new diagnosis or useful next experiment. Do not cycle model prompts, add speculative tools or increase test retries.
- Keep a single working agent by default. Delegate only when explicitly requested and when the split would avoid duplicated investigation; no standing swarm or heartbeat is part of this setup.
- Do not automatically escalate model size/reasoning for routine edits. Select a more expensive configuration only for an identified need and within the task's agreed limits.
- Before enabling unattended orchestration, specify finite run/time/spend limits and a resume policy. No numeric cost promise or billing cap is claimed by these Markdown rules; enforcement belongs in the actual runner/account controls.

## 6. Review and release boundary

- Review intended source/docs and checks, checkpoint the feature branch and open/update its PR. Keep it draft while required acceptance is blocked. Consume existing CI for the same final commit; do not launch duplicate suites.
- Stop at PR-ready. Keep each new task PR draft/unmerged until YS explicitly approves merging that specific PR. Requests to continue, synchronize main, publish a PR or obtain green checks are not merge approval. Never enable auto-merge. Main independently verifies an approved merged revision and its existing Pages deployment consumes the tested artifact; this is outside the Cloud loop.
- Never broaden repository permissions, change branch protection, provision paid services or mutate protected infrastructure merely to complete the loop. Record a concrete blocker instead.
- The client `soccerbotstudio` account remains read-only. The account going live on 7 October does not authorize the custom website's cutover, synthetic customer bookings or real charges.
- Remaining provider tests belong to M2.1–M2.5: account entitlement/quota and field/price mapping, synthetic customer matching, shared-capacity/changeover contention, native SimplyBook → SBPay → HitPay checkout, status/reconciliation and limited confirmed-unpaid cleanup. Exact supported operations must be proved; no independent payment bypass or blind write retry.
- Authorized release work later uses reviewed Cloudflare operators, named environment bindings, compatible migrations, artifact identity and recovery evidence. No such production operator is claimed implemented now.

## 7. Completion receipt

Record in Progress and the PR: source SHA, intended diff, commands/environment/results, final-commit CI URLs, preview revision/mode, limitations and next action. Move completed milestone evidence to Journey. A fresh task must resume from these files without reconstructing this chat.

OneFitfinity source: [latest reviewed Cloud workflow commit](https://github.com/LimYouSheng/FitfinityReact/tree/16eea945f9324b6f20610d0a0b98b1a1cb6014e9). Its efficient Ralph section is retained with the project name adapted. SoccerBot's existing pins, gates, provider boundary and deployment model replace Fitfinity-specific details.

## Developer API prerequisite check — 7 October 2026

The earlier missing-variable/attachment and proxy failures are retained in Journey and Service Contracts. Fresh outer-task checks now find both `SIMPLYBOOK_DEV_COMPANY_LOGIN` and `SIMPLYBOOK_DEV_API_KEY` present. Managed revision 4 reports current observations, both bindings ready and restricted network policy enforced; the secret binding and local version-1 policy include `user-api.simplybook.me`. Unknown labels from the earlier observation did not prove saved settings were missing. Environment identity/version and sanitized diagnostics are retained in the current Progress evidence folder.

One unauthenticated `HEAD https://github.com/` passed (HTTP 200, curl exit 0, no redirects/retries) through the inherited HTTPS proxy with TLS verification. Git fetch then passed. The task-local invocation used the supported shell tool's explicit network permission; it did not replace the proxy, bypass policy or change the environment. Connector access alone is not shell-network evidence. Distinguish proxy DNS/connection errors, destination denial, TLS failure and remote HTTP/API errors without logging request headers or response bodies. A local Docker-socket check was denied; Docker is unnecessary for this provider path and no daemon/container configuration was changed.

Run provider diagnostics in the outer task with the inherited proxy and CA trust. The historical browser-smoke container is intentionally network-disabled and forwards build/cache variables only; never use it as a provider-access test or relax its guards. Presence-only credential checks must not print, hash, transform or persist secret values. A nonempty network-secret placeholder is valid and must be sent unchanged for substitution. Returned tokens stay in process memory only.

Check previous execution receipts and concurrent task ownership before dispatch. Confirm the intended developer company independently of credential presence; do not infer identity from a variable name. The configured login differed from the historical canonical developer label and was not the recorded client login. YS explicitly confirmed the configured login as the intended developer account; no value was changed or displayed. The subsequent real calls passed: **getToken 1, getEventList 1, getUnitList 1; cumulative 3/3**, with no retries or client substitution. The original allowance is exhausted; do not rerun this check. Catalogue access is not sandbox/payment/isolation acceptance.

The completed allowance used exactly one each, sequentially: public JSON-RPC `getToken(companyLogin, apiKey)` at `https://user-api.simplybook.me/login`, then `getEventList` and `getUnitList` at the documented public root endpoint using `X-Company-Login` and `X-Token`. Count failed dispatches; stop at the first account, authentication, network or schema mismatch. Do not follow redirects, switch API family, retry or use a connected SimplyBook tool. Keep only approved service/provider IDs, names, relevant eligibility/mappings and counts; discard raw responses and contact/internal fields. If a probe is needed, keep it server-only with a fixed host/method allowlist, one-use dispatch accounting and meaningful offline redaction/budget checks. The small private server probe and four meaningful offline checks are retained in `/workspace/work/developer-api-cloudflare-2026-10-07/`, outside the application/repository. Its shared nonblocking lock and permanent one-use journal reserve each dispatch before network I/O and refuse replay after process loss. It performed only the three approved calls; no deployed diagnostic endpoint or new application tooling owner was added.

Reuse matching preparation. The historical `container.py smoke` enforces its original experiment checkpoint/branch; do not bypass that guard, reinstall/rebuild, or rerun a successful application suite for documentation publication. Focused document/source/policy checks and the new draft PR's final-commit CI verify this candidate. The deployed application remains demo-only. The old 14-request and conditional 15–17 estimates are superseded by the staged 16-request plan in Service Contracts; no execution is authorized. Current work is public-document research and owner-evidence reconciliation only, with zero additional provider-account calls. Existing-record discovery may observe schema/entitlements under a new approved budget; no account calls occur during preparation. Owner isolation/setup/inbox/reconciliation confirmations are accepted. Current attachment has only public RPC company/API-key bindings and allows `user-api.simplybook.me`; REST host `user-api-v2.simplybook.me`, admin authentication and local signing bindings are not established. Bind these through the managed environment before dispatch, without exposing values. Do not substitute the public API key as an API User Key or hash a network-secret placeholder. Creating a first User API Key changes password-authentication security persistently (Service Contracts D15); key creation/settings changes are excluded. No silent auth fallback, token refresh, redirects carrying credentials or proxy bypass.

The future Cloudflare release sequence and milestone ownership live in [Rules M6.4](SOCCERBOT_RULES_AND_ARCHITECTURE.md#m64--production-build-and-deployment-pipeline). That plan does not authorize workflow implementation, Cloudflare provisioning, secret installation, a hosting switch or deployment in this task.
