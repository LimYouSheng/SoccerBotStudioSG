# SoccerBotStudioSG engineering

## 1. Start

- Read `NORTH_STAR.md` and `PROGRESS.md`; confirm repository, branch, HEAD and existing changes.
- YS merged PR #7. Verified main is `e883c1af117a960eeae9359c4db9923d774888dd`; refresh actual main/evidence, create a new feature branch and preserve newer work. Main visual inspection is pending; CLOUD-01 preview acceptance remains blocked.
- GitHub is canonical for the reconciled source. Preserve unknown edits and keep experiment acceptance separate. Routine Cloud work does not require a Mac installer or user-run browser tests.
- Search relevant sections of `docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md` and `docs/SERVICE_CONTRACTS.md`; do not load all history.
- Active bounded objective: establish developer authentication/catalogue access and reconcile the planned Cloudflare backend/deployment responsibilities. The completed allowance permitted at most one each of `getToken`, `getEventList`, `getUnitList`, sequentially with no retries; count failed dispatches and stop on the first mismatch. Check retained usage and prevent concurrent execution. Both variables are present, supported connectivity passed and YS confirmed the configured developer identity despite the historical label mismatch. All three calls passed: cumulative usage is 3/3 and the allowance is exhausted; do not repeat them. No client calls, business writes or single-session proof execution. New work ends at a green draft PR; Rules owns the future backend/deployment plan, not implementation authorization.
- Commands/cutover: `docs/CODEX_CLOUD.md`. Provider findings: Service Contracts and the latest Journey entry.

## 2. Build

- Use one cloud feature branch. Edit canonical owners; remove superseded logic and avoid duplicate implementations.
- Separate UI, business rules, persistence and infrastructure. Production authority stays server-side.
- Preserve unrelated behaviour. Add meaningful coverage for changed behaviour.
- Fix routine failures autonomously; escalate requirement, business-rule, architecture, security or material-cost decisions.

## 3. Ralph loop

- Choose one ready task serving the North Star; define completion evidence first.
- Inspect → implement → run affected checks → diagnose → update progress → checkpoint.
- Reuse findings/caches and read changed sections. Retry only with a new diagnosis or material fix.
- Stop at task acceptance, a blocker, the run budget or PR readiness. No unattended relaunch without explicit finite limits.

## 4. Verify

- Run focused checks while iterating. Codex may prepare browsers, run Playwright and inspect internal previews.
- Require the exact GitHub Actions check `verify / frontend`, including desktop Chromium, phone WebKit and tablet WebKit. A fresh Cloud setup also needs its own scoped execution evidence.
- Never weaken assertions, skip coverage, lower required counts, add retries, raise timeouts or alter runner settings to obtain green results.
- Record SHA, command, environment and result. Separate cloud/CI, visual/device and live-provider evidence; blocked is not passed.

## 5. Deliver

- Update affected docs/progress; review the diff and stage exact intended paths.
- Commit/push the task branch and open/update its PR when access permits. Reuse existing CI; require green checks for the final commit.
- Stop at PR-ready. Provide the PR, evidence, preview or blocker, and next action. Never merge, enable auto-merge, push to `main`, deploy or alter protection in the loop. Every merge needs explicit user approval for that specific PR; requests to continue, synchronize main, publish a PR or obtain green CI are not merge approval.

## 6. Boundaries

- No reset, force push, destructive cleanup, real customer data, credential export or applied-migration edits.
- Client SimplyBook access remains read-only. Keep production secrets outside coding tasks; connected tools grant no extra authority.
- One North Star, one ledger, relevant context. No speculative tooling, background agents or duplicated full test runs.

- Preserve exact logos, header blue and typography in their canonical owners. Unsupported live operations never fall back to demo success.
- Local delivery retains guarded baselines, backups and distinct receipt/hash identities; verify final downloadable bytes, filename and command.
