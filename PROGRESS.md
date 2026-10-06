# SoccerBotStudioSG current progress

## Checkpoint — 6 October 2026

- North Star: `CLOUD-01`, an experiment; **not accepted or adopted**. Fresh Codex Cloud setup and a usable user preview are still pending.
- Base main: `0cea68168738c722d05be9d3580938b65a4860c7`, tree `61918e04933afd960358903a2aa152a0872c7024`, after YS merged [PR #5](https://github.com/LimYouSheng/SoccerBotStudioSG/pull/5). [Main CI 37485321460](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37485321460) passed verification and the existing Pages demo deployment.
- Main is protected; required context is `verify / frontend`, expected source GitHub Actions. The settings must remain enforced. Markdown and this ChatGPT plugin's ask-before-write setting do not enforce separate Cloud/CLI credentials.
- Experimental branch: `experiment/codex-cloud-workflow-2026-10-06`. Eight documentation changes only; application, assets, dependencies, workflow, installer tooling and test inventories match the base main. Its PR records the exact published head and CI result.
- The Mac checkpoint still records `fix/pages-deployment` at `12c174a98c97a5d7c7b0cd041c090e31a903e95b`. No new Mac pull, switch, index change or Cloud-doc installation has been performed.
- Baseline PR #4 was merged by the assistant without explicit user approval. Source identity and successful CI remain valid evidence, but they did not authorize that merge. Journey records the incident. Every future merge requires explicit approval for that specific PR.

## Task ledger

| ID  | Task and completion evidence                                                                               | State                          | Next action                                                               |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| C1  | Adapt the actual OneFitfinity files; reconcile provider findings and current main; validate the eight docs | Prepared                       | Retain document checks and exact diff in this PR                          |
| C2  | Preserve the inspected Mac source on main, including later naming/protection changes                       | Source reconciliation complete | Retain PR #4 failure record and PR #5/main evidence                       |
| C3  | Publish the experimental PR, then verify a fresh Cloud task, pinned setup and scoped Playwright            | Ready for Cloud setup          | Follow section 3 of the Cloud guide on this branch                        |
| C4  | Final-candidate CI, usable user preview and completed CLOUD-01 receipt                                     | Pending C3                     | Record actual URLs/revisions and unmet criteria; keep experiment unmerged |

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

## Next run

Run C3 only on `experiment/codex-cloud-workflow-2026-10-06`. Read the Cloud guide, verify branch/HEAD/base ancestry and runtime pins, install or reuse matching dependencies, and run the existing scoped browser smoke against a fresh build. Record the actual environment result, logs and preview. Stop at the C3 outcome or a concrete blocker; do not start M2 integration or merge this experiment.

No repeated availability benchmark or client writes are needed. A fresh Cloud environment and user-accessible experiment preview remain unproved until their own evidence exists. This PR's publication and final-head CI live in its metadata to avoid a self-referential commit hash or repeated docs-only CI cycles.

## Update discipline

- Keep one current ledger, not a transcript. Move completed milestone summaries to Journey.
- Retain source identity, command, environment, result/count, log/workflow reference and limitations.
- Carry diagnoses and next actions forward. Revisit only when relevant evidence changes.
