# SoccerBotStudioSG current progress

## Current checkpoint — 21 October 2026 SGT

- PR81 merged asab478e0e926ac8b74a1f4157e99ca892691e942e. Main CI39559855205 passed; read-only health matched that revision and Worker1e01a671-3190-4513-9a6d-469fbd7028c3. Grafana export remains disabled.
- Draft PR82, branch fix/checkout-409-rejection extends preparation readback to409 while retaining recovery for an existing original write. Focused actual-Worker regressions passed2/2; full verify:code passed229 frontend tests plus static/tooling/types/lint/build/export checks. Full Worker run passed434/435; the sole failure was the obsolete zero-read assertion after a price conflict. Updated it to require one availability read and zero attempt/dispatch/booking/payment effects; repaired focused run passed3/3. Final-commit full CI pending.
- Owner accepts batch atomicity by risk decision after HAR19/20 and dashboard inspection showed no partial batch leftovers. Rejection before the first item remains possible; later-item rollback and failed/lost closure are not proven. Click-and-close-before-HitPay retained the reference/recovery view; owner confirms exactly one SimplyBook session. No duplicate observed. Owner accepts this click-and-close scenario; unpaid timeout and starting again were already observed in earlier tests and do not need repeating here.
- Owner waived stale unresolved-page retesting; retain as excluded, not proven fixed. Abandon/dismiss/return-to-selection was owner-reported successful. HAR17/18 plus owner dashboard show one booking from competing tabs, but the rejected tab incorrectly showed payment verification. Readback/customer messaging repair is the next acceptance gate.
- The separate hours-later confirmed-to-pending report remains undiagnosed without a retained capture. Performance/token-restoration testing is postponed. Preserve dependency symlinks, original HARs and failed test evidence.

## Implemented baseline and evidence limits

Single checkout and successful reconciliation each use5 D1 round trips. Successful batch checkout uses2×sessions+7:11/15/23 for2/4/8 sessions, excluding coordinator SQLite. Not an absolute minimum or a cap on recovery. PR78 preserves individual durable claims, raw evidence, complete batch validation, payment URL persistence and original deadlines.

Public/admin token records persist encrypted in account Durable Object SQLite with original50-minute/60-second retention and family-specific invalidation. Simulation covers restart, expiry, isolation and tamper rejection; actual deployed restoration remains unverified. Hometest07's misses roughly six minutes apart do not prove their cause.

The owner accepts observed confirmation presentation around4–5 seconds. Performance and live cache acceptance are postponed.

Four-hour cutoff rechecked: BOOKING_LEAD_MINUTES=240 in the deployed baseline; calendar/selection and server checkout use it. Existing boundary regression accepts exactly four hours and rejects less, including crossing the cutoff during reads.

## Acceptance summary and remaining work

Owner-reported accepted: repeated successful single/batch checkout and payment; ordinary close/reopen; unpaid timeout and starting again; payment attempted after expiry was rejected; completed-attempt dismissal and new booking; SimplyBook notification on final payment confirmation; immediate click-and-close created exactly one SimplyBook session and restored the retained attempt. Do not repeat these normal paths merely to fill a checklist. Batch atomicity is accepted by owner risk decision, not proof of later-item rollback. Stale unresolved-page focus/expiry retesting is waived.

| Remaining work                                               | Status / next gate                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR82 preparation409 messaging                                | Final-commit frontend/backend/live-email CI, then separately authorized merge and independent main/deployment verification. Deployed presentation is not yet established.                                                                                                             |
| Combined load, rate limiting and webhook resilience          | Upcoming controlled campaign at1/3/5/10 simulated customers: browsing/checkout/recovery, delayed/duplicate/out-of-order webhooks, lost acknowledgements and failed dismissal. Actual application runtime with synthetic external providers first; live provider proof stays separate. |
| Grafana Cloud hookup                                         | Prepared OTLP Tail exporter/dashboard; no stack yet, export disabled. Secure configuration, reviewed activation, ingestion/dashboard/correlation/privacy/overhead validation remain. See Service Contracts.                                                                           |
| Actual checkout performance and persistent-token restoration | Deferred; measure single/batch checkout and distinguish memory hits from encrypted SQLite restoration after coordinator restart/eviction.                                                                                                                                             |
| Hours-later confirmed-to-pending report                      | Undiagnosed backlog item; retain evidence gap and capture if encountered again. Separate from the waived stale unresolved-page retest.                                                                                                                                                |
| In-flight settlement after expiry                            | Deferred evidence gap, no repeat requested now. Rejection when paying after expiry does not prove this case; retain8-minute payment,15-minute hold and5-minute buffer.                                                                                                                |
| Client configuration, deployment and UAT                     | M6/M7: mappings, schedules, preservation of accepted notification settings, payment destination, identity and legacy receipt/recovery continuity.                                                                                                                                     |

The original roadmap's1/5/20-client release workload remains distinct from the upcoming1/3/5/10 campaign. Separate browsing/booking execution lanes are future work, not a committed prerequisite. Four-hour lead policy has source/boundary regression coverage; no new live boundary acceptance is claimed. No M4/M5 closure or production readiness is claimed.

See [campaign and Grafana contracts](docs/SERVICE_CONTRACTS.md#remaining-acceptance-and-combined-resilience-campaign--21-october-2026) and [milestone status](docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#milestone-status--21-october-2026).

## Update discipline

Keep this file current; record dated decisions, failures and verification in [Journey](docs/SOCCERBOT_JOURNEY.md). The [full prior progress ledger](docs/SOCCERBOT_JOURNEY.md#progress-ledger-archive--through-pr78) is retained there. Historical grants and unused budgets never authorize new activity.
