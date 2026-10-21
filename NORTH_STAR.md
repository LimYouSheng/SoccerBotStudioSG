# North Star: dependable customer booking and quick rebooking

## Current goal — 21 October 2026 SGT

Finish the customer website through client acceptance and handover. Current engineering work is M4.4–M4.6 booking/recovery and M5 payment/confirmation hardening, with some M6 implementation already present. This does not close earlier acceptance gaps or establish client/production readiness. The [canonical milestone status](docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#milestone-status--21-october-2026) owns the mapping; the original 44 subiteration IDs and commercial schedule remain unchanged.

Current task: extend rejected-checkout readback to preparation-stage409 responses, preserve original-attempt recovery, and publish a draft for CI. PR81 is merged and deployed. Grafana hookup remains deferred and export disabled.

Performance and actual persistent-token restoration testing are postponed. Before resuming, verify main CI and the deployed revision, then distinguish warm-memory hits from encrypted SQLite restoration after restart/eviction. Simulated timings and round trips are not live acceptance.

## Next acceptance gates

- Batch atomicity accepted by owner risk decision after the four-session conflict experiment; later-item rejection/rollback and failed/lost closure remain unproven. Preserve partial/unknown effects and prohibit payment for incomplete batches.
- Payment expiry/late settlement and abandoned/lost-response/delayed or duplicate webhook/close-reopen/multi-tab/failed-dismissal scenarios.
- Later mixed browsing/checkout/recovery workloads at 1/3/5/10 simulated customers; keep these separate from the original roadmap's controlled 1/5/20-client release workload and from actual provider acceptance.
- Client staging mappings, schedules, notifications, payment and legacy receipt/recovery continuity, followed by M6 release evidence and M7 client UAT.

Owner/CI operates browsers and provider experiments. Do not reduce the five-minute recovery buffer; retain eight-minute payment and fifteen-minute hold policies. PROGRESS owns the current revision and verification checkpoint; the three canonical documents own rules, contracts and evidence.

[Previous North Star entries](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/69945cc4ecae4593799f7205beedbc82513f9945/NORTH_STAR.md) are historical orientation. Older native-only payment, Details-time creation and preflight designs do not override current rules.
