# SoccerBotStudioSG current progress

## Current checkpoint — 21 October 2026 SGT

- Baseline: PR78 merged as 69945cc4ecae4593799f7205beedbc82513f9945. Tested PR head acc82ec11bb00dbcf26a4de322d31e8998ca7cec; owner handoff records all three PR gates passed in run39481563606. Remote main was fetched at that merge for this task.
- Refreshed main evidence: [run39520056195](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/39520056195) passed all three verification gates and both deployment jobs. Read-only health confirms merge69945cc4 and Worker versione8f92c4a-64d8-4a9b-b0c3-a539c17581c2. This is deployment evidence, not performance/provider acceptance.
- PR78 local validation reported424/424 Worker and223 frontend tests plus source/policy/types/lint/build/export. These belong to that candidate, not the current edits.
- Current branch: polish/confirmation-docs-test-audit. Scope: concise documentation, confirmation presentation and test-suite audit. Full local verify:code passed223/223 frontend tests, tooling/installer, source/policy, format/lint/types and build/export. PR79 run39525183294 passed live-email but failed frontend/backend on the same obsolete navy confirmation-heading assertion across all three devices (72/75 browser cases passed in each). The test-only correction keeps navy on other headings/header and explicitly checks the approved confirmation/tick colours. Final repaired-commit CI and owner visual acceptance remain pending; this branch is not merged/deployed.
- The recovered workspace contained an older clean checkout. The previous worktree and its uncommitted files were absent; its batch-atomicity reminder is incorporated from the owner handoff. The original checkout and its dependencies remain untouched; the new worktree uses a symlink to a separate install of the exact package lock, because the old cache lacked Worker tooling.

## Implemented baseline and evidence limits

Single checkout and successful reconciliation each use5 D1 round trips. Successful batch checkout uses2×sessions+7:11/15/23 for2/4/8 sessions, excluding coordinator SQLite. Not an absolute minimum or a cap on recovery. PR78 preserves individual durable claims, raw evidence, complete batch validation, payment URL persistence and original deadlines.

Public/admin token records persist encrypted in account Durable Object SQLite with original50-minute/60-second retention and family-specific invalidation. Simulation covers restart, expiry, isolation and tamper rejection; actual deployed restoration remains unverified. Hometest07's misses roughly six minutes apart do not prove their cause.

The owner accepts observed confirmation presentation around4–5 seconds. Performance and live cache acceptance are postponed.

Four-hour cutoff rechecked: BOOKING_LEAD_MINUTES=240 in the deployed baseline; calendar/selection and server checkout use it. Existing boundary regression accepts exactly four hours and rejects less, including crossing the cutoff during reads.

## Outstanding acceptance

| Work                                                                                                           | Gate / milestone                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Actual single/batch checkout and token restoration after restart/eviction                                      | Later M4.6/M5 performance acceptance; verify deployment first                                              |
| Later-item rejection, failed/lost batch closure, partial effects and recovery; no payment for incomplete batch | M4.4–M4.6; studio-capacity settings do not prove atomicity                                                 |
| In-flight payment settling after expiry                                                                        | M5.4; retain5-minute buffer,8-minute payment and15-minute hold                                             |
| Abandonment, lost replies, delayed/duplicate/out-of-order webhooks, reopen/tabs and failed dismissal           | M4.6/M5.3–M5.5; owner/CI evidence distinct from provider evidence                                          |
| Mixed browsing/checkout/recovery at1/3/5/10 simulated customers                                                | Deferred concurrency measurement; queue/rate/recovery/duplicate effects; separate lanes remain future work |
| Client mappings, schedules, notifications, payments and legacy continuity                                      | M6.3/M6.6 before M7 UAT                                                                                    |

See [milestone status](docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#milestone-status--21-october-2026) and [test audit](docs/SERVICE_CONTRACTS.md#test-suite-audit--21-october-2026). No M4/M5 closure or production acceptance is claimed.

## Update discipline

Keep this file current; record dated decisions, failures and verification in [Journey](docs/SOCCERBOT_JOURNEY.md). The [full prior progress ledger](docs/SOCCERBOT_JOURNEY.md#progress-ledger-archive--through-pr78) is retained there. Historical grants and unused budgets never authorize new activity.
