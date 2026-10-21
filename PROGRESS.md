# SoccerBotStudioSG current progress

## Current checkpoint — 21 October 2026 SGT

- Baseline: PR79 merged as3e74b10a8e96f81051c6c257d6c93a5c277f3f11. Final PR head e8989b4e61b9a58e5dc0f4855861ac744ca69ebc passed frontend/backend/live-email in run39528606402. Main run39530449830 passed all three gates and both deployment jobs. Read-only health confirmed that merge and Worker versiond92b2c50-c092-476f-a627-e73cf4b65af8. Owner visual/provider acceptance remains separate.
- Current branch: observability/backend-grafana. Prepare a separate, default-disabled Tail Worker exporting allowlisted diagnostics as OTLP traces and an importable Grafana dashboard. No Grafana stack or credentials configured; no deployment or producer attachment. Native automatic export is not enabled because it captures URL/SQL metadata outside the requested allowlist.
- Focused exporter checks passed7/7, including real workerd Tail delivery with only local missing scriptName metadata supplied by the test adapter. Checker negative fixtures passed10/10; source/policy checks passed. Full verify:code passed223 frontend tests plus tooling/installer/source/policy/format/lint/types/build/export. Worker runtime passed431/431; its wrapper initially rejected the new cases’ inventory placement, then the unchanged output passed the corrected exact-order check. Final-commit CI remains pending. Tail packaging dry run passed; no deployment.
- Acceptance experiments are paused for this task. Performance and deployed token-restoration acceptance remain postponed. Preserve the untracked dependency symlink and prior failed evidence; no provider actions occurred.

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
