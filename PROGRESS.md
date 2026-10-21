# SoccerBotStudioSG current progress

## Current checkpoint — 21 October 2026 SGT

- Last verified deployed revision: PR80 merge cae29e68023bdfa3654978babdda5bb7c47a1d16; main run39544649935 succeeded and read-only health matched. Grafana export remains disabled; hookup deferred.
- PR81 remains unmerged. Head7a6ffb4 passed local226 frontend/431 Worker tests and all three CI gates in39550062232. It includes confirmation detail cleanup and focus/original-hold-expiry refresh. Current follow-up adds rejected-checkout readback and corrects the rejected-tab presentation. Final combined verify:code passed228 frontend tests plus source/policy/tooling/installer/format/lint/types/build/export. Worker runtime verification and final-commit CI remain pending.
- Owner waived stale unresolved-page retesting; retain as excluded, not proven fixed. Abandon/dismiss/return-to-selection was owner-reported successful. HAR17/18 plus owner dashboard show one booking from competing tabs, but the rejected tab incorrectly showed payment verification. Readback/customer messaging repair is the next acceptance gate.
- The separate hours-later confirmed-to-pending report remains undiagnosed without a retained capture. Performance/token-restoration testing is postponed. Preserve dependency symlinks, original HARs and failed test evidence.

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
