# SoccerBotStudioSG current progress

## Checkpoint — 7 October 2026

- North Star: `CLOUD-01`, an experiment; **not accepted or adopted**. C3 runtime restoration is verified at the checkpoint below; usable user preview acceptance remains blocked.
- Base main: `0cea68168738c722d05be9d3580938b65a4860c7`, tree `61918e04933afd960358903a2aa152a0872c7024`, after YS merged [PR #5](https://github.com/LimYouSheng/SoccerBotStudioSG/pull/5). [Main CI 37485321460](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37485321460) passed verification and the existing Pages demo deployment.
- Main is protected; required context is `verify / frontend`, expected source GitHub Actions. The settings must remain enforced. Markdown and this ChatGPT plugin's ask-before-write setting do not enforce separate Cloud/CLI credentials.
- Experimental branch: `experiment/codex-cloud-workflow-2026-10-06`. Eight documentation changes only; application, assets, dependencies, workflow, installer tooling and test inventories match the base main. Its PR records the exact published head and CI result.
- The Mac checkpoint still records `fix/pages-deployment` at `12c174a98c97a5d7c7b0cd041c090e31a903e95b`. No new Mac pull, switch, index change or Cloud-doc installation has been performed.
- Baseline PR #4 was merged by the assistant without explicit user approval. Source identity and successful CI remain valid evidence, but they did not authorize that merge. Journey records the incident. Every future merge requires explicit approval for that specific PR.

## Task ledger

| ID  | Task and completion evidence                                                                               | State                                            | Next action                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| C1  | Adapt the actual OneFitfinity files; reconcile provider findings and current main; validate the eight docs | Prepared                                         | Retain document checks and exact diff in this PR                                  |
| C2  | Preserve the inspected Mac source on main, including later naming/protection changes                       | Source reconciliation complete                   | Retain PR #4 failure record and PR #5/main evidence                               |
| C3  | Publish the experimental PR, then verify a fresh Cloud task, pinned setup and scoped Playwright            | Runtime restoration verified                     | Retain the exact checkpoint/evidence below; reconcile PR metadata in C4           |
| C4  | Final-candidate CI, usable user preview and completed CLOUD-01 receipt                                     | Committed-candidate CI verified; preview blocked | Retain checkpoint CI; require handoff-commit CI in PR #6; preview remains blocked |

## C3 runtime restoration evidence — 7 October 2026

- Verified reviewed checkpoint: `experiment/codex-cloud-workflow-2026-10-06` at full HEAD `897cbfe737d31069ae25dca39c638cdededf3593`; base `0cea68168738c722d05be9d3580938b65a4860c7` ancestry passed. Source and index were clean and unchanged throughout verification. This recorded restoration predates the documentation handoff; it does not claim a new smoke-tested revision.
- Command: `python3 /workspace/soccerbot-cloud-container/container.py smoke`. Original successful evidence: `/workspace/soccerbot-cloud-evidence/container-smoke-cb1zpd4r/`, including `receipt.json`, `source-and-variables.json`, `image.json`, `container-smoke.log`, `validation.json` and `test-results/`. Exit 0; policy and fresh application build passed; exactly 3 passing cases: `desktop-chromium`, `phone-webkit`, `tablet-webkit`, with zero failures, skips, retries or flaky results.
- Retained runtime: Node `24.19.0`, npm `11.9.0`, Python `3.11.2`, Playwright `1.58.2`; Docker `28.4.0`, `vfs`, network-disabled smoke container. Preparation key `8c9b6fadfc4cfa4319895a630f940fae8569e76a0dbc6cdf103e76db1c8d6a0a` and image `sha256:f574dd94b351dfcb0cb769d9a541d37bc5d3246f054d2a88598ba5365df3e76c` matched. Existing image reused; no archive load, package reinstall, runtime image rebuild or installer execution.
- Inherited variables matched: `NEXT_PUBLIC_BASE_PATH=/SoccerBotStudioSG`, `npm_config_cache=/workspace/soccerbot-cloud-cache/npm`, `PLAYWRIGHT_BROWSERS_PATH=/workspace/soccerbot-cloud-cache/browsers`.
- Preserve original receipts unchanged, including the initial Docker socket sandbox failure at `/workspace/soccerbot-cloud-evidence/container-smoke-pkwfxnog/receipt.json`. The successful runner receipt retains its generic `C3_restoration: not established by this run` field; this progress record records the fresh-task restoration conclusion from the successful evidence, without rewriting the receipt.
- User preview acceptance remains **blocked**: this task exposes no supported Cloud forwarding surface. The harness binds `127.0.0.1:4173` inside its network-disabled ephemeral container, publishes no host port and stops the preview after tests. Mode is demo only, base path `/SoccerBotStudioSG`; no user-accessible candidate URL is established. Existing merged-main Pages is not an experiment preview.
- This is scoped restoration evidence, not full final-candidate CI, physical-device/provider acceptance or completed CLOUD-01 acceptance. No push, merge, deployment or provider call occurred.

## C4 evidence review — 7 October 2026

- Existing [PR #6](https://github.com/LimYouSheng/SoccerBotStudioSG/pull/6) is open, draft and unmerged. At review, the head was `897cbfe737d31069ae25dca39c638cdededf3593` on `experiment/codex-cloud-workflow-2026-10-06`, matching local HEAD and the C3 checkpoint. Its eight committed changes are documentation only.
- [Verify run 37487829838](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37487829838), attempt 1, is completed/success and explicitly associates PR #6 with that exact `head_sha`. Required [job `verify / frontend`](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37487829838/job/112352423751) is completed/success. Current main protection reports that required context from GitHub Actions (app ID `15368`). No pending or failed required check was observed; the separate `deploy` job and verified-site deployment upload were correctly skipped for this PR.
- Checkout identity: the job log records GitHub's temporary PR merge commit `9b9bb1e06d8a693deb913c670b5a41db37078a37`, whose parents are base `0cea68168738c722d05be9d3580938b65a4860c7` and candidate `897cbfe737d31069ae25dca39c638cdededf3593`. GitHub Git commit reads confirm both the tested merge and candidate have the exact tree `a3787ccdfdbd4f5142c44aecb9b3f0e12f847c60`. The checkout SHA differs as expected for PR CI; there is no candidate/content mismatch.
- Existing job logs confirm the full `npm run verify` gate: source/policy, 83 tooling tests, 56 installer tests (27 + 29), formatting, lint, types, 43 unit/component/service tests, build/11-route export and 42 browser executions passed. The matrix includes desktop Chromium, phone WebKit and tablet WebKit; unit/browser identity and zero-skip/retry validation passed. C3's three-test smoke is separate scoped restoration evidence, not this full CI evidence. No checks were rerun for this review.
- At review, remote main remained `0cea68168738c722d05be9d3580938b65a4860c7`; comparison reports the candidate 1 commit ahead and 0 behind, and PR metadata reports mergeable. No base-branch update is currently needed. The then-uncommitted `PROGRESS.md` additions were outside that tested/published candidate. The documentation handoff below requires new final-candidate CI; the old green result is not attributed to the later edits.
- Remaining acceptance gates: usable candidate preview is still blocked for the C3 reason above; the PR text at review still described fresh Cloud setup/execution as pending. The authorized documentation handoff below supersedes that stale description. The completion receipt/evidence handoff and any later committed candidate's CI must be reconciled before CLOUD-01 acceptance. No new hosting/deployment is authorized. Physical-device and live-provider acceptance remain separate; this review closes neither.
- That review was recorded locally only. The earlier uncommitted C3 progress entry, index, original successful/failed C3 receipts and logs were preserved. No reinstall, test rerun, commit, push, remote PR write, merge or deployment occurred.

## Preparation evidence

- Latest OneFitfinity comparison: PR #8 head `16eea945f9324b6f20610d0a0b98b1a1cb6014e9`, based on main `7970f65b5975a6554c46eb521c7ca118939e4bb9`. Re-read its four entry/Cloud files and the relevant canonical docs/runbook sections. Its six-section AGENTS, CLOUD-01 structure, C1–C4 ledger and efficient Ralph section are retained with SoccerBot-specific owners, commands and evidence. The original `821005d50c764134865af8f00ae4aa561260b878` adaptation remains historical in Journey.
- The isolated preparation baseline independently matches all 121 Git blob hashes/modes from latest main. Five existing documents change and three supporting documents are added; the other 116 files remain identical. Original author work and Mac Git state are separate.
- The uploaded read-only Mac checkpoint SHA-256 is `a896ceb7d09e88dd44ded1425031d7fc90702364ce6b59cf3128db692818d431`. Its 121-file candidate map is `d214f552d5cfd3e566215bc706bff498613cd7215cc14d9345cf318f760a1d29`. That source evidence is distinct from application test evidence.
- Baseline [PR #4 CI](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37472774833) and [main CI](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37473537272) passed. Naming [PR #5 CI](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37483534106) passed 83 tooling, 56 installer, 43 unit/component/service and 42 browser cases. These historical runs do not replace this experiment's final-head CI.
- Before publication, validate Markdown formatting, relative links/fences, the 44 stable milestone headings, branch/base guards and the exact docs-only diff. Do not repeat application suites locally for these documentation edits. Keep full PR CI enabled.

## Provider evidence and remaining work

- Client public catalogue, timezone, timeframe, work-calendar envelopes, 1/7/31-day availability and sampled end-time reads were exercised. Read-only discovery is sufficient to proceed with this source transition.
- Latest R2: 51/51 calls passed, no retries, 268 offered starts unchanged between snapshots, 16 offered end-time samples all 50 minutes. No off-grid starts, closing violations or starts less than 50 minutes apart in that snapshot.
- `calculateEndTime` returned ends for 10 starts absent from both availability snapshots; 10 other absent starts returned null. It is not an availability validator. Null remains unresolved, not free or bookable.
- M2.1/M2.2 remain partial. Booking-level one-studio/10-minute-buffer enforcement, client price/player/intake mapping, verified customer matching, native payment entitlement/association/status and recovery remain open. No live adapter exists.
- Direct-Mac API timing is exploratory B1 evidence, not browser → Worker latency acceptance. See Rules for measured values and unchanged P01–P12 gates; Journey owns receipt hashes.

## Documentation handoff — 7 October 2026

The user authorized committing/pushing only the intended documentation to existing draft PR #6 and updating its description. This handoff preserves the C3/C4 findings above and replaces obsolete host-install instructions in `docs/CODEX_CLOUD.md` with the verified retained Docker reuse procedure. Original C3 receipts/logs remain unchanged; runtime assets, application code, dependencies, tests, workflows and environment settings are outside the diff. Documentation formatting, relative links/fences and exact diff are checked locally; successful local application suites are not repeated.

The resulting final commit and its matching `verify / frontend` run are recorded in [PR #6](https://github.com/LimYouSheng/SoccerBotStudioSG/pull/6) after publication, avoiding a self-referential commit or another docs-only CI cycle. Require that new commit's check to pass; run `37487829838` remains evidence for the earlier checkpoint only. Keep the PR draft and the experiment unmerged. Publication does not close the blocked preview criterion or authorize environment changes, providers, merge or deployment.

## Next run

Read PR #6's final head and matching required CI result before resuming. C3 restoration is verified; C4 overall remains blocked by user preview acceptance. Next action is to obtain a supported candidate-preview surface, then verify Home, Studio and a direct booking route with revision, demo mode and lifetime. Do not repeat successful suites, substitute merged-main Pages, introduce preview deployment or mark CLOUD-01 accepted while this criterion is unmet. Physical-device and provider acceptance remain separate.

## Update discipline

- Keep one current ledger, not a transcript. Move completed milestone summaries to Journey.
- Retain source identity, command, environment, result/count, log/workflow reference and limitations.
- Carry diagnoses and next actions forward. Revisit only when relevant evidence changes.
