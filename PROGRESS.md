# SoccerBotStudioSG current progress

## Current checkpoint — 21 October 2026 SGT

- Deployed baseline: PR79 merge3e74b10a8e96f81051c6c257d6c93a5c277f3f11; main run39530449830 passed all three gates and both deployment jobs. Refreshed health matches Worker versiond92b2c50-c092-476f-a627-e73cf4b65af8. PR80 backend telemetry preparation passed all three gates in39542179705 and was subsequently merged ascae29e68023bdfa3654978babdda5bb7c47a1d16; export remains disabled and unattached; owner will configure Grafana later.
- Current branch fix/confirmation-details includes current main with merged PR80. Remove duplicate expanded session/amount sections; show all sessions and total once above, client/location below and short full-width disclaimer. Full local verify:code passed223 frontend tests plus source/policy/tooling/installer/format/lint/types/build/export. Exact-commit CI and owner visual acceptance remain pending.
- HAR15 captures only recovery after reopening: same attempt and provider references, unchanged payment deadline and seven pending confirmation reads, all HTTP200. Initial checkout capture is missing, so original duplicate effects are not established. Unpaid-expiry result remains pending.
- Owner reports an hours-later confirmed page reverting to payment-received/confirmation-pending. Tab was closed; capture is deferred to a later successful-payment ride-along. No diagnosis or repair is claimed.
- Preserve dependency symlinks and failed evidence. Performance/cache-restoration testing remains postponed; no assistant browser or provider actions.

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
