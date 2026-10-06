# SoccerBotStudioSG Codex Cloud workflow

Updated 6 October 2026 against OneFitfinity PR #8's `docs/CODEX_CLOUD.md`, `NORTH_STAR.md`, `PROGRESS.md` and `AGENTS.md` at `16eea945f9324b6f20610d0a0b98b1a1cb6014e9`, after its main advanced to `7970f65b5975a6554c46eb521c7ca118939e4bb9`. The source-cutover, C1–C4 ledger, six-section agent checklist, bounded Ralph loop and receipt conventions follow that current reference. SoccerBot retains its own runtime, commands, provider contracts and release boundaries. Cloud activation remains unverified.

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
- Base main: `0cea68168738c722d05be9d3580938b65a4860c7`, after YS merged naming PR #5. Main CI `37485321460` passed verification and the existing Pages demo deployment.
- Experiment branch: `experiment/codex-cloud-workflow-2026-10-06`. The PR records its exact published head. Keep it unmerged, including after CLOUD-01 acceptance.
- The original Mac source was inspected and synchronized in PR #4, but its merge was unauthorized. Journey preserves that incident. No new Mac pull, branch switch or Cloud-document installation is claimed.
- Required status check: `verify / frontend` from GitHub Actions. Preserve the inherited workflow and repository protections.

Routine Cloud development uses the reviewed GitHub branch directly. A Mac installer and local provider login are not prerequisites. Optional Mac updates still use the existing guarded delivery/source checks and preserve new local edits.

Before a task changes source, read branch, HEAD, diff and the PR's current head. Confirm the base main above is an ancestor. If the Cloud checkout starts on main or a detached revision, select/attach the experiment branch after checking for existing work; never reset, clean, force push or discard changes. If main advances, inspect the delta and integrate it on the experimental branch without overwriting concurrent work. Refresh the recorded base/evidence as needed.

Publishing this experiment and passing checks do not authorize merging it. Every future merge needs explicit user approval for that specific PR. The ChatGPT GitHub plugin's ask-before-write setting is separate from any Cloud/CLI credential; Markdown is not a technical permission control.

## 3. Cloud environment setup

The following setup is prepared, not yet executed in the user's Codex Cloud environment. [Current Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments) use Install script and Start skill controls. The [legacy interface](https://learn.chatgpt.com/docs/environments/cloud-environment) exposes setup and maintenance scripts. Use the controls shown in the actual UI and record which was configured.

### Create the environment

1. Open **Settings → Codex Cloud → Environments → Create environment** (or **Work in → Cloud → Create environment**).
2. Select `LimYouSheng/SoccerBotStudioSG`; name the environment `SoccerBotStudioSG experiment` and keep it private.
3. Use `experiment/codex-cloud-workflow-2026-10-06` for the experiment. Where a branch selector is absent, give setup the prompt below and require it to confirm the checkout before reading the experiment instructions or changing source.
4. Configure the network and persistent variables below. Supply no provider/deployment credentials for this demo task.
5. Review the prepared install/start controls and the actual smoke-test results. Publish the environment only after setup succeeds, then launch a **new task** to verify C3. Environment publication is not application deployment.

### Runtime and network

| Setting                     | Required value or treatment                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| Node                        | `24.19.0`, owned by `.nvmrc`; explicitly prepare this runtime if the image differs                     |
| npm                         | `11.9.0`, owned by `package.json`; never change the repository pin to fit the image                    |
| Python / Git                | Python `3.11+` and Git                                                                                 |
| Playwright                  | Lockfile-pinned `1.58.2`, Chromium and WebKit; retain all three configured projects                    |
| Internet                    | Enabled with the Package managers preset; legacy UI calls its corresponding preset Common dependencies |
| Additional download hosts   | `nodejs.org`, `registry.npmjs.org`, `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`     |
| Provider/deployment secrets | None for CLOUD-01                                                                                      |

The browser hosts come from the installed pinned Playwright registry implementation. A redirect or image-specific dependency host may need a targeted addition after observing the actual failure. Preserve TLS verification and lockfile integrity. Do not use unrestricted networking, alter tests, or claim browser readiness merely because a download command succeeded. Service authorization remains separate from network reachability. See [legacy internet controls](https://learn.chatgpt.com/docs/cloud/internet-access) if that interface is in use.

SoccerBot has no Docker, PostgreSQL or AWS backend gate. Keep the existing demo adapters. Worker/D1/provider checks arrive with their implemented owners in later milestones.

### Persistent environment variables

Add these in environment settings so setup and later tasks agree. The example assumes the checkout is `/workspace/SoccerBotStudioSG`; inspect and substitute the actual repository path if it differs. Cache directories must be writable by the task user.

| Key                        | Value                                       |
| -------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_BASE_PATH`    | `/SoccerBotStudioSG`                        |
| `npm_config_cache`         | `/workspace/soccerbot-cloud-cache/npm`      |
| `PLAYWRIGHT_BROWSERS_PATH` | `/workspace/soccerbot-cloud-cache/browsers` |

### Installation and one setup smoke test

Paste this into the Install/setup script after preparing the exact runtime. It intentionally works when a legacy cache is initially prepared on main; the experiment branch guard belongs to the source-editing task, since legacy setup may run before the task's branch checkout.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /workspace/SoccerBotStudioSG
git merge-base --is-ancestor 0cea68168738c722d05be9d3580938b65a4860c7 HEAD
test "$(node --version)" = "v$(cat .nvmrc)"
test "$(npm --version)" = "$(node -p 'require("./package.json").packageManager.split("@")[1]')"
python3 -c 'import sys; assert sys.version_info >= (3, 11)'
test "${NEXT_PUBLIC_BASE_PATH:-}" = /SoccerBotStudioSG
test -n "${npm_config_cache:-}"
test -n "${PLAYWRIGHT_BROWSERS_PATH:-}"
mkdir -p "$npm_config_cache" "$PLAYWRIGHT_BROWSERS_PATH"
npm ci
./node_modules/.bin/playwright install chromium webkit
npm run check:policy
npm run build
./node_modules/.bin/playwright test tests/customer.spec.ts --grep '^public routes remove staff access and fit the viewport$'
```

This smoke selects one existing case across all three projects: expected **3 passed**, with zero skips/retries. It is not the 42-execution full browser gate. The harness starts/stops its own internal preview. Keep the first failed setup logs and repair the identified environment cause.

Use the image's existing browser system libraries first. Do not assume sudo/root or run `install --with-deps` by default in a non-root Cloud image. If a browser launch identifies missing native libraries, report the exact missing dependency and use a supported environment provisioning path; do not remove WebKit or modify runner flags to make the probe pass. Runtime/cache/network failures remain setup blockers.

For legacy maintenance, leave the field empty for this initial unchanged-lockfile experiment. At task start, verify runtime pins, installed dependency versions and browser paths; reuse only matching preparation. A changed lockfile/runtime/browser pin requires deliberate environment refresh, not silent reliance on a stale cache. Current environments also need republishing when reusable setup changes. Shell-only exports are not a substitute for the persistent variables above.

### Setup prompt / Start skill instructions

```text
Prepare LimYouSheng/SoccerBotStudioSG on
experiment/codex-cloud-workflow-2026-10-06, based on main
0cea68168738c722d05be9d3580938b65a4860c7. Inspect existing work before
selecting the branch. Read AGENTS.md, NORTH_STAR.md, PROGRESS.md and
docs/CODEX_CLOUD.md from that branch. Preserve the source and CI.
Prepare Node 24.19.0, npm 11.9.0, Python 3.11+ and the pinned dependencies
and Chromium/WebKit engines. Use the guide's persistent cache variables
and selected three-project smoke. Record actual branch/SHA, versions,
commands and results. Do not weaken a failed gate or assume root access.
At task startup recheck source/runtime/cache readiness. Start no permanent
preview process: Playwright owns port 4173 during tests. A requested user
preview must use a supported Cloud forwarding surface and show this
revision, base path and demo mode. Report a concrete blocker if unavailable.
Use synthetic demo data only. Keep the experiment unmerged. Do not enable
auto-merge, push main, change protection, call providers or deploy the app.
```

### First fresh Cloud task

After publishing the environment, select it and the experiment branch. Use:

```text
Execute C3 only for CLOUD-01 on
experiment/codex-cloud-workflow-2026-10-06. Read AGENTS.md, NORTH_STAR.md,
PROGRESS.md and docs/CODEX_CLOUD.md. Verify branch/HEAD and base ancestry,
then prove a fresh task can reuse the pinned setup and pass the selected
three-project Playwright smoke against a fresh build. Provide a usable
preview of this revision if supported; otherwise record the exact blocker.
Update the existing ledger/PR with evidence, preserving failures and
unrelated changes. Stop at C3 acceptance or a blocker. Do not implement
M2 features, call SimplyBook/HitPay, merge, enable auto-merge or deploy.
```

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

### Internal preview and optional local viewing

```bash
npm run build
npm run preview
```

The existing static server uses `http://127.0.0.1:4173/SoccerBotStudioSG/`. `npm run dev` provides development at `http://localhost:3000/SoccerBotStudioSG/`. Inspect the server's binding and supported Cloud forwarding before claiming a remote URL. A localhost address or running process alone is not a clickable user preview.

- Record the actual preview surface/URL, source revision, base path, demo mode and lifetime. Verify Home, Studio and a direct booking route. Leave preview acceptance blocked if it is unavailable.
- Stop manual preview/dev processes before verification; the browser harness owns port 4173 and refuses reuse.
- Existing GitHub Pages deploys merged main only. It is not a PR preview. A new isolated preview-hosting workflow requires a separately reviewed task; never merge merely to obtain a preview.
- YS can occasionally watch local headed Playwright. After a fresh export, run `./node_modules/.bin/playwright test --project=desktop-chromium --headed`. That selected view does not replace full CI or physical phone/tablet checks.

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
- Stop at PR-ready. Keep the experiment unmerged until YS explicitly approves merging that specific PR. Requests to continue, synchronize main, publish a PR or obtain green checks are not merge approval. Never enable auto-merge. Main independently verifies an approved merged revision and its existing Pages deployment consumes the tested artifact; this is outside the Cloud loop.
- Never broaden repository permissions, change branch protection, provision paid services or mutate protected infrastructure merely to complete the loop. Record a concrete blocker instead.
- The client `soccerbotstudio` account remains read-only. The account going live on 7 October does not authorize the custom website's cutover, synthetic customer bookings or real charges.
- Remaining provider tests belong to M2.1–M2.5: account entitlement/quota and field/price mapping, synthetic customer matching, shared-capacity/changeover contention, native SimplyBook → SBPay → HitPay checkout, status/reconciliation and limited confirmed-unpaid cleanup. Exact supported operations must be proved; no independent payment bypass or blind write retry.
- Authorized release work later uses reviewed Cloudflare operators, named environment bindings, compatible migrations, artifact identity and recovery evidence. No such production operator is claimed implemented now.

## 7. Completion receipt

Record in Progress and the PR: source SHA, intended diff, commands/environment/results, final-commit CI URLs, preview revision/mode, limitations and next action. Move completed milestone evidence to Journey. A fresh task must resume from these files without reconstructing this chat.

OneFitfinity source: [latest reviewed Cloud workflow commit](https://github.com/LimYouSheng/FitfinityReact/tree/16eea945f9324b6f20610d0a0b98b1a1cb6014e9). Its efficient Ralph section is retained with the project name adapted. SoccerBot's existing pins, gates, provider boundary and deployment model replace Fitfinity-specific details.
