# North Star: dependable customer booking and quick rebooking

## Current goal — 22 October 2026 SGT

Complete the token-refresh change through normal CI/merge gates, then strengthen production UI/UX and email responses and complete client configuration, UAT and handover. The separate real-checkout placement experiment is owner-waived; choose initial client placement from verified database location and validate it during normal UAT. Current engineering remains M4.4–M4.6/M5 hardening with M6 preparation; no blanket milestone or production-readiness claim follows. The [canonical milestone status](docs/SERVICE_CONTRACTS.md#milestones-and-retained-acceptance-criteria) preserves the original M1–M9 and 44 subiteration IDs.

PR82–84 are merged. Bounded load/recovery/retry acceptance is complete for the tested synthetic-provider scope. Deployed logs establish persistent token restoration. The owner reports the 15-minute timeout checked and the long-open confirmation remaining confirmed; no further normal-path booking is requested.

Next gates: regression checks after UI/UX/email changes; secure Grafana hookup and ingestion/correlation/privacy/overhead validation; client mappings, schedules, payment destination, notification configuration and legacy receipt/recovery continuity through UAT. Grafana remains disabled. Additional warm-cache/batch performance and sustained-capacity experiments are optional follow-ups; the original release workload is a separate gate, not silently waived.

Late settlement and remaining batch-atomicity uncertainty are owner-accepted risks, not experimentally proven passes. Keep eight-minute payment, fifteen-minute hold and five-minute recovery buffer policies. Owner/CI operates browsers and provider experiments.

PROGRESS owns the current checkpoint; Service Contracts history retains full historical evidence and qualifications. [Previous North Star entries](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/37adaa3a02fda2fa86e852b1538029dc37749557/NORTH_STAR.md) remain historical orientation.
