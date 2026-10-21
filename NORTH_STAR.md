# North Star: dependable customer booking and quick rebooking

## Current goal — 21 October 2026 SGT

Finish the customer website through client acceptance and handover. Current engineering work is M4.4–M4.6 booking/recovery and M5 payment/confirmation hardening, with some M6 implementation already present. This does not close earlier acceptance gaps or establish client/production readiness. The [canonical milestone status](docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#milestone-status--21-october-2026) owns the mapping; the original 44 subiteration IDs and commercial schedule remain unchanged.

Current task: finish draft PR82 preparation409 handling and its final-commit CI, keeping the acceptance record compact and current. Next planned engineering campaign combines load, rate limiting and webhook resilience. Grafana activation remains planned separately; no stack exists and export stays disabled.

Performance and actual persistent-token restoration testing are postponed. Before resuming, verify main CI and the deployed revision, then distinguish warm-memory hits from encrypted SQLite restoration after restart/eviction. Simulated timings and round trips are not live acceptance.

## Next acceptance gates

- Final-commit PR82 CI; merge and main/deployment verification remain separate.
- Combined1/3/5/10 simulated-customer load/rate-limit/webhook campaign, including controlled lost acknowledgements and failed dismissal. Real application runtime, synthetic external provider faults first; distinct from live provider acceptance and the original1/5/20 release workload.
- Grafana stack/secure activation and ingestion/dashboard/correlation/overhead validation; later actual performance and persistent-token restoration measurements.
- Client staging mappings, schedules, preservation of accepted notification settings, payments and legacy continuity, followed by M6 release evidence and M7 UAT.

Normal checkout/payment, unpaid timeout/rebooking, after-expiry payment rejection, close/reopen, immediate click-and-close recovery and completed dismissal are owner-reported accepted. Batch atomicity is accepted by owner risk decision; stale unresolved-page retesting is waived. Do not reopen these normal-path tests. In-flight late settlement remains a deferred evidence gap; the separate hours-later confirmed-to-pending report remains undiagnosed backlog.

Owner/CI operates browsers and provider experiments. Do not reduce the five-minute recovery buffer; retain eight-minute payment and fifteen-minute hold policies. PROGRESS owns the current revision and verification checkpoint; the three canonical documents own rules, contracts and evidence.

[Previous North Star entries](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/69945cc4ecae4593799f7205beedbc82513f9945/NORTH_STAR.md) are historical orientation. Older native-only payment, Details-time creation and preflight designs do not override current rules.
