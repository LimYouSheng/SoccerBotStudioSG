# SoccerBotStudio — Service Contracts

This is the single source for current system rules and dated change history. [Architecture](Architecture/README.md) explains the components; [the diagram](Architecture/diagram.md) shows their connections. AGENTS.md owns engineering execution. Current rules below override dated history; historical approvals never authorize new operations.

## Part 1 — Current system rules

### Product and booking policy

Customer booking website for one Singapore venue and one shared studio across instructors. Sessions are 40 minutes on 50-minute starts, 1–4 players, with multiple selected sessions permitted. Singapore time and SGD apply. Booking closes four hours before start: exactly 240 minutes is eligible; less is rejected in calendar filtering and server preparation/pre-write validation. Staff portals, memberships/packages, recurring charges, payroll and historical data migration are outside the commissioned website scope unless separately agreed.

SimplyBook owns services, schedules, eligible instructors, customer/booking/invoice records and configured shared-studio capacity. Browser labels, prices, dates, IDs and cached availability are never write authority. The server validates identity, account, service, time, price and current operation scope. Direct checkout deliberately omits extra live catalogue/availability preflight; provider creation enforces availability and every creation response is validated. Capacity configuration does not prove batch atomicity.

### Identity, privacy and environment isolation

Email proof precedes protected existing-customer lookup/prefill. Missing, duplicate or shared-email identities must not leak another customer's details. Guests use server-issued protected capabilities; browser storage/URLs are not credentials or ownership evidence. Turnstile, email challenge limits, expiry, signed/session authority and revocation remain enforced. Resend delivers verification codes; SimplyBook handles booking notifications on final payment in the accepted account configuration. These are separate email flows.

D1 foundation identity must match the configured account, environment, database and coordinator. Missing/mismatched bindings fail closed; no automatic claim of an unknown database. Provider credentials remain Worker secrets. Returning contact profiles require explicit remember consent and current verified identity; sign-out revokes access without deleting retained contact evidence. Identity proof remains memory-only for at most 30 seconds, bounded by token validity. Revalidate authorization for receipts/downloads and legacy recovery.

Developer and client accounts, merchants, origins, mappings, secrets and data must stay isolated. Existing source still pins developer account/database/environment values, sandbox HitPay hosts, provider safety exclusions, sender settings and repository paths. Moving repositories is not yet configuration-only. Client portability must replace those pins with validated configuration, not remove account/host guards.

### Availability and selection

Public display snapshots support fast browsing; they do not authorize bookings. Scheduled warming refreshes availability on its approximately 15-minute cadence through the minute scheduler; snapshots have a fixed maximum 30-minute display lifetime, never renewed by serving them. Protected selection rechecks current rules. On entry/refresh retain an available chosen day, otherwise choose the next available day in the loaded month (or its first available future day); failed/empty months keep an honest state. Do not silently scan other months or alter the basket. Review remains editable and creates no booking.

### Checkout, durable effects and customer errors

Flow: calendar → Details → Review/consent → reserve attempt authority → create/validate all sessions → retain complete booking association → reserve payment effect → create/save HitPay request and URL → handoff. Single uses book; batch uses createBatch, sequential book calls and closeBatch. Each provider write requires durable claim/evidence first. Retain raw booking evidence and provider references before strict validation. Validate batch closure, membership, invoice/account, currency and total before any payment. No payment for an incomplete batch.

Unknown write outcomes retain original attempt identity and evidence. Never blindly replay creation, invent success, delete uncertainty, renew grants/deadlines or automatically cancel unknown bookings. Repeated requests return protected saved results according to grant state; they do not create duplicate effects. A claimed grant does not alone prove a provider session exists.

For explicit preparation-window rejection (including 409), bounded authenticated readback checks the original attempt/owned grant before fresh availability. Actual dispatch/effect/payment evidence retains recovery. Confirmed unavailable selection shows “This time slot is no longer available. Please choose another.” Inconclusive preparation failure shows “We couldn’t start checkout. Please try again later.” Keep explicit rejection on Review; do not show payment verification for a checkout that never started. Failed readback after an uncertain write preserves recovery.

### Payment, reconciliation and expiry

HitPay hosts payment; secrets and payment verification stay server-side. Bind merchant, account, attempt, invoice, amount/currency and request identity before accepting evidence. Browser return and webhook payload alone never confirm a booking. Authenticate webhooks, retain/deduplicate receipts, and read authoritative provider state. Recovery preserves original financial claims and handles delayed/duplicate/out-of-order delivery without duplicate accounting.

Original booking creation anchors the eight-minute payment window and fifteen-minute hold. The checking period is thirteen minutes; recovery buffer remains five minutes. These are different clocks. Browser expiry, deleted/expired payment links or exhausted polling do not prove settlement impossible. Protect unknown in-flight outcomes. After verified payment, reconcile SimplyBook accounting and require current valid-booking/paid-invoice readback before final confirmation. Preserve the first valid confirmation timestamp on later visits. Refunds are owner/provider operations; cancellation is not a refund.

Polling: at most one check per two seconds for the first 20 checks, then at least ten seconds, with allowance 120 and the original checking deadline. An unresolved page refreshes on focus/foreground (coalesced, minimum 30 seconds) and once at the original server hold expiry; hidden pages catch up when visible. This does not restart polling or authorize expiry. Confirmed/denied pages stay terminal. Only authenticated server outcome permits release. Completed dismissal is repeatable; lost acknowledgement must not create a second attempt or erase uncertain evidence.

### Confirmation and presentation

Show checking/preparation/payment-received states according to actual evidence. Payment received can remain booking pending until reconciliation is complete. Preserve customer details/reference during errors; expose confirmed actions only with authoritative confirmation. Sessions/instructors and total appear once in the summary; expanded details contain client and location side by side where space permits, then a full-width concise disclaimer. Receipt tax data is independent of summary presentation. PDF/calendar exports require current authorization and validated booking evidence; a saved browser snapshot cannot bypass it.

### Storage, queue and tokens

D1 holds minimal access/attempt/grant/effect/payment/webhook/recovery evidence and display snapshots; it is not a replacement booking system. Apply additive compatible migrations, never rewrite accepted migration history or reset records to conceal failures. The account Durable Object owns serialized provider workflows and persistent SQLite coordination/token state.

One active workflow; at most 24 waiting jobs with the last four reserved for recovery. Waiting jobs expire after 15 seconds before execution with 503 provider_queue_busy. Recovery gets the next turn, at most two consecutively while customer work waits; display gets a turn after four foreground jobs. FIFO within each priority. Cached display reads can bypass the queue. Physical provider concurrency is separately bounded to two; identified ended/expired transports may release capacity with audit evidence, but unknown financial effects remain fenced. Do not interpret slot release as authorization to replay a write.

Two AES-GCM-encrypted account/environment/credential-scoped tokens persist in Durable Object SQLite, not D1. Public retention is 50 minutes, admin 60 seconds, with original absolute expiry unchanged by hits/restoration. Authentication rejection invalidates its own family and identity proof; late rejection of an old token cannot invalidate its replacement. Restoration never substitutes for current identity/booking/payment verification. Logs distinguish restoration, expiry, rejection and invalid records without token values. With `PUBLIC_TOKEN_REFRESH_AHEAD=enabled`, the existing serialized display-warming workflow replaces a still-valid public token when at most 20 minutes remain. It retires the old generation before authentication; replacement gets its own fixed 50-minute lifetime. A failed replacement leaves the old token retired, with no immediate retry. Empty/expired caches use normal demand authentication. Admin retention is unchanged. The closed configuration defaults off; the verified developer live-release profile enables it. This reduces miss frequency, not the duration of a genuine cold miss or a guarantee of uninterrupted availability.

Successful single checkout and reconciliation each use five D1 round trips; batch checkout uses 2×sessions+7 (11/15/23 for 2/4/8), excluding coordinator SQLite. These are measured/source successful-path counts, not absolute minima or caps on failure/recovery. Overlapping provider/storage timings must not be summed as exclusive wall time.

### Observability and Grafana

Existing sanitized Worker diagnostics and Server-Timing cover checkout, confirmation, provider queues/tokens and reconciliation. `provider_transport_timing` separates authentication/booking/HitPay creation into time to headers and subsequent body/parse time; these include network and provider processing, not isolated network RTT. `foundation_trace.d1Execution` reports available per-statement SQL timings and bounded serving-colo metadata, separate from total D1 call duration/count; missing metadata is not proof of zero execution time. Correlate HTTP/coordinator work by correlation ID and protected confirmation/recovery by hashed recovery key. Never export credentials, customer fields, raw URLs, SQL, arbitrary exceptions or booking/payment authority.

Prepared Tail Worker `worker/telemetry.ts` converts allowlisted diagnostic summaries to OTLP/HTTP JSON for Grafana Cloud Tempo. It is disabled and unattached; no Grafana stack/ingestion acceptance yet. It runs after producer execution, outside customer request handling, with no provider/D1 calls. It does not fabricate parent-child continuity across RPC/alarms or represent aggregate durations as exact individual spans. Dashboard owner: `observability/grafana-dashboard.json`; configuration owner: `wrangler.telemetry.jsonc`.

Defaults: 10% deterministic successful-correlation sampling; recognized failures bypass sampling within bounded limits. Maximum 32 Tail events, 256 log messages/event, 32 KiB accepted input strings, 128 spans and 512 KB outbound; five-second export timeout, 50 ms CPU, no redirects, persistent spool or retries. Failure retention is best effort. Activate only with secure endpoint/auth configuration and validate receiver ingestion, dashboard queries, correlation, redaction and overhead. Export HTTP success alone is not ingestion proof.

### Deployment, migration and acceptance

Current main CI requires frontend, backend and live-email gates. Cloudflare deployment consumes the tested artifact without rebuilding, applies pending D1 migrations and checks the resulting revision/settings. Existing deployment assumes a healthy prior Worker and existing D1/secrets; it is not a fresh-client provisioning workflow. Worker/DO configuration is declared, but client resource creation and safe interrupted setup are not yet implemented or proven idempotent. GitHub Pages is a separate demo export, not the client live payment site.

Owner will create client accounts/resources first. Then prepare portable configuration, validate/reuse those resources, test first install/rerun/interruption/account mismatch in isolation, report results and integrate before pushing to client GitHub. Keep access disabled through preparation; validate client provider entitlements, service/instructor mappings, shared capacity, schedules, notification configuration, merchant/payment destination, domain/email verification and legacy receipt/recovery continuity before UAT/cutover. A credential swap or green CI alone is not production acceptance.

Bounded synthetic load is accepted for 1/3/5 baseline/fault cohorts and separate ten-customer overload/retry profiles. Original ten-customer all-success failure remains evidence: eight admitted/two rejected. Admitted attempts recovered; explicit same-ID retries created unpaid payments without duplicates. CI runs only the 1/3 smoke matrix. Synthetic providers establish application invariants, not live provider limits or sustained capacity. Original roadmap 1/5/20 release workload remains separate.

Owner accepts normal payment/recovery/dismissal, 15-minute timeout and the observed long-open confirmation remaining confirmed. Deployed logs prove public-token SQLite restoration outside memory; HAR08 measured one 4.87-second checkout including a 0.992-second token miss. HAR09 is identical and proves no fresh network read. Batch later-item rollback/failed closure and in-flight late settlement remain unproven owner-accepted risks. Keep financial policies unchanged. Remaining: client rollout/UAT, Grafana validation, and regression checks after UI/UX/email refinements; further warm/batch performance and sustained-capacity work are optional follow-ups, not blanket milestone closure.

### Checkout placement experiment

Use one tested source revision and separate warm-token, restored-token and genuinely cold-token cohorts. Record full HTTP/checkout duration, queue wait, each provider transport timing, D1 round-trip duration/count and available SQL metadata. Preserve failures in the report; compare total latency, not a single faster span. The 21 October trace measured 4.870s browser / 4.704s HTTP / 4.227s coordinator, including 0.992s token, 1.668s booking, 0.872s HitPay and 0.878s across five D1 calls. Six comparable single paths across different versions are directional evidence, not a percentile benchmark. A management SQL probe served by primary KIX does not locate the coordinator or measure checkout SQL cost.

Authenticated regional comparison remains pending. The bounded unauthenticated screening below is complete. For a future authenticated diagnostic deployment: use distinct test-only objects in a separate namespace with best-effort `apac-se`, `apac-ne` and one provider-informed alternative; never change the active account object's name/namespace. Start with bounded read-only measurements, one request at a time, a fixed request budget and stop on auth/rate/transport failure. Use a separate provider test account for token-generation comparisons so probes cannot invalidate the active account's token. Do not infer write latency from HEAD requests or read latency alone. Owner-operated checkout is the final validation, with no automatic booking/payment probes. Compare baseline and candidate in alternating windows; report each observation and median/range when the sample is small, not an unsupported p95. Keep a candidate only if total checkout improves without higher failures, queue waits or duplicate effects. A 2–3-second cold checkout remains a target, not acceptance.

[Cloudflare DO location hints](https://developers.cloudflare.com/durable-objects/reference/data-location/) apply only on first creation and do not relocate an existing object. [Workers placement](https://developers.cloudflare.com/workers/configuration/placement/) does not move the account DO or its RPC execution. Verify placement through supported Cloudflare diagnostics; incoming-request colo is not proof of DO execution location. Client placement is chosen at initial setup from measurements; no existing state migration or new resource deployment is authorized by local verification.

### Milestones and retained acceptance criteria

Current position: M4.4–M4.6/M5 hardening, M6 preparation; M7 UAT, M8 launch/handover and M9 support remain separate. Preserve the original 44 IDs and commercial schedule. The original criteria below are historical release requirements, not an instruction to repeat waived experiments or use superseded provider designs.

### M1.1 — Reconcile the accepted baseline

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m11--reconcile-the-accepted-baseline).

### M1.2 — Enforce the reviewed release path

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m12--enforce-the-reviewed-release-path).

### M1.3 — Close tooling and delivery findings

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m13--close-tooling-and-delivery-findings).

### M1.4 — Accept the deployed demo visually

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m14--accept-the-deployed-demo-visually).

### M2.1 — Account readiness and temporary setup

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m21--account-readiness-and-temporary-setup).

### M2.2 — Prove scheduling and single-studio slot protection

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m22--prove-scheduling-and-single-studio-slot-protection).

### M2.3 — Prove the native hosted payment route

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m23--prove-the-native-hosted-payment-route).

### M2.4 — Prove failure and recovery semantics

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m24--prove-failure-and-recovery-semantics).

### M2.5 — Freeze the integration contract and mappings

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m25--freeze-the-integration-contract-and-mappings).

### M3.1 — Worker and environment foundation

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m31--worker-and-environment-foundation).

### M3.2 — Named asynchronous service contracts

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m32--named-asynchronous-service-contracts).

### M3.3 — Minimal durable state and migrations

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m33--minimal-durable-state-and-migrations).

### M3.4 — Email challenge and abuse controls

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m34--email-challenge-and-abuse-controls).

### M3.5 — Protected sessions and guest checkout capability

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m35--protected-sessions-and-guest-checkout-capability).

### M3.6 — Safe returning customer prefill

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m36--safe-returning-customer-prefill).

### M4.1 — Authoritative availability and eligible instructors

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m41--authoritative-availability-and-eligible-instructors).

### M4.2 — Connect selection and server revalidation

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m42--connect-selection-and-server-revalidation).

### M4.3 — Create and recover a checkout attempt

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m43--create-and-recover-a-checkout-attempt).

### M4.4 — Create every selected session safely

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m44--create-every-selected-session-safely).

### M4.5 — Handle partial failure and compensation

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m45--handle-partial-failure-and-compensation).

### M4.6 — Close booking recovery end to end

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m46--close-booking-recovery-end-to-end).

### M5.1 — Validate invoice and checkout association

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m51--validate-invoice-and-checkout-association).

### M5.2 — Hosted payment and safe customer return

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m52--hosted-payment-and-safe-customer-return).

### M5.3 — Verify payment status

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m53--verify-payment-status).

### M5.4 — Resolve pending expired late and unknown outcomes

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m54--resolve-pending-expired-late-and-unknown-outcomes).

### M5.5 — Protect the final confirmation

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m55--protect-the-final-confirmation).

### M6.1 — Booking summary and calendar exports

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m61--booking-summary-and-calendar-exports).

### M6.2 — Native emails and approved public content

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m62--native-emails-and-approved-public-content).

### M6.3 — Client staging configuration and full rehearsal

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m63--client-staging-configuration-and-full-rehearsal).

### M6.4 — Production build and deployment pipeline

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m64--production-build-and-deployment-pipeline).

### M6.5 — Monitoring alerts and recovery rehearsal

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m65--monitoring-alerts-and-recovery-rehearsal).

### M6.6 — Release audit and UAT package

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m66--release-audit-and-uat-package).

### M7.1 — Run the full client UAT suite

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m71--run-the-full-client-uat-suite).

### M7.2 — Physical devices and operational walkthrough

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m72--physical-devices-and-operational-walkthrough).

### M7.3 — Close defects and rerun affected acceptance

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m73--close-defects-and-rerun-affected-acceptance).

### M7.4 — Record written build acceptance

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m74--record-written-build-acceptance).

### M8.1 — Production readiness and go live decision

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m81--production-readiness-and-go-live-decision).

### M8.2 — Deploy the verified production candidate

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m82--deploy-the-verified-production-candidate).

### M8.3 — Verify live operation

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m83--verify-live-operation).

### M8.4 — Complete training handover and launch acceptance

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m84--complete-training-handover-and-launch-acceptance).

### M9.1 — Launch stabilization review

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m91--launch-stabilization-review).

### M9.2 — Six month warranty operations

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m92--six-month-warranty-operations).

### M9.3 — Optional maintenance service

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m93--optional-maintenance-service).

### M9.4 — Ongoing changes and eventual exit

[Original scope and exit evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m94--ongoing-changes-and-eventual-exit).

## Part 2 — Dated changes and evidence

### 22 October 2026 — Bounded placement screening after auth patch publication

After auth patch `9f74969268e76a051f3f287f5a7b8eb99138ea4b` was pushed to PR86, the owner authorized a bounded placement experiment. Temporary Worker `soccerbot-placement-20261022` version `838f8834-6736-4d58-b517-50e006360d3d` used a separate DO namespace with hints `apac-se`, `apac-ne`, `weur`; no public endpoint or provider credentials. Nine atomic one-shot claims capped activity at 18 unauthenticated HEAD requests and nine D1 `SELECT 1` reads. Repeated schedules reused stored outcomes. Local workerd checks covered the budget, concurrent claims, failure/no replay and absolute expiry. Scheduled completion reported all nine samples; seven detailed records were retrievable through combined and per-region telemetry queries. Missing: apac-ne round 1 and weur round 0. Do not infer their values.

| Hint    | Round | SimplyBook HEAD ms | HitPay HEAD ms | D1 round-trip ms | SQL ms |
| ------- | ----: | -----------------: | -------------: | ---------------: | -----: |
| apac-se |     0 |               1070 |            123 |               91 | 0.1437 |
| apac-se |     1 |               1062 |            250 |               87 | 0.0970 |
| apac-se |     2 |                281 |             86 |               87 | 0.1085 |
| apac-ne |     0 |                703 |            507 |                9 | 0.1043 |
| apac-ne |     2 |                191 |            152 |                8 | 0.1835 |
| weur    |     1 |                397 |            226 |              231 | 0.1311 |
| weur    |     2 |                126 |            375 |              229 | 0.1078 |

Every captured D1 read reached primary KIX. SimplyBook HEAD returned 200; HitPay HEAD returned 404. These screen public endpoint paths, not authenticated token/booking/payment APIs; no p95, actual DO colo or checkout saving is established. Response-edge labels SIN/KIX/CDG are upstream edges, not DO location proof. Northeast Asia is the first candidate for the current Japan-based D1; Southeast Asia remains a client candidate if D1 is provisioned nearby. Select client D1 and coordinator placement jointly. No active coordinator was moved and no booking/payment was created.

Schedule removal and temporary Worker deletion succeeded; a subsequent settings read returned 404. A proposed logging-only redeploy to consolidate records was rejected by automatic approval review as outside capture/cleanup and was not executed; read-only region queries were used instead. Probe source SHA256: `bdd87f50950ca8619192979e2d106d48f9f05e951b78346ccb17392b9992051b`. The result update is documentation-only; source/policy/format/diff checks apply and final-head CI remains required.

### 22 October 2026 — Public token refresh-ahead and placement diagnostics

Owner requests implementation of refresh-ahead and preparation for placement experiments. The background display queue retires and replaces a public token with at most 20 minutes left, preserving absolute expiry, encrypted persistence, admission and generation protections. One-second-before-expiry refresh was rejected as insufficient margin for observed 0.96–1.50s authentication and scheduler delay. No undocumented coexistence of token generations is assumed. The live developer artifact enables the new switch; closed configuration remains disabled. Transport header/body timings and optional D1 SQL/serving-colo metadata extend sanitized diagnostics and the Tail allowlist. No coordinator relocation, deployment, live booking or measured speedup is claimed. Test-impact review covers provider session/cache, queue warming, transport timing, D1 instrumentation, Tail privacy, release profiles and exact Worker inventory; local and final-head CI receipts are recorded in PROGRESS.

### 22 October 2026 — Security scanning and weekly notification scope

Owner adds dependency vulnerability scanning (Dependabot and npm audit), CodeQL/code scanning, secret scanning/push protection where available, and weekly Dependabot security-email notifications to the future setup. Keep targeted authentication/payment/configuration tests and security review; runtime Grafana monitoring and a clean vulnerability scan do not establish security acceptance. Personal email preferences require owner configuration. Offline inspection found only verify.yml in .github, with no Dependabot configuration, CodeQL workflow or explicit npm audit command. The GitHub connector did not expose account-level security settings; do not claim those protections are disabled or enabled. Documentation-only task: no scanner, account setting, dependency or deployment changed. Source/policy/format/diff checks cover the backlog edit; test inventory and current runtime gates are unchanged.

### 22 October 2026 — Dependency security maintenance added to backlog

Owner requests a to-do item for automatic security detection and update preparation: Dependabot alerts, security-update PRs and weekly grouped routine npm/GitHub Actions updates. Review pinned Node and Worker compatibility-date changes deliberately; preserve exact pins and the lockfile. Merges require review and all three final-commit CI gates; do not automatically merge or deploy unreviewed updates. Cloudflare manages its infrastructure patching; application/toolchain maintenance remains ours. This records future work only: no repository settings, dependencies or deployment behavior changed. Test-impact review: documentation-only backlog/history update; existing test inventories and workflows remain applicable.

### 22 October 2026 — Documentation consolidation and client migration plan

Owner replaces three overlapping canonical documents with Architecture (diagram and one-page explanation) and this two-part Service Contracts document. Cloud setup essentials move into AGENTS. No booking/payment behavior changes. PR85 acceptance documentation was merged before this refactor. The owner will configure client resources before deployment automation and client-repository delivery; portability/provisioning is planned, not implemented. Developer pins remain in runtime and release code and need validated environment configuration.

Test-impact review updated installer document ownership and retained the 44-ID order/missing/duplicate rejection gates; added missing-architecture/contract rejection coverage and formatting coverage for the new folder/local skill. The first source check caught a case collision with old architecture images, now removed. Historical image bytes remain in Git only. Source/policy, installer regressions, formatting and current-link/structure checks passed. Initial broad tooling execution hit restricted local networking/child output; its failed receipt is retained; the supported-permission rerun passed all 132 tooling tests. Final-commit CI remains required. No application or provider behavior changed.

Historical narrative below condenses each Journey checkpoint while linking its full immutable evidence. The archive includes full commit references, failures, raw-evidence hashes, test counts and superseded plans; it is not lost or overwritten. Dates retain their original stated context. Old plans are not current rules or renewed authorization. Exact historical manifests in docs/source-fingerprint.json and docs/review-verification.json remain unchanged historical receipts.

### Acceptance checkpoint — 22 October 2026 SGT

PR84 final head `be31bb91360dc07c37879072d69c1aefa87eae30` passed all three PR gates, then merged as `37adaa3a02fda2fa86e852b1538029dc37749557`. Refreshed main run [39626576749](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/39626576749) passed frontend, backend, live-email and deployment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#acceptance-checkpoint--22-october-2026-sgt).

### 21 October 2026 — overload recovery and explicit retry qualification

Merge follow-through: PR82 main39576113663 passed all gates and Cloudflare deployment. PR83 merge-resolution9de4c1c passed all three gates in39576302620, then merged as7ced699b1e4fbc25a4d889be8d2e67d0c208faba.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--overload-recovery-and-explicit-retry-qualification).

### 21 October 2026 — scope the409 browser alert to main

PR82 be37f73 run39570386559 passed frontend/backend; live-email again passed78/81. All three new409 executions failed because the unscoped alert locator matched both the actual Review error and Next.js’s route announcer.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--scope-the409-browser-alert-to-main).

### 21 October 2026 — full burst campaign reaches queue limit

Owner authorized the next isolated campaign. Ran npm run test:load on clean 21bc10c47562d42029be59638552e39699aba594.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--full-burst-campaign-reaches-queue-limit).

### 21 October 2026 — isolated load campaign preparation

Owner requested planning/preparing the combined load, rate-limit and webhook test. Created test/resilience-load-preparation from unmerged PR82, preserving the dependency symlink.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--isolated-load-campaign-preparation).

### 21 October 2026 — PR82 browser alert locator correction

Final documentation head ae5694c run39567290859 passed frontend/backend, including435 Worker cases. Live-email passed78/81: the new409 case failed on all three devices at its exact-text locator.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--pr82-browser-alert-locator-correction).

### 21 October 2026 — acceptance consolidated and next campaign planned in PR82

Owner confirms payment attempted after expiry previously failed and completed dismissal permits another booking. These join earlier accepted normal payment, unpaid timeout/rebooking and close/reopen checks; do not repeat normal paths.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--acceptance-consolidated-and-next-campaign-planned-in-pr82).

### 21 October 2026 — preparation409 readback and owner atomicity decision

PR81 merged asab478e0e926ac8b74a1f4157e99ca892691e942e; main run39559855205 succeeded and health matched that revision (Worker1e01a671-3190-4513-9a6d-469fbd7028c3). HAR20 contains successful single checkout; HAR19 ends before the rejected batch checkout and does not retain its409 body.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--preparation409-readback-and-owner-atomicity-decision).

### Consistent calendar selection — 21 October 2026 SGT

Owner observed initial entry choosing an available day but browser refresh selecting unavailable today. TimeStep initialized the date before asynchronous month data arrived and never adjusted it.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#consistent-calendar-selection--21-october-2026-sgt).

### 21 October 2026 — concurrent checkout rejection readback

Owner waived the old unresolved-page refresh retest because home permits another booking after expiry; this is excluded by owner decision, not proven deployed repair. Owner reported abandonment/dismissal and return to selection worked; replacement checkout was not independently evidenced.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--concurrent-checkout-rejection-readback).

### 21 October 2026 — unresolved focus and hold-expiry refresh

Owner requested combining confirmation detail cleanup with foreground/focus and original15-minute hold-expiry checks in PR81. Test1 mostly demonstrated retained unpaid recovery and provider timeout, but the existing page remained unresolved; home later permitted a new booking.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--unresolved-focus-and-hold-expiry-refresh).

### 21 October 2026 — acceptance resumed and confirmation details simplified

PR80 headb4d452c2ad10d18ed16e4044dd39ca05a4e361d6 passed frontend/backend/live-email in39542179705. Owner deferred Grafana hookup and resumed acceptance; no merge/deployment of PR80 occurred.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--acceptance-resumed-and-confirmation-details-simplified).

### 21 October 2026 — PR79 deployment and backend telemetry preparation

Owner explicitly approved PR79 merge. Final repaired head e8989b4e61b9a58e5dc0f4855861ac744ca69ebc passed all three PR gates in39528606402; merge3e74b10a8e96f81051c6c257d6c93a5c277f3f11 passed all three main gates and both deployment jobs in39530449830.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--pr79-deployment-and-backend-telemetry-preparation).

### 21 October 2026 — PR79 browser colour expectation repair

Run39525183294 on6ea34d5 passed live-email; frontend/backend each passed72/75 browser cases and failed the same typography journey on desktop Chromium, phone WebKit and tablet WebKit. tests/customer.spec.ts pageHeading still required navy rgb(5,10,47) for Booking confirmed; the observed rgb(23,96,120) is the owner-requested new confirmation accent. The earlier impact pass missed that generic helper.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--pr79-browser-colour-expectation-repair).

### 21 October 2026 — PR78 handoff and documentation/presentation audit

PR78 owner-merged as69945cc4ecae4593799f7205beedbc82513f9945; handoff records frontend/backend/live-email CI39481563606 passed on acc82ec11bb00dbcf26a4de322d31e8998ca7cec. Remote main fetched at the merge.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#21-october-2026--pr78-handoff-and-documentationpresentation-audit).

### Batch checkout and token retention — 21 October 2026 SGT

Owner accepts confirmation presentation and asks only for minimal batch checkout D1 and reliable tokens. Hometest07: single5 total D1/4.68s redirect; two-session batch17/8.30s; both public-token misses about964ms six minutes apart.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#batch-checkout-and-token-retention--21-october-2026-sgt).

### Five-round-trip recovery experiment — 21 October 2026 SGT

Simulated providers measured5 D1 executions for1/2/4/8 sessions; the predecessor measured25/29/37 for1/2/4. With150ms injected D1 latency and400ms booking/invoice reads, matched single-run baseline→candidate times were5561→3232ms,6679→4146ms and8716→5951ms.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#five-round-trip-recovery-experiment--21-october-2026-sgt).

### Five-call experiment accepted for integration — 21 October 2026 SGT

Owner requested integration and CI after the fresh single-checkout prototype reached five total D1 round trips including HTTP foundation/authentication. Matched simulations with150ms per D1 execution,900ms token,1200ms booking and800ms HitPay gave cold4344→3744ms and warm3576→2824ms means across two fixtures each.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#five-call-experiment-accepted-for-integration--21-october-2026-sgt).

### Hometest06 and optimization experiments — 20 October 2026 SGT

Owner two-session HAR: checkout HTTP11.444seconds, redirect starts11.454seconds after checkout request. Preparation15 D1/2007ms; booking work27 D1/3580ms; payment save2 D1/264ms.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#hometest06-and-optimization-experiments--20-october-2026-sgt).

### Confirmation read experiment — 20 October 2026 SGT

The first consolidation candidate failed a deterministic manual-review-during-admission race: it returned confirmed from its old snapshot. It was rejected.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#confirmation-read-experiment--20-october-2026-sgt).

### Hometest05 telemetry — 20 October 2026 SGT

PR72 main2c19288 passed CI/deployment39421510974. Owner HAR checkout-to-HitPay navigation5.521seconds: one creation1.696seconds, one HitPay1.016seconds, nine coordinator D1 executions1.301seconds, public-token miss941ms, zero queue wait.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#hometest05-telemetry--20-october-2026-sgt).

### Pending confirmation layout consistency — 20 October 2026 SGT

Owner hometest05 requests one presentation through confirmation checking and verification. Source inspection finds a full-page route Suspense loader and a separate context-loading card before the compact detailed confirmation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pending-confirmation-layout-consistency--20-october-2026-sgt).

### PR72 lost-response test setup — 20 October 2026 SGT

Run39415858902 on767f760 passed frontend/backend and77/78 live-email cases, including all three new timing-header assertions. Offline phone-WebKit trace shows roughly8.5seconds of fixture setup and10seconds of initial calendar loading.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr72-lost-response-test-setup--20-october-2026-sgt).

### Confirmation tracing — 20 October 2026 SGT

PR71 merged as78098bf after all three gates passed; main CI/deployment run39410852918 succeeded. Owner hometest04 records single checkout5.30seconds, nine coordinator D1 calls/1.303seconds, public token cache miss957ms, and return-to-confirmed20.407seconds/receipt21.209seconds.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#confirmation-tracing--20-october-2026-sgt).

### Ten-call single checkout integration — 20 October 2026 SGT

Owner authorized merging PR70 after all three CI gates passed on5b350aa (run39401212504). PR70 merged as18ccde0; the D1 integration branch starts there.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#ten-call-single-checkout-integration--20-october-2026-sgt).

### PR70 initial receipt versus download gate — 20 October 2026 SGT

Run39394733331 on a51594a passed frontend/backend and74/78 live-email cases. Downloaded logs confirm the same recovery case failed at the blocked initial receipt on all three devices.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr70-initial-receipt-versus-download-gate--20-october-2026-sgt).

### PR70 browser reconciliation-gate correction — 20 October 2026 SGT

Run39391908409 passed frontend/backend and75/78 live-email cases. The same payment-recovery journey failed on all three devices because it deliberately blocked accept-payment but still expected Booking confirmed before releasing that gate.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr70-browser-reconciliation-gate-correction--20-october-2026-sgt).

### Confirmation and queue audit repair — 20 October 2026

Against main194cb5f, owner identified early customer confirmation before SimplyBook readback, unbounded workflow queues, missing physical capacity acceptance and conflicting documentation. The candidate moves success retention after current confirmed-booking/paid-invoice observation and rejects legacy premature proof until reconciliation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#confirmation-and-queue-audit-repair--20-october-2026).

### PR69 main integration — 20 October 2026 SGT

PR69 had no CI run because its tracing branch conflicted with main after PR68 merged. Integrate main194cb5f without rewriting branch history: retain batch creation-only behavior inside request-bound tracing, retain both test sets and ordered inventory, and preserve both historical entries.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr69-main-integration--20-october-2026-sgt).

### Checkout phase tracing — 20 October 2026 SGT

Owner requests measurement of the7.6-second single checkout before pursuing3seconds. Separate tracing branch starts from merged PR67/main dc74690; batch optimization PR68 remains independent.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-phase-tracing--20-october-2026-sgt).

### Batch checkout creation path — 20 October 2026 SGT

After HAR13 single checkout reached HitPay in7.60seconds, owner stops single optimization and authorizes the same provider strategy for direct batch checkout. Extend the ongoing creation-only path to batch: public token, createBatch, one sequential book per session, closeBatch, validated complete unpaid invoice and one HitPay request.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#batch-checkout-creation-path--20-october-2026-sgt).

### Checkout D1 consolidation — 20 October 2026 SGT

The follow-up reduces isolated warm/cold single checkout from34 to27 D1 executions (HAR12 baseline47). Archive/read grants in one primary batch; pass the committed canonical association/version forward; batch checkout completion with the final authenticated access read.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-d1-consolidation--20-october-2026-sgt).

### Lean single checkout — 20 October 2026 SGT

Owner authorizes SimplyBook settings as the one-studio capacity authority and removes per-checkout admin identity/plan, catalogue, required-field, instructor eligibility and slot reads. Apply first to ongoing direct single checkout; historical split holds and batch preflight remain unchanged for the staged experiment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#lean-single-checkout--20-october-2026-sgt).

### PR66 CI cookie-adapter correction — 20 October 2026 SGT

Run39365196455 on77f06d3 passed frontend/backend and75/78 live-email cases. Only the new identity-warming test failed on all three devices, after its UI/no-effect assertions passed: its direct current-status fetch copied the preview cookie name instead of using the existing adapter that maps it to the real Worker cookie.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr66-ci-cookie-adapter-correction--20-october-2026-sgt).

### Authentication rejection diagnostic follow-up — 20 October 2026 SGT

The60-second admin-token cache already refreshes on the next identity operation after expiry; HAR10 failed during fresh admin-auth, not a missing refresh. Existing logs discarded the exact401/403 distinction.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#authentication-rejection-diagnostic-follow-up--20-october-2026-sgt).

### HAR10 confirmation stability and pre-dispatch authentication failure — 20 October 2026 SGT

Owner HAR10 ran deployed5e9e2d8 after PR65. Its first checkout returned the HitPay handoff in14.8seconds and payment subsequently reconciled.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har10-confirmation-stability-and-pre-dispatch-authentication-failure--20-october-2026-sgt).

### Confirmation read timestamp race — 20 October 2026 SGT

PR64 passed all PR gates and owner merged it as c7ee697. Main run39355419233 passed frontend/backend and74/75 live-email cases; tablet WebKit payment recovery timed out and Cloudflare deployment was skipped.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#confirmation-read-timestamp-race--20-october-2026-sgt).

### Independent payment deadlines — 20 October 2026 SGT

HAR09 records a29.1second four-session checkout ending in recovery_required. The saved batch-close evidence confirms four bookings and an unpaid invoice; correlated deployed c08aa04 telemetry proves HitPay creation returned422 JSON.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#independent-payment-deadlines--20-october-2026-sgt).

### Interrupted provider transport recovery — 20 October 2026 SGT

Owner requires errors to be logged and isolated while unrelated customers continue. A06:07:38SGT Cloudflare storage reset during read-only warmDisplay left one unclassified admission unfinished; parallel reads then exhausted the remaining slot.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#interrupted-provider-transport-recovery--20-october-2026-sgt).

### Lost checkout response test ordering — 20 October 2026

PR62 merged as de71b72 after all three PR gates passed. Main run39340832488 passed frontend/backend but failed one of75 live-email cases; Cloudflare deployment was skipped.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#lost-checkout-response-test-ordering--20-october-2026).

### PR62 checkout transport verification — 20 October 2026 SGT

Owner explicitly authorizes merging PR62 after all three final-head CI gates pass. Initial head0b5a76c passed frontend/backend and73/75 live-email cases; two desktop Chromium checkout assertions lost response resources after immediate HitPay navigation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr62-checkout-transport-verification--20-october-2026-sgt).

### Actual batch response investigation and optimization — 20 October 2026 SGT

Read-only D1 evidence for owner hometest03 proves cumulative intermediate booking arrays1–4, require_confirm=true and no invoice; final closure invoice has four lines with nested is_confirmed=true, status=new, payment_received=false and a due_datetime equal to subsequent invoice readback. Closure receipt to final invoice-read receipt spans5.937seconds, including intervening processing; no promised speedup.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#actual-batch-response-investigation-and-optimization--20-october-2026-sgt).

### Owner prioritizes checkout URL handoff — 19 October 2026 SGT

Owner authorizes removing awaited comment I/O and the extra context request before initial HitPay navigation. Added durable deferred comments with account queue/cron ownership and one-write claims; the checkout reply carries only its validated, saved URL and expiry to a transient client callback.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-prioritizes-checkout-url-handoff--19-october-2026-sgt).

### Owner adds recurring display warm-up — 19 October 2026 SGT

After history review established the old fifteen-minute warmer was proposed but excluded, owner authorizes implementing it with PR61 and requests immediate updates for booking creation. Implement account-DO persistent public snapshots, fifteen-minute due claims on existing minute cron, creation-triggered invalidation/background refresh and original thirty-minute display deadlines.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-adds-recurring-display-warm-up--19-october-2026-sgt).

### Browsing loading and cache investigation — 19 October 2026 SGT

Started successor from actual main d15caba after PR60 merge. Owner reports homepage/guest flicker, awkward locking and slow initial calendar.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#browsing-loading-and-cache-investigation--19-october-2026-sgt).

### PR60 flow implementation and CI diagnosis — 19 October 2026 SGT

Inspected failed run39209839579 atf03049e. Frontend/backend browser lanes each failed two journeys on all three devices: assertions targeted Studio1 and Selected sessions inside the new collapsed full-details disclosure.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr60-flow-implementation-and-ci-diagnosis--19-october-2026-sgt).

### Editable Review, combined checkout and compact confirmation — 19 October 2026 SGT

Owner supersedes creation-during-Review and queued provider edits: Details runs fresh read-only availability checks, then opens editable Review without creating a customer, booking or payment. Changed details reset consent.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#editable-review-combined-checkout-and-compact-confirmation--19-october-2026-sgt).

### HAR08 confirmation continuity and record reconciliation — 19 October 2026 SGT

Owner reports successful checkout and asks for pending do-not-refresh guidance, removal of repeated confirmation loading, and read-only record reconciliation. HAR08 shows customerConfirmation in a pending response, followed by confirmed without that snapshot; the hook discarded the proof while the611ms receipt request completed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har08-confirmation-continuity-and-record-reconciliation--19-october-2026-sgt).

### Email-code browser interaction repair — 19 October 2026 SGT

Final-policy CI39200175005 frontend passed74/75 browser cases. Tablet WebKit filled the code while main was still inert during the loading transition; the trace retained an empty input, so native required validation prevented the expected incorrect-code response.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#email-code-browser-interaction-repair--19-october-2026-sgt).

### Fifteen-minute hold and eight-minute payment policy — 19 October 2026 SGT

Owner authorizes adding this policy to PR59 and merging only after final-commit required CI passes. Owner reports SimplyBook's timeout changed to15minutes; provider behavior is not independently verified.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#fifteen-minute-hold-and-eight-minute-payment-policy--19-october-2026-sgt).

### Completed-dismissal CI setup repair — 19 October 2026 SGT

Merged-main50656c9 CI39198249437 passed74/75 live-email cases; phone WebKit timed out before reaching dismissal. Trace shows about22seconds spent creating the synthetic hold/payment before navigation, then waiting for fully reconciled confirmation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#completed-dismissal-ci-setup-repair--19-october-2026-sgt).

### Pre-creation concurrency implementation — 19 October 2026 SGT

Owner requests implementing all safe independent pre-creation overlap. Source audit found sequential token acquisition, independent preflight reads and provider identity preparation after local persistence.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pre-creation-concurrency-implementation--19-october-2026-sgt).

### HAR07 upstream failure and measured hold delay — 19 October 2026 SGT

HAR07's11:38SGT trial used Worker version4acf4e0f, correlated with deployed sourcef966884. Holding succeeded in16.678seconds; the first verifying poll began13.295seconds after dispatch.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har07-upstream-failure-and-measured-hold-delay--19-october-2026-sgt).

### Payment-first confirmation and expiry implementation — 19 October 2026 SGT

Owner clarified that verified matching payment should immediately complete the customer-facing booking when the existing hold remains valid; SimplyBook reconciliation must continue regardless of the page. A clicked download may wait, but confirmation must stay usable.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#payment-first-confirmation-and-expiry-implementation--19-october-2026-sgt).

### Creation-first optimistic Review clarification — 19 October 2026 SGT

Owner clarifies that Review should appear after booking creation, with comments/readback continuing while payment stays disabled. Earlier source waited for comment acknowledgement.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#creation-first-optimistic-review-clarification--19-october-2026-sgt).

### HAR06 Details-to-Review latency follow-up — 19 October 2026 SGT

Owner manually measures13–14seconds. The hold starts09:11:29.401; the last running poll completes about09:11:42.586, the first verifying poll about09:11:43.907 (14.506s after start), and the hold response about09:11:45.135 (15.734s).

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har06-details-to-review-latency-follow-up--19-october-2026-sgt).

### HAR06 checkout abort and compact pending return — 19 October 2026 SGT

Safely inspected owner HAR06, captured09:11:00–09:13:02 SGT. It records one hold POST200 (15.734s), one HitPay-preparation POST200 (3.407s, paymentAvailable=true), an aborted checkout-context request (28ms), then a successful context read containing an available sandbox HitPay URL.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har06-checkout-abort-and-compact-pending-return--19-october-2026-sgt).

### Owner requires a test-impact pass after every change — 19 October 2026

Repeated CI repairs exposed an incomplete impact review: the one-month preload updated guestDetails and component expectations but missed a separate native guest journey's warmedMonths wait and two four-call assertions. CI39176339093 passed frontend/backend but failed that journey on all three devices (69/72 live-email).

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-requires-a-test-impact-pass-after-every-change--19-october-2026).

### One-month browser expectation repair — 19 October 2026 SGT

CI39176339093 on3a34e2a passed frontend/backend, but live-email passed69/72: the same native guest journey timed out on all three engines. Its separate warmedMonths setup still waited for four responses, then asserted four calendar calls twice.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#one-month-browser-expectation-repair--19-october-2026-sgt).

### One-month calendar preload — 19 October 2026 SGT

Owner reduces eager calendar loading from four months to the displayed month only. Homepage preloads the current Singapore calendar month; another month is fetched only when opened.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#one-month-calendar-preload--19-october-2026-sgt).

### Final single-booking optimization pass — 19 October 2026 SGT

CatalogueReads overlaps the independent service/instructor reads only for ongoing customer access under the existing ProviderSession and serialized admission owner. The initial full runtime run exposed three finite-path rate rejections; finite/historical reads retain their original sequential dispatch.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#final-single-booking-optimization-pass--19-october-2026-sgt).

### Three UI follow-ups to PR55 — 19 October 2026 SGT

Additional owner requests: preferred communication has Email as its default with exactly Email, Call (existing phone identifier), SMS and WhatsApp; remove the placeholder and retain stored preferences. The shared method catalogue also supplies SimplyBook comment labels.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#three-ui-follow-ups-to-pr55--19-october-2026-sgt).

### Follow-up latency review and earlier Review — 19 October 2026 SGT

Owner requests a full bottleneck pass together with duplicate reference acknowledgement removal, then explicitly asks to show Review after step3 of8 (comment), while readback continues. Source confirms progress previously waited for association persistence after comment handling.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#follow-up-latency-review-and-earlier-review--19-october-2026-sgt).

### Latest05 duplicated loading and measured delay — 19 October 2026 SGT

The owner reports two loading phases and ineffective optimistic Review. Offline HAR confirms holding14.112s and first verifying response at about12.75s; earlier replies are running.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latest05-duplicated-loading-and-measured-delay--19-october-2026-sgt).

### Optimistic Review milestone test — 19 October 2026 SGT

PR53 candidate8d3571b passed frontend/backend and71/72 live browser runs. Offline tablet trace showed two protected progress responses still running, before creation was associated; the test incorrectly started its five-second UI assertion from the Details click, including all preflight/provider setup.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#optimistic-review-milestone-test--19-october-2026-sgt).

### Pending-checkout accessible status repair — 19 October 2026 SGT

PR52 main39149579852 passed all three gates and deployed verified692cf92 to the developer Worker. PR53 CI39151457912 passed Worker verification; frontend/backend each passed69/72 browser runs, failing the same pending-checkout status assertion on three devices.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pending-checkout-accessible-status-repair--19-october-2026-sgt).

### Latency review, main failure and comment reconciliation — 19 October 2026 SGT

PR51/52 exact PR gates passed and both were owner-authorized merged. PR51 main39149518497 subsequently failed one tablet dismissal-retry case:53/54 live runs passed, both other gates passed, Cloudflare skipped.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latency-review-main-failure-and-comment-reconciliation--19-october-2026-sgt).

### Partial-batch recovery CI repair — 19 October 2026 SGT

PR52 eb4573c passes frontend and backend gates. Live-email passes58/63; later-conflict reload returns native_snapshot_unavailable because the rejected session never acquires a validated offer snapshot.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#partial-batch-recovery-ci-repair--19-october-2026-sgt).

### Location dialog focus repair — 19 October 2026 SGT

PR52 candidate179ae0d failed the same desktop Chromium focus-return assertion in both frontend and backend browser gates (71/72 passed in each). Closing the location dialog removed it before passive-effect cleanup could reliably restore native focus.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#location-dialog-focus-repair--19-october-2026-sgt).

### Latest04 and batch sequencing — 19 October 2026 SGT

Owner supplies latest04, requests contact spacing, signed-in email prominence, header hover repair, studio-location popup and batch duplicate removal. Map preference: lowest latency.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latest04-and-batch-sequencing--19-october-2026-sgt).

### Independent checking-window regression — 19 October 2026 SGT

The repaired dismissal journey passes all3 devices on4fc8ce3. Two tablet cases timed out when combining full guest selection, uncertain holding, reload and checking-window exhaustion.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#independent-checking-window-regression--19-october-2026-sgt).

### Browser failure regression expansion — 18 October 2026

Owner challenged the unchanged69 browser runs and requested comprehensive failure coverage. That number is23 legacy scenarios across3 devices; it did not include new failure journeys.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#browser-failure-regression-expansion--18-october-2026).

### Owner-approved combined hold — 18 October 2026

Source review of merged PR49/main87fde3c found Details → Review still performed preparation-stage fresh calendar reads followed by authoritative prebooking reads. latest03 measured8.691s preparation plus15.984s holding. Owner requested removal of that sequential duplication and initially proposed deleting mutable D1 rows on failure.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-approved-combined-hold--18-october-2026).

### Latest03 returning-session report and immediate rebooking — 18 October 2026

Owner reports unavailable-session display after returning with email and requests immediate first-step rebooking with backend work in the background. Refreshed main includes merged PR48 atd89ad5e.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latest03-returning-session-report-and-immediate-rebooking--18-october-2026).

### Latest02 investigation, payment wake-up and email blocker — 18 October 2026

Owner requested at least80% latency reduction after latest02.har. Fresh deployed revision matches mergedPR47/main45ec58c.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latest02-investigation-payment-wake-up-and-email-blocker--18-october-2026).

### Checkout grant-read consolidation — 18 October 2026

Owner requested removing repeated ownership checks after reviewing the latest single-session HAR. Actual observed Details → Review improved28.866s→27.271s while provider calls fell28→24; roughly10s remained outside provider spans.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-grant-read-consolidation--18-october-2026).

### Owner directs initial comments — 18 October 2026

Owner says to send the comment without further considerations. Apply that current decision over the earlier conditional-update prerequisite: wire the already validated formatter into the admitted admin comment write for the newly created booking set.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-directs-initial-comments--18-october-2026).

### Handoff flash and missing comments — 18 October 2026

Owner reports Review flashing after the spinner before the first HitPay navigation, plus missing players, school and communication method in provider Comments. A focused regression reproduces loading becoming success before navigation completes.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#handoff-flash-and-missing-comments--18-october-2026).

### PR46 browser status assertion repair — 18 October 2026

CI39120279412 passed frontend/backend gates and17/18 live-email browser cases. The new completed-exit journey passed desktop Chromium, phone WebKit and tablet WebKit.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr46-browser-status-assertion-repair--18-october-2026).

### Completed booking exit and provider diagnostics — 18 October 2026

Owner reports Make another booking returns to confirmation after successful payment and requests both explicit exit actions deactivate that routing. Source reset rejects restored checking attempts; hard navigation restores the same server-bound grant.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#completed-booking-exit-and-provider-diagnostics--18-october-2026).

### Circular mouse cursor — 18 October 2026

Owner requests a circular cursor with a lagging centre dot. Added one root-level pointer decoration with bounded dot travel and an animation loop that stops when settled.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#circular-mouse-cursor--18-october-2026).

### Single-session booking validation optimization — 18 October 2026

Owner chooses single-session optimization first; multi-session atomicity testing remains deferred. Refreshed main6b8555a includes merged PR43.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#single-session-booking-validation-optimization--18-october-2026).

### Full confirmation, return continuity and transition loading — 17 October 2026

Owner HAR captured two sessions: prepare5.311s, hold44.370s, payment creation8.483s and checkout context0.737s. Return polling starts18:37:52SGT, first reports payment received at18:38:38 and confirmed at18:38:49; receipt200 completes around18:38:51.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#full-confirmation-return-continuity-and-transition-loading--17-october-2026).

### Paid return continuity and restore-before-prefetch — 17 October 2026

Owner requests repair after merged main4b59217 failed live-email CI39016144380. Frontend/backend passed; Cloudflare deployment was skipped.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#paid-return-continuity-and-restore-before-prefetch--17-october-2026).

### PR41 CI repair and paid-return diagnosis — 17 October 2026

PR41 run39012995799 failed browser checks: remembered identity expanded the email card and moved the guest action on desktop/tablet; confirmation tests still expected an inline heading; overlapping context/status work exposed the wrong accessible loading label. Keep the guest card independent of secondary account actions, reserve equal description space, and preserve equal primary button dimensions.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr41-ci-repair-and-paid-return-diagnosis--17-october-2026).

### HAR-fixed-01 booking loading and latency review — 17 October 2026

Owner reports unequal guest/email buttons, layout movement during requests, a long Review booking wait, and requests the same full-page logo loader used for home-to-studio navigation. Stretch the account cards and give both primary actions the same full width/minimum height.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har-fixed-01-booking-loading-and-latency-review--17-october-2026).

### Owner-requested migration process and testing documentation — 16 October 2026

Owner asks whether the booking optimization is available for the next test and requests a separate documentation PR for the full migration process, environment files, actual-API browser tests, mutation testing and latency/performance requirements. At this checkpoint PR39 head2c03fe1 is unmerged; the Worker serves source be9982b3 using activated new-account version140 c2a562d1.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-requested-migration-process-and-testing-documentation--16-october-2026).

### Migration sweep: remove old-account session preload — 16 October 2026

The owner-requested final pass found the experimental NativeSessionInit frame still loading soccerbotstudiosg on every live booking selection. Direct HitPay checkout does not use that native hosted-session experiment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#migration-sweep-remove-old-account-session-preload--16-october-2026).

### Migration version activated — 16 October 2026

Owner explicitly authorized activation. Deployment ad3432df-b58f-4c74-b1a6-d5db7fb6729a activated saved version140 c2a562d1-3469-4b5c-8ecc-cd22837377f4 at17:29:45SGT,100% traffic.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#migration-version-activated--16-october-2026).

### Deployed provider mismatch — 16 October 2026

Ordinary curl through the supported managed network returns HTTP200 for Worker health, catalogue and October calendar; the earlier Python HTTP403/1010 is client-dependent evidence, not general Cloudflare unreachability. Health still identifies source be9982b3 and version f2400190-6db5-4436-8c74-16371055b117.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#deployed-provider-mismatch--16-october-2026).

### 16 October 2026 — acceptance preparation and inactive legacy work

Owner confirms HitPay works locally, old records are noncritical test history, new-account settings complete, webhook unchanged and the new environment shell saved. They request verification and readiness for the first owner acceptance.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#16-october-2026--acceptance-preparation-and-inactive-legacy-work).

### Environment readiness and owner confirmations — 16 October 2026

Owner reports latest environment changes installed, confirms migration checklist item3 complete (new-account signing/settings/schedules), and confirms item4 webhook configuration remains unchanged. Record these as owner confirmations, separate from independently observed provider evidence.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#environment-readiness-and-owner-confirmations--16-october-2026).

### 16 October 2026 — fresh runtime, migration readback and queue optimization

Refreshed remote main and actual Cloudflare SOURCE_REVISION: be9982b3b0420db88907ecb727d049cd87a86ee4. The clean historical experiment checkout 897cbfe was 196 commits behind, with no unique commits; it remains unchanged.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#16-october-2026--fresh-runtime-migration-readback-and-queue-optimization).

### Opening hours, four-hour lead and observed HitPay host — 16 October 2026

Owner requested the noon–20:00 permanent opening window and four-hour lead together with the diagnosed HitPay fix. Read-only owner-local API checks returned HTTP200, one exact reference, matching amount/currency and path, and the checkout.sandbox.hit-pay.com host.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#opening-hours-four-hour-lead-and-observed-hitpay-host--16-october-2026).

### HAR06 checkout latency and payment diagnostics — 16 October 2026

Owner HAR06 and redacted Worker/D1 evidence establish booking49/invoice40 created successfully at11:38SGT, with confirmed booking flags and an unpaid invoice. Details-to-Review took about53seconds: roughly20seconds queued behind background month work,5seconds for the browser-triggered fresh day read,6seconds for preparation (another fresh read), and21seconds for holding creation/readback (19 provider calls).

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har06-checkout-latency-and-payment-diagnostics--16-october-2026).

### Sandbox deployment and recovery correction — 16 October 2026

Expanded local verification exposed an existing fixture calling Date.now separately for the start and end of an exactly20-minute grant. A millisecond boundary violates the unchanged database maximum.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#sandbox-deployment-and-recovery-correction--16-october-2026).

### Hold-state experiment evidence — 16 October 2026

CI38836809759 passed frontend verification and all337 runtime tests in both Worker jobs, but the strict ordered inventory rejected the two new titles appended at the end. Move only those two entries to their native-test execution position; all335 existing titles and every assertion remain unchanged.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#hold-state-experiment-evidence--16-october-2026).

### Complete sandbox configuration readback — 16 October 2026

Owner requested a full configuration check, which exposed five missing bindings beyond the previously restored route/enablement flags. Owner then authorized setting them.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#complete-sandbox-configuration-readback--16-october-2026).

### Calendar return and local reconciliation — 16 October 2026

Owner verified24October09:00 is correctly unavailable; that report is withdrawn. A separate frontend pause survives successful fresh validation followed by preparation failure, leaving Back-to-calendar loading until a selection edit.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#calendar-return-and-local-reconciliation--16-october-2026).

### Stable guest option and HAR04/05 — 16 October 2026

PR34 is owner-merged as4e98eae after all three PR gates passed in38828870612. Owner reports guest-button movement when saved identity restores.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#stable-guest-option-and-har0405--16-october-2026).

### Confirmation restoration race exposed by mechanism tests — 16 October 2026

CI38823092566 reaches real holding/payment on all browser projects. Paid return passes on phone/tablet, while desktop receives confirmed200 then remains Checking: initial BookingProvider hydration/restoration changes the revision and cancels that protected read before a second request is throttled.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#confirmation-restoration-race-exposed-by-mechanism-tests--16-october-2026).

### Test longevity audit — 16 October 2026

Owner requests a review of all tests following the weekday-dependent CI failure. Inventory:50 files, comprising24 frontend/unit,10 Worker,3 browser and13 tooling/installer files.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#test-longevity-audit--16-october-2026).

### Mechanism browser transport and checking evidence — 16 October 2026

Run38820026896 exposed assumptions hidden by instantaneous API mocks: calendar warming/holding require response-based synchronization, and WebKit interception omitted the guest cookie. Run38821167567 passed335 Worker tests and frontend CI; its desktop journey reached payment and confirmation but an immediate second read met the real five-second quota.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#mechanism-browser-transport-and-checking-evidence--16-october-2026).

### Main CI weekday fixture failure — 16 October 2026

Owner merged PR33 as6a88134. Main run38816624792 failed frontend unit verification: two booking receipt tests expected8800 but received10800 after Singapore midnight made their real-clock tomorrow a Saturday.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#main-ci-weekday-fixture-failure--16-october-2026).

### HAR03 holding request rejected before provider dispatch — 15 October 2026

PR32 merged/deployed40cca80; main run38755799186 succeeded. HAR02 exposed reset sandbox flags; these were restored/read back with unrelated bindings and secrets preserved.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har03-holding-request-rejected-before-provider-dispatch--15-october-2026).

### Owner HAR: Review booking interrupted — 15 October 2026

PR31 merged as1971d26; GitHub main run38747070570 passed verification and deployment. Owner registered completed/failed HitPay webhook and replaced placeholder salt; sandbox activation was separately read back.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-har-review-booking-interrupted--15-october-2026).

### Preserve hosted navigation until document unload — 15 October 2026

PR31 run38742439558 passed frontend/backend gates and the desktop live checkout journey. Phone/tablet WebKit exposed a second race: setting checkout success after location.assign lets the route guard issue an internal payment navigation before the external document commits.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#preserve-hosted-navigation-until-document-unload--15-october-2026).

### HitPay browser handoff correction and activation request — 15 October 2026

PR31 run38740776215 passed frontend and Worker checks but the live-email journey failed on all three browser projects: the route guard changed review to /book/payment/ while protected HitPay context was still loading, unmounting review and cancelling its request. Keep review mounted during the active live checkout handoff; cancellation/unknown outcomes retain existing recovery behavior.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#hitpay-browser-handoff-correction-and-activation-request--15-october-2026).

### Direct HitPay final local verification — 15 October 2026

Final non-browser application verification passed177 unit tests plus source/tooling/lint/types and the production export. Final Worker verification passed333 tests with zero failures/skips and zero provider requests.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#direct-hitpay-final-local-verification--15-october-2026).

### Direct hosted HitPay implementation resumed — 15 October 2026

Owner approves source implementation and hosted HitPay navigation after disclaimer; no intermediate payment screen. Owner moves fresh availability checking to after Details and requires retained details on calendar reselection.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#direct-hosted-hitpay-implementation-resumed--15-october-2026).

### Post-reset verification and ongoing email preparation — 15 October 2026

Live health/SQL confirmed deployedb20f481/versionfdd603d2, both admission indexes and1 row read for each targeted indexed query. Catalogue and October calendar succeeded.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#post-reset-verification-and-ongoing-email-preparation--15-october-2026).

### Coordinator optimization and security-widget layout — 14 October 2026

Owner reports roughly1,461 rows per admission query and4,690,285 daily rows read. Source optimization adds two indexes without relaxing provider limits or deleting history.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#coordinator-optimization-and-security-widget-layout--14-october-2026).

### Deployed customer rule; final month exposes token timing — 14 October 2026

PR27/source95df33c passed172 local unit/component tests and all three PR gates, merged as9d1d107, then passed all main gates and GitHub Cloudflare deployment. Worker suite303 and live browser15 passed; user browser execution and paid/webhook acceptance remain separate.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#deployed-customer-rule-final-month-exposes-token-timing--14-october-2026).

### Owner replaces customer 48-hour lead — 14 October 2026

YS sets the latest business decision to 2.5 hours before session start and explicitly confirms it supersedes 48 hours. Implementation shares 150 minutes across customer display and server checks; finite historical trials remain unchanged.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-replaces-customer-48-hour-lead--14-october-2026).

### Homepage browser gate catches impossible-date display reads — 14 October 2026

CI38508429832 passed Worker boundaries and frontend browsers. The expanded native homepage flight rejected two pre-Continue daily requests for today, while retaining the expected four calendar requests and one catalogue request.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#homepage-browser-gate-catches-impossible-date-display-reads--14-october-2026).

### Homepage public metadata regression alignment — 14 October 2026

CI38507816042 rejected the old ongoing-access assertion that anonymous /api/catalogue returns401. The authorized homepage contract now returns only public service metadata.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#homepage-public-metadata-regression-alignment--14-october-2026).

### Owner refines homepage prefetch and loading presentation — 14 October 2026

While PR27 cold-cache CI ran, YS requested immediate homepage warming, no new cache request on guest/email entry, a larger centred spinning logo without visible status text, and a check of Details ordering. Inspection found public months already start on homepage but member/service transitions could restart reads; session metadata was only fetched after entry.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-refines-homepage-prefetch-and-loading-presentation--14-october-2026).

### Live prices verified; reproduce cold-prefetch expiry before repair — 14 October 2026

PR26 passed all PR/main gates and deployed46b3201/versiona42014f2-3171-401c-ba78-9ce1d3cf0d46 through successful GitHub run38504874365. October public offers now validate at the intended two native service prices.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#live-prices-verified-reproduce-cold-prefetch-expiry-before-repair--14-october-2026).

### Preserve two deployment findings and repair their owners — 14 October 2026

PR25/source45655ab passed all three gates, merged asb8917b1, and all three main gates passed. GitHub uploaded and activated Worker75b5c5d8 at10:51 Singapore, but its immediate health response still named36b84bd.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#preserve-two-deployment-findings-and-repair-their-owners--14-october-2026).

### Complete browser cache, branded loading and dual native prices — 14 October 2026

Owner requested immediate cached date/time selection, fresh validation at main Continue, SoccerBot spinning-logo loading throughout booking, and SGD88 weekday / SGD108 weekend/public-holiday native checkout. Created premium service3 with the explicitly approved three providers.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#complete-browser-cache-branded-loading-and-dual-native-prices--14-october-2026).

### Replace experiment closure with ordinary customer access — 14 October 2026

YS asked to remove automatic live-access closure, enable native checkout continuously and deploy from GitHub. Clarified that private browsing resets browser state but shares the backend/cache and produces real booking/payment effects.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#replace-experiment-closure-with-ordinary-customer-access--14-october-2026).

### Physical calendar inspection preparation — 14 October 2026

Fresh Cloudflare settings confirm a39cee7 deployed, provider/delivery disabled, end0, ceiling704 and no public calendar window. YS requested live access after observing unavailable session information.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#physical-calendar-inspection-preparation--14-october-2026).

### Post-merge diagnostic assertion collision — 14 October 2026

PR22 merged as4536186. Main run38476420076 passed frontend, live-email and Pages deployment, but backend passed294/295 Worker cases: the privacy assertion's unanchored2099 marker matched the generated correlation UUID, not leaked provider data.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#post-merge-diagnostic-assertion-collision--14-october-2026).

### Protected reload readiness — 14 October 2026

CI run38444619826 passed backend and live-email, including the repaired native guest journey on all three browser projects and295 Worker cases. Frontend passed165 unit/component cases and68 browser cases; one phone-WebKit synthetic reload assertion expired while its protected checkout read was still pending.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#protected-reload-readiness--14-october-2026).

### WebKit exposed a calendar clock race — 14 October 2026

CI run38442449150 passed frontend and all295 live Worker cases, but the live guest journey timed out on phone/tablet WebKit clicking a disabled known-available date. The provider receipt was newer than BookingProvider's minute-based display clock, so the freshness upper bound rejected it until the next minute.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#webkit-exposed-a-calendar-clock-race--14-october-2026).

### Final local checks and inventory correction — 14 October 2026

Full website non-browser verification passed with164 unit/component cases, production build and export checks. All295 Worker cases passed with zero failures/skips, but the verification wrapper correctly rejected the reviewed inventory because its file ordering differed from Node execution ordering.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#final-local-checks-and-inventory-correction--14-october-2026).

### Finish pending code and deploy — 14 October 2026

YS requested completion and deployment. Refreshed PR22/local b2862e0 and retained preceding changes.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#finish-pending-code-and-deploy--14-october-2026).

### Interface-first North Star and calendar cache — 14 October 2026

YS requested a North Star making the live interface1:1 with demo first, retaining Turnstile and security additions, and explicitly removed trainer priority. YS then requested shared prefetch up to four months and updating both view/cache after failed selection.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#interface-first-north-star-and-calendar-cache--14-october-2026).

### Owner rejects homepage detour; readiness checked — 14 October 2026

Owner clarified that customers must not open SimplyBook homepage and asked whether the website is ready. Inspected local HEAD/status and relevant source: b2862e0, documentation-only modifications, unchanged direct checkout anchor and no browser initialization candidate.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-rejects-homepage-detour-readiness-checked--14-october-2026).

### Invoice34 body and fuller journey proposal — 14 October 2026

Owner supplied actual invoice-details body linking34 to confirmed booking43 for SGD88, not released by timeout, but with status paid / payment_received false / processor delay / null payment date. Recorded safe projection; no payment acceptance inferred.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#invoice34-body-and-fuller-journey-proposal--14-october-2026).

### Homepage-first checkout34 rendered after displayed due time — 14 October 2026

Owner reports loading the public homepage, then opening the original reference34 link exactly once in this trial at00:09 Singapore on14October. Supplied screenshot shows checkout with HitPay option,Payment pending,Pay later,$88,Kickoff Special15October19:00,created13October17:48 and due13October18:18.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#homepage-first-checkout34-rendered-after-displayed-due-time--14-october-2026).

### Broader community research: related precedents, no exact verified fix — 13 October 2026

YS requested looking beyond documentation. Searched WordPress support, Reddit, Stack Overflow, GitHub, runtime issue trackers, general web and provider user reports.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#broader-community-research-related-precedents-no-exact-verified-fix--13-october-2026).

### Existing-evidence diagnosis replaces repeated checkout experiments — 13 October 2026

YS challenged repeated403 tests and authorized analysis of retained evidence instead. Compared six exact b2862e0 source owners and public provider/HTTP documentation; app link flow matches documented generate-and-redirect contract.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#existing-evidence-diagnosis-replaces-repeated-checkout-experiments--13-october-2026).

### Same original reference34 link reaches both checkout and e403 — 13 October 2026

Owner confirms pasting the same provider-issued /v2/client/pay-later/id/{id}/hash/{token} entry link. Success redirects to #invoice/pay/{id}/direct-link/1; failure redirects to #error/e403.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#same-original-reference34-link-reaches-both-checkout-and-e403--13-october-2026).

### Native checkout34 reached intermittently with30-minute window — 13 October 2026

Owner requested one more native test opening immediately, proposed a temporary payment timeout30 minutes, and reported the change complete. Manual protocole208ef1793fe bounded one new booking/link/navigation, existing automatic test notifications, no payment or retry, and restoration to10 minutes.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-checkout34-reached-intermittently-with30-minute-window--13-october-2026).

### Native invoice33 exists; displayed due time confounds the control — 13 October 2026

Owner supplied SimplyBook invoice detail #O-0000033: Pending payment / Pending(Pay Later), created13October17:02, due13October17:12, matching existing test client, Kickoff Special15October18:00,quantity1,SGD88,tax0. This establishes the SimplyBook invoice/order exists despite SBPay showing no related invoice document.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-invoice33-exists-displayed-due-time-confounds-the-control--13-october-2026).

### SBPay transaction33 explicitly has no related invoice document — 13 October 2026

Owner supplied transaction33 detail and status-log screenshots: Pending Pay later,SGD88, existing test customer39; booking line Kickoff Special15October18:00,quantity1, with Nabil tag. Created and last changed both display13October17:02.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#sbpay-transaction33-explicitly-has-no-related-invoice-document--13-october-2026).

### Native control exact error and post-failure pending state — 13 October 2026

Owner supplied the exact reference33 response {"error":"Access denied","data":[]} and confirmed payment remains Pending after the403. This matches the earlier invoice32 error; no visible timeout cancellation explains the current control, though pending alone does not prove every link/session authority remains valid.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-control-exact-error-and-post-failure-pending-state--13-october-2026).

### Native emailed link reproduces invoice-details403 with cookies sent — 13 October 2026

Owner approved successor manual packetb750ac59776c to open existing payment reference33 email link once after reporting it still pending and previously unopened. No new booking/link or Worker action.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-emailed-link-reproduces-invoice-details403-with-cookies-sent--13-october-2026).

### Native dashboard Pay Later link issued; navigation stopped — 13 October 2026

Owner approved sealed manual packet36f2efe5b74a for one existing-test-client/Nabil/Kickoff Special booking on15October18:00–18:50, leaving the displayed50-minute interval unchanged as a native-path control, not app40-minute acceptance. Pending (Pay Later) was selected.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-dashboard-pay-later-link-issued-navigation-stopped--13-october-2026).

### Ten-minute payment timeout compared with original failure — 13 October 2026

Owner reports the payment timeout is10 minutes. Invoice32 dashboard creation is15:41 Singapore (minute precision); retained handoff occurred15:41:32 and the owner failure report was received15:43:33.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#ten-minute-payment-timeout-compared-with-original-failure--13-october-2026).

### Invoice 32 now cancelled by timeout — 13 October 2026

Owner dashboard screenshot shows invoice #O-00000032, SGD88, created 13 October 15:41, item 15 October 16:30, payment status “Cancelled by timeout” and no payment received shown. Rows31 and30 visibly show the same status.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#invoice-32-now-cancelled-by-timeout--13-october-2026).

### Owner allowance snapshot and closed browser log — 13 October 2026

YS reported the original Network log closed, leaving native cookie/session handling unverified. Later supplied account valid until19October2026,6 days displayed,9 bookings remaining and0 SMS/WhatsApp/AI booking credits; blank custom-feature allowance recorded as unknown.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-allowance-snapshot-and-closed-browser-log--13-october-2026).

### Invoice403 authorization traced against source and public contract — 13 October 2026

YS authorized investigation after supplying GET invoice-details403 and Access denied. Verified five exact b2862e0 source owners and the private handoff shape without publishing its hash.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#invoice403-authorization-traced-against-source-and-public-contract--13-october-2026).

### Fresh native link isolates a403 invoice-access failure — 13 October 2026

After YS requested the next step, prepared b78955c40c72 using the same exact tested b2862e0 artifact and current25-migration state. A new complete-history SELECT consumed1 management request, bringing the carried count532.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#fresh-native-link-isolates-a403-invoice-access-failure--13-october-2026).

### Checkout-opening diagnostic stopped at availability — 13 October 2026

YS chose desktop Chrome/Edge and approved sealed ae8d4e8ba18b once. CI38360169797 passed frontend/backend/live-email on b2862e0; exact artifact11795270145 and287 Worker tests verified.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-opening-diagnostic-stopped-at-availability--13-october-2026).

### Checkout-only diagnostic source prerequisite — 13 October 2026

YS authorized proceeding with the next fresh checkout-opening diagnostic. Preparation found native_checkout_grants still capped624 while carried usage is618, so even the32-call availability admission cannot proceed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-only-diagnostic-source-prerequisite--13-october-2026).

### Owner readback narrows checkout investigation — 13 October 2026

YS answered: “1. Yes 2.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-readback-narrows-checkout-investigation--13-october-2026).

### Native settings checked through the connected account — 13 October 2026

After YS authorized the next read-only step, verified the connector company matches configured developer identity, then read Accept Payments and the complete90-feature list. Accept Payments is enabled/configured; Client Login is off; Take Me Back Home is on, differing from the historical off state.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-settings-checked-through-the-connected-account--13-october-2026).

### Read-only checkout diagnosis — 13 October 2026

YS requested diagnosis after confirming the link came directly from SimplyBook. Local/remote branch heads remainadd9cc2; retained outcome documentation is uncommitted.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#read-only-checkout-diagnosis--13-october-2026).

### Owner payment flight reached an immediate checkout 404 — 13 October 2026

YS approved packet301173108ab6 and the finite amended budgets. Exact-source CI38355111288 passed all three gates onadd9cc2, artifact11792912177 verified151 sealed files/287 Worker tests.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-payment-flight-reached-an-immediate-checkout-404--13-october-2026).

### Checkout verification selected; finite budget source prepared — 13 October 2026

YS says "verify on checkout", removing the dashboard-name lookup dependency. Added explicit704 policy support because the proposed80-call payment/capture flight cannot fit the remaining57 ordinary calls under640.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-verification-selected-finite-budget-source-prepared--13-october-2026).

### Owner requests payment before further webhook investigation — 13 October 2026

YS reports that SimplyBook provides no developer support, asks to test payment first, and suggests payment-link completion may activate callbacks. YS explicitly agrees to prepare an owner-operated payment test.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-requests-payment-before-further-webhook-investigation--13-october-2026).

### Paired-control ingress investigation completed — 13 October 2026

Following YS's “ok lets do that”, used a bounded five-request maximum read-only inspection; four management requests were consumed. The first callback-prefix query returned zero events through 12:31:07 Singapore.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#paired-control-ingress-investigation-completed--13-october-2026).

### Paired control executed; no signed receipts on either channel — 13 October 2026

Retained preparation failures: packet221ce3fe2188 stopped before live mutation because its expected subscription fingerprint came from a prior preservation subset with two rows, omitting that prior flight's own closed third record. A read-only closure proved all23 historical tables unchanged.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#paired-control-executed-no-signed-receipts-on-either-channel--13-october-2026).

### Paired webhook control preparation — 13 October 2026

After the owner said “ok do it”, implemented separate fixed capture routes for booking and invoice notifications. Structural-only capture cannot safely infer event identity, so immutable per-window scope metadata isolates the diagnostic channels without storing payload values.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#paired-webhook-control-preparation--13-october-2026).

### Deeper diagnosis identified an unproven event prerequisite — 13 October 2026

YS requested looking deeper. Rechecked the exact subscription destination/event proof and fixed-origin routing, extended stored-log search through10:44:54 Singapore, read Cloudflare Access/subdomain configuration and retained subscription2's closed local reference.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#deeper-diagnosis-identified-an-unproven-event-prerequisite--13-october-2026).

### Read-only delivery diagnosis completed — 13 October 2026

After YS said “ok determine”, compared stored developer HTTP telemetry with the sealed test's request IDs. All 14 expected operator requests matched correlation ID and status; all returned events were untruncated.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#read-only-delivery-diagnosis-completed--13-october-2026).

### Live acknowledgement fix accepted; no signed receipt at observation — 13 October 2026

YS approved packet7ec56094976f and amended limits. Exact-source CI and the282-test artifact were verified before execution.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#live-acknowledgement-fix-accepted-no-signed-receipt-at-observation--13-october-2026).

### DELETE acknowledgement regression and repair — 13 October 2026

YS requested resolving response handling and another acceptance test after the empty active list was verified. Official webhook documentation describes DELETE and active-list semantics without prescribing the DELETE body.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#delete-acknowledgement-regression-and-repair--13-october-2026).

### Empty active list confirmed after unknown DELETE — 13 October 2026

After clarifying that subscription DELETE does not cancel a booking, YS requested the read-only check and approved the one-extra-deployment amendment31→32. Packet1089bf8b452a reused tested source1e6bfbe and executed one authenticated active-list read.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#empty-active-list-confirmed-after-unknown-delete--13-october-2026).

### Cleanup crossed the parser guard and stopped at DELETE response — 13 October 2026

YS approved packet10c62a001eea with amended limits, then asked for status. The packet executed once on CI-passing source1e6bfbe.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#cleanup-crossed-the-parser-guard-and-stopped-at-delete-response--13-october-2026).

### Subscription flag mismatch repaired in its owner — 13 October 2026

YS requested “ok fix” after the read-only diagnostic. A new lifecycle regression with string flags failed on the prior numeric-only parser with `webhook_subscription_proof_incomplete`; the private failing receipt is retained.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#subscription-flag-mismatch-repaired-in-its-owner--13-october-2026).

### Actual subscription string mismatch observed — 13 October 2026

After YS approved packet46b93ebc17fa7, its exact CI-passing source27f03fc executed one active-subscription read. Five physical calls advanced455→460.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#actual-subscription-string-mismatch-observed--13-october-2026).

### Webhook flight stopped; access closed, subscription unresolved — 13 October 2026

Packet `b918a81d06e991549f9d67e449098bf87e8109bc9ea6affc98d69d7773d06a99` executed once under the approved campaign on source `f2e0a3e91824f569a161f29447471d5081259719`. All three gates passed in CI38313369930; artifact11776470322/SHA256 `ed0207005a4ce1a38bc3f8c9302e05895be968d9afbeddf40a05d5725c3d1e14` matched150 sealed files and273 strict Worker tests.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#webhook-flight-stopped-access-closed-subscription-unresolved--13-october-2026).

### Approved technical payment/webhook campaign — 13 October 2026

Current subscription increment: all273 Worker runtime tests passed with zero failures/skips and no external provider calls; generated types, source/policy guards, affected lint and checker regressions passed. The packaged release now verifies preservation through pending0022/0023.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#approved-technical-paymentwebhook-campaign--13-october-2026).

### Subscription source verification — 13 October 2026

The first focused run retained six passing and two failed subscription cases: immediate create-to-cleanup transition hit the existing four-per-second account limiter because each operation initialized pacing at zero. Initialize each bounded operation's first admission at the current time, preserving the300ms physical-request spacing across the boundary.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#subscription-source-verification--13-october-2026).

### Payment/webhook investigation and first repair — 13 October 2026

YS approved merging PR21 because of its size. It merged as383cc2e at00:17:30Singapore; main CI38276366243 passed frontend/backend/live-email and demo deployment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#paymentwebhook-investigation-and-first-repair--13-october-2026).

### Developer native booking accepted and independently closed — 13 October 2026

Packet `217dfd4e4df2` executed once after YS approved the exact packet and amended resource limits. Source `8bd66c1` passed all three CI gates in run `38273011816`; artifact `11758121123` matched 148 sealed files, 257 Worker tests and all 21 immutable migrations.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#developer-native-booking-accepted-and-independently-closed--13-october-2026).

### Owner roster and instructor priority — 12 October 2026

YS supplied the October 2026 roster and explicitly set instructor priority **Faisal → Caelan → Nabil** when multiple instructors are available. Apply priority only among instructors eligible and freshly available for the entire selected session; do not replace an unavailable preferred instructor with an unverified one.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-roster-and-instructor-priority--12-october-2026).

### Approved setup inspection completed and closed — 12 October 2026

Packet `87a458a946d513e8e466dcf52f1f0cc9888d7bdf313cd1c0b347224bec94f87e` consumed the explicitly approved read-only scope on source `3af1323eda250b29f2bd95e2583d5dc49cbe161b`. Company, service 2, instructor 3 and combined working-hour reads all returned 15 October 09:00–21:00 Singapore and an empty interval list for 16 October.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#approved-setup-inspection-completed-and-closed--12-october-2026).

### Full native acceptance execution resumed — 12 October2026

YS instructed “execute it now” against the consolidated full native acceptance draft. Continue technical implementation, evidence-backed discovery preparation, tests and PR21 publication.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#full-native-acceptance-execution-resumed--12-october2026).

### Native campaign stopped on actual date availability — 12 October2026

Sealed packet3f6019db7880 ran sourcee122ba5 after all-three CI38236452119/artifact11740802365 passed. The authenticated15–29October calendar returned14 start times on15October and no other offered date.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-campaign-stopped-on-actual-date-availability--12-october2026).

### Actual calendar discovery before the final native gate — 12 October2026

Flight4 accepted single booking35/invoice27; its independent22October availability probe returned zero offers. Two Cloudflare settings GET timeouts during closure were both charged as unknown management reads.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#actual-calendar-discovery-before-the-final-native-gate--12-october2026).

### Native single proof accepted and closed — 12 October2026

Flight4 consumed packet50e2a1263ac7 on24153c3, all-three CI38232933900/artifact11740055253. single proof at15 October 14:00Singapore: bookings35, invoice27, 1 signed confirmed booking reads, authoritative unpaid invoice, SGD88/tax0 and one native link retained unopened. Attempt375bbc00-297f-43fd-9671-2b0961aa5979 is observed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-single-proof-accepted-and-closed--12-october2026).

### Availability-only stop and actual-attempt accounting — 12 October2026

Flight3 consumed packet8e6824f42e2b on ee2853a (all-three CI38230887077/artifact11739086074).16October returned zero offers. The grant cache and request ledger prove no prepare/native POST, no attempt and no booking dispatch.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#availability-only-stop-and-actual-attempt-accounting--12-october2026).

### 12 October — same-date native checkout accepted

Flight2 used exact-source6ac6165 from all-green CI38229148061/artifact11737163517 under sealed packet5eb211c4ac62. New15October12:20/13:10Singapore selections completed batch7/bookings33/34 and invoice26.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october--same-date-native-checkout-accepted).

### 12 October — first autonomous flight reaches batch closure

The exact-source a206106 artifact passed all three CI38226503628 gates. Sealed packet dea4fe21baae ran once under YS's bounded campaign approval, applied0021 preserving history, and selected15October10:40/11:30Singapore.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october--first-autonomous-flight-reaches-batch-closure).

### Owner requests execution to native acceptance — 12 October2026

Current public book-response prose permits multi-entry batch responses; the accompanying recurring example does not supply aliases or a membership rule. A reproduced synthetic cumulative response failed on old code at the observed creation.bookings/mismatch.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-requests-execution-to-native-acceptance--12-october2026).

### Approved live trial reaches the second book — 12 October2026

YS approved exact packet c0916326b895 after the limits amendment and final-source CI. Artifact11735290126 bound6bc54f7,147 sealed files and241 passing Worker cases.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#approved-live-trial-reaches-the-second-book--12-october2026).

### Live test requested; amended limits approved — 12 October2026

After the batch-association correction passed all three final-source CI38220464328 gates, YS requested live testing. The carried196/224 ledger leaves12 ordinary calls and cannot admit normal availability/checkout.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#live-test-requested-amended-limits-approved--12-october2026).

### 12 October2026 — local experiment for missing batch echo

YS requested “start experiment” after the approved follow-up identified creation.batch_id/missing. Refreshed current6759773/PR21 and canonical evidence.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october2026--local-experiment-for-missing-batch-echo).

### 12 October2026 — approved follow-up reached batch membership validation

YS approved sealed packet a14dfea95559506c2a78c664d9436a22e29cfd38587a355399b5ab1139f27c4e with “approved, go”. Executed exact4671f3791560f9a7d09ba87de1643130a8267b69 after all three CI38217379501 gates passed and live-email artifact11732905946/archive2f0215674d0abe1085521e7bafead7e9cadbf026dd1304238b6ed4873afedf47 verified146 sealed files.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october2026--approved-follow-up-reached-batch-membership-validation).

### 12 October2026 — prepare owner-requested follow-up experiment

YS requested another experiment after the precise require_payment correction and all three final-source CI38216192722 gates passed. Checked local/remote d21e2b8 and the private independent closure receipt.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october2026--prepare-owner-requested-follow-up-experiment).

### 12 October2026 — exact approved diagnostic found the first failing field

YS approved sealed packet5a170ff0d98c54ff012d4980d8138942238afc9e0db1e61dd55bf717e30b82c7 with “approve go”. Executed exact source47b37dbb46480e66e17cfa763bb2acff1ea2b574 after all three CI38213290654 gates passed and artifact11729658054 verified145 sealed files (archive SHA2567f8b9247c1a30081b70e99ccac078d8c79eaf5bef9cfd5b03d66c5c1181a4967).

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october2026--exact-approved-diagnostic-found-the-first-failing-field).

### 12 October 2026 — audit the intermediate creation contract before a new proof

YS requested all three proposed steps: inspect official contract/examples, compare every consumed field, correct demonstrated mismatches with tests, and prepare a bounded diagnostic proof if documentation remains incomplete. Reviewed the public wiki's actual response-example section, current API index and provider staff batch/client-signature guidance.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october-2026--audit-the-intermediate-creation-contract-before-a-new-proof).

### 12 October 2026 — actual retained-booking read passed all independent predicates

Owner approved packet120046b5 with “Approve, go”. Preflight corroborated the handover closed version,125/192/active0,18 applied migrations and exact retained key/session custody.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october-2026--actual-retained-booking-read-passed-all-independent-predicates).

### 12 October 2026 — owner requests a real format read

YS challenged continuing from guessed response semantics and requested a current read checked against all applicable fields. The preceding private-diagnostics source a9ecf38 passed all three CI38207930497 jobs.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october-2026--owner-requests-a-real-format-read).

### 12 October 2026 — diagnose the failed192 checkout without another booking trial

Owner handover reports the approved exact192 packet executed from5dacab5, applied0018 with historical preservation, passed readiness/availability/immutable preparation and retained one batch/booking. Integration validation stopped at book/session0 with native_representation_unverified and125 cumulative provider calls after independent cleanup reads.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october-2026--diagnose-the-failed192-checkout-without-another-booking-trial).

### 12 October 2026 — owner-approved192 preparation after budget preflight

Cart lifecycle source9843246 passed all three CI38201415046 gates and229 local Worker tests. User requested the live checkout proof.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#12-october-2026--owner-approved192-preparation-after-budget-preflight).

### Owner corrected unfinished-cart interpretation — 12 October 2026

The approved residual-only pass installed the verified source, passed readiness and read the retained booking. No invoice reference was present.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-corrected-unfinished-cart-interpretation--12-october-2026).

### Corrected identity proof retained a partial booking — 12 October 2026

Exact-source CI for6e845cb passed all three gates after the preview diagnostic correction. Its approved developer proof passed baseline/active readiness, availability and immutable preparation, then returned recovery_required.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#corrected-identity-proof-retained-a-partial-booking--12-october-2026).

### Preview failure reporting during identity-fix CI — 12 October 2026

The corrected identity source passed backend and live-email CI, including224 Worker cases and their browser/release gates. Frontend passed68/69 browser cases; one tablet synthetic checkout received HTML404 instead of200.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#preview-failure-reporting-during-identity-fix-ci--12-october-2026).

### Idle readiness passed; identity expiry reproduced and repaired — 12 October 2026

The exact approved idle-lifecycle experiment passed baseline, activation and closure readiness. Availability and immutable preparation succeeded; native checkout stopped before effects at provider_identity_expired while reading catalogue instructors for the second session.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#idle-readiness-passed-identity-expiry-reproduced-and-repaired--12-october-2026).

### Configuration mismatch isolated; owner requests a controlled fix — 12 October 2026

The latest finite proof confirmed Worker activation while protected coordinator readiness retained the previous disabled configuration. All bounded observations agreed; execution stopped before native authority, provider calls or bookings, then verified closure.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#configuration-mismatch-isolated-owner-requests-a-controlled-fix--12-october-2026).

### Approved128 proof closed before provider dispatch — 12 October 2026

YS approved the exact finite packet. It applied0017 while preserving all historical rows and installed the reviewed128 policy.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#approved128-proof-closed-before-provider-dispatch--12-october-2026).

### Owner-approved128-call preparation — 12 October 2026

YS approved preparing a128-call cumulative continuation with33 already consumed and16 reserved for recovery. Implemented an explicit80-or128 configuration policy with80 as the committed default, preserving the account/campaign ledger and old per-grant limits.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-approved128-call-preparation--12-october-2026).

### Native prerequisite diagnosis source — 12 October 2026

Inspection found orchestration deliberately converted preflight failures into prerequisites_unavailable while the finite checkout retained no private cause. Added a bounded private diagnostic in the existing grant result, with observation of existing prebooking reads.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-prerequisite-diagnosis-source--12-october-2026).

### Signing amendment execution and closure — 12 October 2026

YS explicitly approved the prepared signing amendment. Execution applied only0015/0016, preserved every historical row, uploaded the exact sealed native release and installed the missing encrypted binding.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#signing-amendment-execution-and-closure--12-october-2026).

### Backend proof first stop — 12 October 2026

After explicit owner approval, the backend proof ran its first two read-only management checks at00:14:28–00:14:29SGT. The current deployment version matched the expected baseline, but the returned binding inventory lacked the required native signing secret.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#backend-proof-first-stop--12-october-2026).

### 11 October — native uncertainty and compensation continuation

YS requested native booking be carried through settlement rather than stopped at another PR checkpoint. Inspection found returned references could be lost before strict creation validation, and a failed checkout handoff could leave saved state dispatching.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#11-october--native-uncertainty-and-compensation-continuation).

### Native browser fixture correction — 11 October

At2972d2d, CI38135134330 passed the Worker gates and all12 existing live identity/browser cases. The three new native journey cases stopped at the Details action because the new fixture asked for a button named Continue; the existing product action is Review booking (also used by the original customer suite).

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-browser-fixture-correction--11-october).

### 11 October — customer-native continuation after5878001

Checkpoint5878001 passed CI38133435815. Continued immediately into native availability/selection/Details/Review/preparation/checkout/restore in the existing owners, with no provider or remote account operations.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#11-october--customer-native-continuation-after5878001).

### 11 October — native checkout implementation and owner configuration confirmation

Owner answered that tax is disabled,S$88 is the full total,40+10minutes is configured and Client Login is disabled. Implemented a scoped expiring owner declaration, fresh guest/native-client separation, native multi-session batching/line joins, durable keys and signed known-ID recovery, and a finite protected checkout composition under new empty0016.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#11-october--native-checkout-implementation-and-owner-configuration-confirmation).

### Metadata discovery accepted and closed — 11 October 2026

YS approved packet SHA256 `e535f54372e47d6cde632f8b643b91dd669cb90eade2efbcdc9c50343831321a` in this session. Executed10:07:35–10:09:04UTC (18:07:35–18:09:04SGT),89.318 seconds within the20-minute limit.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#metadata-discovery-accepted-and-closed--11-october-2026).

### 2026-10-11 — Defer physical flight until native and webhook technical completion

YS asked for webhook instructions after native technical readiness, with a strong directive to resolve the integration, and clarified that the whole flight should be tested together. Recorded one combined acceptance stage, preserving automated/contract validation now and physical acceptance pending.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-11--defer-physical-flight-until-native-and-webhook-technical-completion).

### 2026-10-11 — Execute the six native completion items

YS asked to draft and execute the six remaining native-booking items, then merged PR20 after exact head2d48ed0 CI38128735760 completed frontend/backend/live-email successfully. Verified merge25aac892.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-11--execute-the-six-native-completion-items).

### 2026-10-11 — Final native checkout decisions

Every booking automatically attempts a Comments entry `Number of players: N` (default1, range1–4). When the optional fifth Details field is filled, append `School / organisation: VALUE` on the next line; omit that line when blank.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-11--final-native-checkout-decisions).

### 2026-10-11 — Native-first North Star and one-studio clarification

YS requested the full plan and immediate execution with native booking followed by webhooks. Refreshed cleanf881510/PR20 and green three-job CI38116387515; drafted the complete dependency sequence through client UAT/launch/support.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-11--native-first-north-star-and-one-studio-clarification).

### 2026-10-11 — Remember me consent and reachable contact editing

YS specified that contact details save only when Remember me is selected, on Details form submission, without a separate booking save button or duration in the label. The90-day absolute policy remains.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-11--remember-me-consent-and-reachable-contact-editing).

### 2026-10-11 — Owner replaces provider-only prefill with website contact profile

YS explicitly selected latest name/phone confirmed on this website, including one shared profile for a shared email and no changes to old bookings. This replaces the prior prerequisite for SimplyBook-only prefill.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-11--owner-replaces-provider-only-prefill-with-website-contact-profile).

### 2026-10-11 — Merged North Star execution package

Owner merged PR19 at298c9c8f443063f8b21a2e7b006993a1ec76a9e7. Main CI38112617043 passed all three verification jobs and Pages deployment; this is separate from PR-headc2f2506/CI38049449145 and deployed Worker4a10133.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-11--merged-north-star-execution-package).

### 2026-10-10 — PR19 owner proof and explicit closure

User approved the exact37-management/4-deployment packet and confirmed two-profile readiness. Seven preflight reads matched closed sourcef2795a1/version3bb98b99, secret binding types, no schedules,0001–0012 schema/history and two closed windows.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-10--pr19-owner-proof-and-explicit-closure).

### 2026-10-10 — PR18 merge and finite identity-proof preparation

Owner merged PR18 atfe179d205437850884d5fb5dc7ed177245ccead9. Main independently passed38044816610 frontend/backend/live-email and Pages deployment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-10--pr18-merge-and-finite-identity-proof-preparation).

### 2026-10-10 — PR18 release-preservation checker repair

Candidate47cc928 CI38043587921 passed172 Worker cases and9 live-browser executions before sealed-release validation failed on a read of `_cf_METADATA.key` with SQLITE_AUTH. The new preservation inventory accidentally included D1's protected internal table.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-10--pr18-release-preservation-checker-repair).

### 2026-10-10 — M3.5 source continuation from merged PR17

Refreshed GitHub and local state: main2f08b1c contains PR17/headb94b14a and PR16 functionality; main's separate CI38041760947 passed. Preserved the clean historical experiment checkout897cbfe and opened a new feature worktree.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-10--m35-source-continuation-from-merged-pr17).

### 2026-10-10 — Quotation A3 and next quick-rebooking North Star

Owner clarified that quick rebooking is a core requirement, then supplied APP404-SBS-Q-WEB-001.pdf. Read p3 A3 directly: verified approved SimplyBook name/phone prefill, customer review/correction, safe duplicate/shared-email handling and expiring single-use verification/rate limits.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-10--quotation-a3-and-next-quick-rebooking-north-star).

### 2026-10-10 — Owner email test and explicit closure

Replacement sourcef2795a1 passed all three CI jobs and local139-file seal plus17 compiled-Worker cases. Approved0012 preserved the original closed record and every baseline table fingerprint.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-10--owner-email-test-and-explicit-closure).

### Unused email window replacement — 10 October 2026

The first live-email candidate087576ed was deployed after preserving original asset202 and URL-check failures; corrected account HTML/sitekey JS matched sealed bytes. Source/version readiness passed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#unused-email-window-replacement--10-october-2026).

### 2026-10-10 — Email activation packet review

Reconciled owner Dashboard setup and five approved read-only checks: initial plaintext bindings were corrected by owner, then secret_text types verified. Prior deployment budget is exhausted; unknown Dashboard usage remains explicit.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-10--email-activation-packet-review).

### 8 October 2026 — Developer integration continuation

Fresh deployed Worker authentication now succeeds for both public and admin credentials; company login matches and booking allowance is26/50. Four durably reserved requests, active0; operator grant closed after identical read-back.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--developer-integration-continuation).

### 2026-10-04 — Frontend foundation

### Inputs and authority

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-04--frontend-foundation).

### 2026-10-04 — Documentation/process review before GitHub

### Scope and reviewed sources

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-04--documentationprocess-review-before-github).

### 2026-10-04 — Reference restoration and standardized guarded update

### Baseline, authorization and root cause

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-04--reference-restoration-and-standardized-guarded-update).

### 4 October 2026 — macOS temporary-directory repair

- User reached Node 24.19.0, then the delivered installer refused its own temporary candidate under `/var/folders/.../T`. The stack ends in candidate preflight, before backup or source application.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--macos-temporary-directory-repair).

### 4 October 2026 — case-insensitive filesystem test repair

- User's macOS receipt confirms the restoration applied and source/policy gates passed. The tooling gate executed 43 cases: 41 passed and two failed (`rejects case-colliding files`, `rejects case-colliding parent directories`).

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--case-insensitive-filesystem-test-repair).

### 4 October 2026 — restore the required installer delivery format

- User supplied the completed macOS run of `SoccerBotStudioSG_MacOS_Checks_2026-10-04.sh`: 45 tooling, 24 installer and 29 application/component cases passed, with formatting, lint, types, exact unit receipt and production export. Node was 24.19.0 and npm 11.17.0.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--restore-the-required-installer-delivery-format).

### 4 October 2026 — local verification format corrected

The user supplied `Fitfinity_Package_Messages_Local_2026-10-04.sh` and `Fitfinity_Package_Reactivation_PR_2026-10-04.sh`. Both were decoded and inspected as text, never executed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--local-verification-format-corrected).

### 4 October 2026 — correct headless browser preflight

User run `SoccerBotStudioSG_Standard_Local_2026-10-04.icv43q_h` passed runtime, Git/source, staged health and all 25 installed dependency-version checks, then stopped on full Chromium before source writes. The supplied OneFitfinity local reference does not make this additional executable check.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--correct-headless-browser-preflight).

### 4 October 2026 — first complete user browser run and bounded repair

Uploaded log `Pasted markdown(2).md`, run `SoccerBotStudioSG_Standard_Local_2026-10-04.7vmw50eb`: runtime/source/dependency/browser/port preflight passed, source applied, code checks and all 29 unit/component cases passed, and a fresh static export completed. The browser matrix executed all 30 cases: 25 passed and five failed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--first-complete-user-browser-run-and-bounded-repair).

### 4 October 2026 — enquiry hydration input loss

User run `SoccerBotStudioSG_Standard_Local_2026-10-04.m_abcjyr` passed code/build and 29 of 30 browser cases. Guardian cases passed on all projects; the assistant journey passed desktop/tablet.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--enquiry-hydration-input-loss).

### 4 October 2026 — duplicated generated Next.js types

User run `SoccerBotStudioSG_Standard_Local_2026-10-04.62mfyqb4` applied the enquiry hydration candidate (`8062281fbed3a75a2eb6aa0b6963cfe895477c5ab759c41325a47c6c34703a6f`) and retained unchanged Git state. Source, policy, tooling, installer, formatting and lint gates passed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--duplicated-generated-nextjs-types).

### 4 October 2026 — PR 2 browser selector failure

PR 2 was published at `b987f01c10f1c3822eb0cbe0713938da7d224ccd`. Its complete remote tree matches the reviewed generated-type repair candidate.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--pr-2-browser-selector-failure).

### 4 October 2026 — frozen-clock regression in the attempted CI repair

User receipt and failure archive `SoccerBotStudioSG_Standard_Local_2026-10-04.wqezwg0h` bind to candidate `201d73121041b176510749c4212d3f63799da2ae1ac64c6e63d247c816fcb6a0` on unchanged PR head `b987f01c10f1c3822eb0cbe0713938da7d224ccd`. Every non-browser gate passed, including all 33 application cases and the build.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--frozen-clock-regression-in-the-attempted-ci-repair).

### 4 October 2026 — GitHub Pages was publishing the README

PR #2 merged at `168b19bc7ab680ac236cb348b48514df64a26c7b`; previous feature head `02dc272d54b3b3cb3f0ab3e4ba9b935ec9ee043e` shares tree `0516f3c2d7cd9bc936df1535d387f022ad9d1ef9`. All 109 reviewed files matched that remote tree byte-for-byte before this repair.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--github-pages-was-publishing-the-readme).

### 4 October 2026 — accepted Pages evidence and complete iteration baseline

The user requested durable engineering rules and exact installer examples after repeated wrong-file/fingerprint mistakes, then a numbered roadmap through deployment/post-deployment and a guarded local installer for that plan. Reviewed the attached iteration handoff, current repository owners, latest OneFitfinity handbook, general guidelines, exact Fitfinity local example and SoccerBot Pages local/R2 publication shells as data.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--accepted-pages-evidence-and-complete-iteration-baseline).

### 4 October 2026 — Booking oracle follow-up and instructor rotation

YS reported “ok pass” for the planning installer, then requested exact rolling/footer logos and booking sizing/placement, full-width actions, instructor choice retained at the time step, and instructor names on slots across 9am–9pm in three-hour blocks. A temporary instruction prohibited crossing rotations; the subsequent repeated correction allows crossings with a customer disclaimer.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#4-october-2026--booking-oracle-follow-up-and-instructor-rotation).

### 5 October 2026 — instructor selection failure repair

YS supplied the unchanged `SoccerBotStudioSG_Standard_Local_2026-10-04.ji57rqjm` receipt and failure ZIP. Application completed with candidate-map fingerprint `04cbf8201e128b1df082956bb26eadd016e3474309fa1207ea88b81bc305c80e`; branch `fix/pages-deployment`, HEAD `12c174a98c97a5d7c7b0cd041c090e31a903e95b`, and index were preserved.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#5-october-2026--instructor-selection-failure-repair).

### 5 October 2026 — accepted local repair and booking-flow update

YS supplied `SoccerBotStudioSG_Instructor_Selection_Local_2026-10-05.962a08ae.json`. Its full local verification passed: 13 gates, 38 unit/component cases and 33 browser executions, with browser execution true and no omitted/extra cases.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#5-october-2026--accepted-local-repair-and-booking-flow-update).

### 5 October 2026 — header-blue and typography standardization

At 07:01 SGT, YS reported the booking-flow update “all good” and requested a deep colour/font/size audit with clear heading/body boundaries, especially inside booking. The client identified teal as inconsistent with the actual main header.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#5-october-2026--header-blue-and-typography-standardization).

### 5 October 2026 — latency architecture and measurement planning

At 07:38 SGT YS reported the design-system update “all good” and paused implementation to examine SimplyBook latency. At 08:43 SGT YS authorized deep incorporation into the design/architecture plan plus baseline measurements and best-target acceptance planning.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#5-october-2026--latency-architecture-and-measurement-planning).

### 6 October 2026 — client read-only discovery and boundary repair

YS first exercised developer account `app404`, then supplied the separate client account `soccerbotstudio` and exact service `Kickoff Special`. Client access was authorized read-only; YS stated native booking goes live on 7 October.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#6-october-2026--client-read-only-discovery-and-boundary-repair).

### 6 October 2026 — Codex Cloud transition and OneFitfinity source adaptation

At 20:51 SGT YS requested a remaining-API check, refactored documents ready for Codex Cloud, and forwarding the work to GitHub. The named “Model Context Protocol Overview” and “Engineering Workflow Principles” discussions establish bounded North Stars/Ralph runs, autonomous routine repairs, focused iteration/full CI, Cloud Playwright and optional local viewing, a usable preview, and a human merge/deploy boundary.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#6-october-2026--codex-cloud-transition-and-onefitfinity-source-adaptation).

### 6 October 2026 — verified Mac baseline and separate sync PR

YS uploaded `SoccerBotStudioSG_Local_Checkpoint_2026-10-06.569kaq7o.json` at 21:36 SGT. The receipt was collected at 21:35:24 SGT; its SHA-256 is `a896ceb7d09e88dd44ded1425031d7fc90702364ce6b59cf3128db692818d431`, and its shell SHA matches the delivered `b23a49d1708809e8ac1ced74b56406b3cc36ef49004428281f5ba3a7d9b67ddd`.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#6-october-2026--verified-mac-baseline-and-separate-sync-pr).

### 6 October 2026 — merge approval failure and enforced check naming

YS objected to the unauthorized PR #4 merge. The assistant acknowledged the error and paused further writes.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#6-october-2026--merge-approval-failure-and-enforced-check-naming).

### 6 October 2026 — CI status-check naming

YS requested the same `verify / frontend` status-check name as OneFitfinity. Read the actual Fitfinity `pages.yml` caller and reusable `verify.yml`: its `verify` caller invokes the `frontend` job.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#6-october-2026--ci-status-check-naming).

### 6 October 2026 — Cloud experiment refreshed from latest main

At 23:11 SGT YS requested the Cloud migration PR updated from latest main and concrete Codex Cloud setup steps. Independently matched all 121 baseline blob hashes/modes to tree `61918e04933afd960358903a2aa152a0872c7024`; prepared an isolated candidate and reconciled the eight experimental documents.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#6-october-2026--cloud-experiment-refreshed-from-latest-main).

### 7 October 2026 — booking-page readiness test repair

The C3/C4 documentation handoff at `74ca490f8a52025eff16933e500933c359eebfee` failed required [CI run 37559663874](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37559663874), attempt 1: the time-step interaction expected two instructor cards and received one. The [original failure artifact](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37559663874/artifacts/11456785312) and C3 receipts are preserved.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#7-october-2026--booking-page-readiness-test-repair).

### 7 October 2026 — M2.1 capability reconciliation with Cloud preview deferred

YS's handoff authorizes M2 provider feasibility while retaining CLOUD-01's unresolved user-preview acceptance. Started from clean `experiment/codex-cloud-workflow-2026-10-06` at `a6f1a6cc151200727d7806ff97a79c963edb2516`, with passing [full CI 37560542328](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37560542328) and unchanged original C3 receipts.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#7-october-2026--m21-capability-reconciliation-with-cloud-preview-deferred).

### 7 October 2026 — elapsed-slot Cloud application trial

YS authorized one meaningful demo application cycle from reviewed `d6b3ccdbf7455ddcda4103484caedf6b8b57a928`, with clean tree/index and draft PR #6. It supersedes M2 planning as the bounded active task without closing any provider prerequisite.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#7-october-2026--elapsed-slot-cloud-application-trial).

### 7 October 2026 — YS merge and developer payment evidence reconciliation

YS merged PR #6 at main `37c220a33caa85f875baaf98726205cec7b9d495`; GitHub run `37568173451` is completed/success for that main SHA. YS explicitly moved application inspection to deployed main.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#7-october-2026--ys-merge-and-developer-payment-evidence-reconciliation).

### 7 October 2026 — developer API access and planned Cloudflare release workflow

YS merged PR #7 at 14:21 SGT as main `e883c1af117a960eeae9359c4db9923d774888dd`, tree `16920dff690824b89e4e129d1742bd932b11e1ec`. Main run `37581074421` passed independent `verify / frontend` and the existing Pages deployment; PR head `34effa7f5182368de0a28a16c8e878cb0551e6aa` had passed run `37579661636`.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#7-october-2026--developer-api-access-and-planned-cloudflare-release-workflow).

### 7 October 2026 — native invoice checkout research and owner evidence

YS requested public-document research before asking for technical answers, with zero additional provider-account calls and no single-session execution. Refreshed PR #8: open at reviewed `04e82f800508c08defa433776f715259333772cf`, earlier successful run `37583277947`; fetched main remains `e883c1af117a960eeae9359c4db9923d774888dd`.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#7-october-2026--native-invoice-checkout-research-and-owner-evidence).

### 7 October 2026 — staged native checkout experiments replace support gate

YS confirmed PR #8 merged and directed official research plus controlled experiments rather than requiring six live-chat answers. Refreshed actual main `97b42c7d561ffa0167eb3ca1113d18e143a9e0d9`, tree `976cf0a064a82bb655d22fc9156c5a4663a80068`; independently rechecked main run `37589441392` with successful required job `112687131937` and existing deployment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#7-october-2026--staged-native-checkout-experiments-replace-support-gate).

### 2026-10-08 — Native developer Card proof reconciled; browser-return reliability preparation

PR #9 was independently refreshed open, draft and unmerged at `21c8fc855a0e6d8371b541b7ef35d3d4ee1b4e75` on `docs/native-checkout-stages-2026-10-07`. The existing detached PR worktree and historical `897cbfe737d31069ae25dca39c638cdededf3593` checkout were initially clean and preserved; no new checkout, reset or publication.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#2026-10-08--native-developer-card-proof-reconciled-browser-return-reliability-preparation).

### 8 October 2026 — Owner canary failed; automatic return control prepared

Owner Edge showed Fetch.requestPaused followed by Fetch.continueRequest, then DNS_PROBE_FINISHED_NXDOMAIN for the reserved canary. This fails return prevention; the source of continuation is unknown.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--owner-canary-failed-automatic-return-control-prepared).

### 8 October 2026 — CAP05 Cloud-only capacity preparation; no overlapping instructor fixture

YS requested executable Cloud-only preparation, zero provider-account calls and no local terminal/browser dependency. PR#9 was freshly checked open/draft/unmerged at21c8fc855a0e6d8371b541b7ef35d3d4ee1b4e75; reused its existing detached worktree and seven documentation edits with empty index.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--cap05-cloud-only-capacity-preparation-no-overlapping-instructor-fixture).

### 8 October 2026 — DUP06 scope decision and offline executable preparation

YS clarified that one studio uses non-overlapping instructor timetables and explicitly deferred cross-instructor shared-resource testing and further resource allocation. CAP05's invalid pair is retired unexecuted, not accepted.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--dup06-scope-decision-and-offline-executable-preparation).

### DUP06 contact-control correction — 8 October 2026

YS requested automatic clear identities and repeated continuation. Names are APP404 DUP06 A and APP404 DUP06 B.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#dup06-contact-control-correction--8-october-2026).

### 8 October 2026 — approved DUP06 stopped at first authentication

DUP06 execution stopped after request43: Admin authentication transport outcome unknown, no HTTP status retained and no retry. No public authentication, availability, booking or recovery request was sent; no new booking exists from this run.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--approved-dup06-stopped-at-first-authentication).

### 8 October 2026 — agreed payment-confirmation design recorded

YS agreed that the intended supported native-checkout return should end at our frontend confirmation route. Initial copy is “Checking your payment and booking…”.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--agreed-payment-confirmation-design-recorded).

### Capacity request43 offline diagnosis and proposed diagnostic continuation — 8 October 2026

Capacity remains the active objective. Usage stays43 (2 owner-reported +41 journaled), with19 capacity requests paused and14 NR04 requests reserved; no booking was created by DUP06.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#capacity-request43-offline-diagnosis-and-proposed-diagnostic-continuation--8-october-2026).

### 8 October 2026 — bounded developer evidence campaign

Owner adopted a complete A–G campaign, superseding prior future-operation approval gates while preserving the expired DUP06/NR04 history. Verified start43 (2 owner-reported +41 journaled); private campaign journal explicitly absorbed unused19+14 into200 additional, cumulative243.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--bounded-developer-evidence-campaign).

### 8 October 2026 — focused continuation, native reconciliation and publication authority

The owner opened a new four-hour continuation after the73-request campaign and supplied native-dashboard findings for24. Preflight14:14:10SGT set deadline18:14:10SGT, start73 (2 owner-reported +71 journaled),60 additional within outer243, effective ceiling133, six possible bookings/two sandbox submissions and12-call recovery floor.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--focused-continuation-native-reconciliation-and-publication-authority).

### 8 October 2026 — offline protected-confirmation component

Owner explicitly approved the narrow dependency exception before M2.5: implement and publish one offline domain verifier, review relevant M1 prerequisites, preserve every live/release gate, and make zero provider-account requests. M1 source and test controls support this slice; fresh main-protection read returned GitHub403, advisory disposition/full release controls remain open, and no physical/visual acceptance is inferred.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--offline-protected-confirmation-component).

### 8 October 2026 — Cloudflare development foundation campaign

The new direct North Star authorizes a narrow development dependency exception, named isolated Cloudflare resources/deployment and draft publication; no merge, production, paid service, client writes or provider settings change. One working agent and one PROGRESS ledger.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--cloudflare-development-foundation-campaign).

### 8 October 2026 — Cloudflare campaign publication receipt

Draft PR #11 publishes application revision `8c56f2658e9586b2b841e53c3ee179925b809d89`. CI [37754354471](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37754354471) passed both verification jobs: 84 application cases, 25 actual Worker/D1/coordinator cases, and 48 browser executions for each hosting path.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#8-october-2026--cloudflare-campaign-publication-receipt).

### 9 October 2026 — M3.2 asynchronous booking implementation

01:00SGT bounded task, deadline07:00; explicit M1/M2.5 dependency exception, one agent and zero provider calls. Refreshed cleanc10d843, main3bf8e3b, draftPR11, green37800070002 and existing deployment9d0a3c9f.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-2026--m32-asynchronous-booking-implementation).

### 9 October 2026 — M3.3 durable recovery implementation

08:34SGT start,14:34SGT deadline; one agent and explicit dependency exception. PR connector reports accepted0ab4085, draft/unmerged, main3bf8e3b.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-2026--m33-durable-recovery-implementation).

### 9 October 2026 — Experiment 1 separate checkout

The owner reordered the next task ahead of M3.4: implement and visibly demonstrate separate checkout while preserving M3.3 and all closed campaigns. A typed protected checkout context now supplies a summary and explicitly unavailable live capability.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-2026--experiment-1-separate-checkout).

### 9 October 2026 — native sandbox preparation after merged Experiment1

PR11 is owner-merged at49000e6716cf9aeabd3d7a62f1b2579fb9a59078. Its final source0363e70 passed PR CI37875189183.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-2026--native-sandbox-preparation-after-merged-experiment1).

### 9 October 2026 — historical responses to native adapter implementation

PR12 was rechecked open/draft/unmerged at7b83a8b; its completed two-job CI37884721443 and repairs are reused. Current main49000e6 remains unchanged.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-2026--historical-responses-to-native-adapter-implementation).

### 9 October 2026 — SimplyBook-owned dynamic data continuation

Start14:01SGT, finite stop20:01SGT, one agent and at most3 repairs per issue. PR12 was found owner-merged at e91fb12; PR13 remained open at8a4226b.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-2026--simplybook-owned-dynamic-data-continuation).

### 9 October 2026 — precise native discovery after owner-merged PR13

Started15:10SGT with one agent and21:10SGT deadline. Actual main757fd28 and run37896841542 were inspected: both required verification jobs and existing Pages deployment succeeded.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-2026--precise-native-discovery-after-owner-merged-pr13).

### 9 October 2026 — approved discovery execution stopped before provider dispatch

YS approved the exact discovery-only packet. Source661cbf54ae33bd8e08f00d631ea78772f9ea2ded, tested merge13479d792bcd3ed2d66614dfd15c4973dd87ab75, treeb002e2c8cd7e0fe14ea627d5db17929080aab669 passed both jobs in CI37899051046.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-2026--approved-discovery-execution-stopped-before-provider-dispatch).

### 9 October main integration engineering checkpoint

The governing continuation permits one agent/24 active hours/72 elapsed hours/60 loops/six evidence-based repairs, not new external execution. PR14 adds an asynchronous guest/identity boundary, protected finite customer catalogue and an unconfigured scheduled recovery handler using the existing durable and canonical confirmation owners.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-main-integration-engineering-checkpoint).

### 9 October 2026 — recovered environment and bounded Resend composition

Fresh workspace contained a clean older experiment checkout, not the retained campaign worktrees. Recovered exact PR14/15 through Git and confirmed both reported final CI runs.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-2026--recovered-environment-and-bounded-resend-composition).

### 9 October 2026 — public Turnstile binding and separate live-email evidence

Fresh attachment recovered PR16 source/tree exactly while preserving the older experiment checkout. Earlier private campaign worktrees/receipts were absent.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#9-october-2026--public-turnstile-binding-and-separate-live-email-evidence).

### Progress ledger archive — through PR78

Complete PROGRESS.md from merge69945cc4ecae4593799f7205beedbc82513f9945, moved here on21October2026. These are dated historical checkpoints, not current status or reusable execution authority.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#progress-ledger-archive--through-pr78).

### Batch checkout and durable token cache — 21 October 2026 SGT

PR77 is merged as432300a. Current branch perf/batch-checkout-token-cache consolidates existing checkout owners: total batch D1 target17→11 for2sessions,23→15 for4,35→23 for8; single remains5.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#batch-checkout-and-durable-token-cache--21-october-2026-sgt).

### Five-round-trip reconciliation experiment — 21 October 2026 SGT

Owner confirms PR75 merged and requests reconciliation targeting five D1 round trips for single booking with minimal batch growth. PR76 checkout was retargeted to main and updated to cd00252; its final-head CI39467856039 passed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#five-round-trip-reconciliation-experiment--21-october-2026-sgt).

### Five-D1 single checkout integration — 21 October 2026 SGT

PR75 was updated with main at fb0c87c without source-tree changes. Owner authorized integration and CI on21October.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#five-d1-single-checkout-integration--21-october-2026-sgt).

### Batch checkout and reconciliation optimization — 20 October 2026 SGT

PR74 fbbd18c full CI39431684472 passed. Follow-up branch perf/batch-and-confirmation is stacked on it.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#batch-checkout-and-reconciliation-optimization--20-october-2026-sgt).

### Confirmation read consolidation — 20 October 2026 SGT

Integrate the safe local experiment onto main e178bf6 (PR73). Request-local primary snapshots reduce context D1 executions10→4, pending status7→5 and confirmed status5→4; receipt remains5.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#confirmation-read-consolidation--20-october-2026-sgt).

### Unified pending confirmation presentation — 20 October 2026 SGT

Branch fix/confirmation-pending-layout starts from merged PR72/main2c19288. Owner hometest05 shows protected context followed by pending payment-received status and verified confirmation; request success does not establish browser paint.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#unified-pending-confirmation-presentation--20-october-2026-sgt).

### Confirmation tracing — 20 October 2026 SGT

PR72 head767f760 passed frontend/backend but live-email run39415858902 passed77/78. Offline phone-WebKit trace shows slow cold fixture/browsing setup and preserved original-attempt recovery, then exhaustion of the unchanged30-second budget before reload.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#confirmation-tracing--20-october-2026-sgt).

### Ten-call checkout implementation — 20 October 2026 SGT

PR70 passed final-head CI and was merged with owner authorization as18ccde0. Active branch perf/checkout-ten-d1 integrates guarded D1 consolidation into the actual single checkout.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#ten-call-checkout-implementation--20-october-2026-sgt).

### PR70 initial receipt versus download gate — 20 October 2026 SGT

Run39394733331 on a51594a passed frontend/backend and74/78 live-email cases. Downloaded logs confirm the same recovery case failed at the blocked initial receipt on all three devices.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr70-initial-receipt-versus-download-gate--20-october-2026-sgt).

### PR70 browser reconciliation-gate correction — 20 October 2026 SGT

Run39391908409 passed frontend/backend and75/78 live-email cases. The same payment-recovery journey failed on all three devices because it deliberately blocked accept-payment but still expected Booking confirmed before releasing that gate.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr70-browser-reconciliation-gate-correction--20-october-2026-sgt).

### Active audit repair — 20 October 2026

Branch fix/confirmation-and-queue-guards from main194cb5f. Implement current-booking confirmation gate, bounded queue admission/recovery priority, and canonical current-rule summaries.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#active-audit-repair--20-october-2026).

### PR69 main integration — 20 October 2026 SGT

PR69 had no CI run because its tracing branch conflicted with main after PR68 merged. Integrate main194cb5f without rewriting branch history: retain batch creation-only behavior inside request-bound tracing, retain both test sets and ordered inventory, and preserve both historical entries.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr69-main-integration--20-october-2026-sgt).

### Checkout phase tracing — 20 October 2026 SGT

Owner requests measurement of the7.6-second single checkout before pursuing3seconds. Separate tracing branch starts from merged PR67/main dc74690; batch optimization PR68 remains independent.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-phase-tracing--20-october-2026-sgt).

### Batch checkout creation path — 20 October 2026 SGT

After HAR13 single checkout reached HitPay in7.60seconds, owner stops single optimization and authorizes the same provider strategy for direct batch checkout. Extend the ongoing creation-only path to batch: public token, createBatch, one sequential book per session, closeBatch, validated complete unpaid invoice and one HitPay request.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#batch-checkout-creation-path--20-october-2026-sgt).

### Checkout D1 consolidation — 20 October 2026 SGT

The follow-up reduces isolated warm/cold single checkout from34 to27 D1 executions (HAR12 baseline47). Archive/read grants in one primary batch; pass the committed canonical association/version forward; batch checkout completion with the final authenticated access read.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-d1-consolidation--20-october-2026-sgt).

### Lean single checkout — 20 October 2026 SGT

Owner authorizes SimplyBook settings as the one-studio capacity authority and removes per-checkout admin identity/plan, catalogue, required-field, instructor eligibility and slot reads. Apply first to ongoing direct single checkout; historical split holds and batch preflight remain unchanged for the staged experiment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#lean-single-checkout--20-october-2026-sgt).

### PR66 CI cookie-adapter correction — 20 October 2026 SGT

Run39365196455 on77f06d3 passed frontend/backend and75/78 live-email cases. Only the new identity-warming test failed on all three devices, after its UI/no-effect assertions passed: its direct current-status fetch copied the preview cookie name instead of using the existing adapter that maps it to the real Worker cookie.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr66-ci-cookie-adapter-correction--20-october-2026-sgt).

### Authentication rejection diagnostic follow-up — 20 October 2026 SGT

The60-second admin-token cache already refreshes on the next identity operation after expiry; HAR10 failed during fresh admin-auth, not a missing refresh. Existing logs discarded the exact401/403 distinction.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#authentication-rejection-diagnostic-follow-up--20-october-2026-sgt).

### HAR10 confirmation stability and pre-dispatch authentication failure — 20 October 2026 SGT

Owner HAR10 ran deployed5e9e2d8 after PR65. Its first checkout returned the HitPay handoff in14.8seconds and payment subsequently reconciled.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har10-confirmation-stability-and-pre-dispatch-authentication-failure--20-october-2026-sgt).

### Confirmation read timestamp race — 20 October 2026 SGT

PR64 passed all PR gates and owner merged it as c7ee697. Main run39355419233 passed frontend/backend and74/75 live-email cases; tablet WebKit payment recovery timed out and Cloudflare deployment was skipped.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#confirmation-read-timestamp-race--20-october-2026-sgt).

### Independent payment deadlines — 20 October 2026 SGT

HAR09 records a29.1second four-session checkout ending in recovery_required. The saved batch-close evidence confirms four bookings and an unpaid invoice; correlated deployed c08aa04 telemetry proves HitPay creation returned422 JSON.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#independent-payment-deadlines--20-october-2026-sgt).

### Interrupted provider transport recovery — 20 October 2026 SGT

Owner requires errors to be logged and isolated while unrelated customers continue. A06:07:38SGT Cloudflare storage reset during read-only warmDisplay left one unclassified admission unfinished; parallel reads then exhausted the remaining slot.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#interrupted-provider-transport-recovery--20-october-2026-sgt).

### Lost checkout response test ordering — 20 October 2026

PR62 merged as de71b72 after all three PR gates passed. Main run39340832488 passed frontend/backend but failed one of75 live-email cases; Cloudflare deployment was skipped.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#lost-checkout-response-test-ordering--20-october-2026).

### PR62 checkout transport verification — 20 October 2026 SGT

Owner explicitly authorizes merging PR62 after all three final-head CI gates pass. Initial head0b5a76c passed frontend/backend and73/75 live-email cases; two desktop Chromium checkout assertions lost response resources after immediate HitPay navigation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr62-checkout-transport-verification--20-october-2026-sgt).

### Batch closure fast path — 20 October 2026 SGT

Owner authorizes validated final batch-close evidence reuse and fewer persistence round trips. Based on main d0c0be8 and bounded read-only evidence from hometest03: intermediate books accumulate1–4 entries without invoice; closeBatch includes four confirmed nested invoice bookings, unpaid state and due_datetime matching later readback.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#batch-closure-fast-path--20-october-2026-sgt).

### Active checkout optimization on PR61

Cache extension checkpoint21000da passed full local code and386 runtime tests; the inventory-order gate failure was identified during the final combined run. Owner now prioritizes deferred comment I/O and returning the saved URL in the authenticated checkout response.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#active-checkout-optimization-on-pr61).

### PR61 extension — persistent display snapshots

Owner authorizes fifteen-minute scheduled warming plus booking-triggered refresh, with eager browser download on site entry. Source implemented and focused persistence/scheduled/failure/checkout-handoff/client/release checks passed; full verify:code passed215 tests plus tooling/types/lint/build/export and 386/386 Worker runtime tests passed; the inventory-order gate failure was subsequently identified and corrected during the final combined run; final-head CI pending.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr61-extension--persistent-display-snapshots).

### Browsing-loading successor — 19 October 2026 SGT

Baseline main d15caba; branch fix/browsing-loading-cache. Fix explicit local display loading and stable guest feedback; serve valid public calendar/catalogue cache hits before provider queue; start short catalogue prefetch before month work.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#browsing-loading-successor--19-october-2026-sgt).

### PR60 streamed Review restoration race — 19 October 2026 SGT

Headbe08170 passed frontend/backend; live-email passed74/75. Tablet WebKit exposed a mount-order race: restoration finished before Review mounted, so the default browsing flag launched calendar/catalogue reads.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr60-streamed-review-restoration-race--19-october-2026-sgt).

### PR60 final request-count correction — 19 October 2026 SGT

Head13650ab frontend/backend passed; live-email passed72/75. The three device failures reached a second stale availability-count assertion after checkout return: expected1 instead of the agreed0.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr60-final-request-count-correction--19-october-2026-sgt).

### PR60 live-email follow-up — 19 October 2026 SGT

Head580f6aa passed frontend and backend including75/75 browser cases each and383 Worker tests. Live-email passed66/75: extra catalogue prefetch on restored editable Review (reproduced in component test), revoked access now correctly enters protected denied UI instead of the old Details alert, and an expiry alert selector also matched the framework route announcer.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pr60-live-email-follow-up--19-october-2026-sgt).

### Active PR60 implementation — 19 October 2026 SGT

Working branch fix/confirmation-return-loading, starting headf03049e; main0fd2c6e. Run39209839579 failed browser gates; underlying Worker checks passed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#active-pr60-implementation--19-october-2026-sgt).

### Editable Review, combined checkout and compact confirmation — 19 October 2026 SGT

Owner supersedes creation-during-Review and queued provider edits: Details runs fresh read-only availability checks, then opens editable Review without creating a customer, booking or payment. Changed details reset consent.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#editable-review-combined-checkout-and-compact-confirmation--19-october-2026-sgt).

### HAR08 confirmation continuity and record reconciliation — 19 October 2026 SGT

Owner reports successful checkout and asks for pending do-not-refresh guidance, removal of repeated confirmation loading, and read-only record reconciliation. HAR08 shows customerConfirmation in a pending response, followed by confirmed without that snapshot; the hook discarded the proof while the611ms receipt request completed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har08-confirmation-continuity-and-record-reconciliation--19-october-2026-sgt).

### Email-code browser interaction repair — 19 October 2026 SGT

Final-policy CI39200175005 frontend passed74/75 browser cases. Tablet WebKit filled the code while main was still inert during the loading transition; the trace retained an empty input, so native required validation prevented the expected incorrect-code response.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#email-code-browser-interaction-repair--19-october-2026-sgt).

### Fifteen-minute hold and eight-minute payment policy — 19 October 2026 SGT

Owner authorizes adding this policy to PR59 and merging only after final-commit required CI passes. Owner reports SimplyBook's timeout changed to15minutes; provider behavior is not independently verified.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#fifteen-minute-hold-and-eight-minute-payment-policy--19-october-2026-sgt).

### Completed-dismissal CI setup repair — 19 October 2026 SGT

Merged-main50656c9 CI39198249437 passed74/75 live-email cases; phone WebKit timed out before reaching dismissal. Trace shows about22seconds spent creating the synthetic hold/payment before navigation, then waiting for fully reconciled confirmation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#completed-dismissal-ci-setup-repair--19-october-2026-sgt).

### Bounded pre-creation concurrency — 19 October 2026 SGT

Owner authorizes concurrency after HAR06/07 analysis: booking response arrived11.19/11.33seconds after coordinator start, while first Review-eligible browser response improved14.51→13.64seconds and full hold worsened15.73→16.68seconds. Implement within one serialized booking job: overlap public/admin authentication for ongoing customers; run required-fields, eligibility and availability through two drained read lanes after fresh catalogue; overlap validated local attempt persistence with provider identity preparation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#bounded-pre-creation-concurrency--19-october-2026-sgt).

### HAR07 payment transport investigation — 19 October 2026 SGT

Owner HAR07 at11:38SGT shows hold200 in16.678seconds, first verifying reply beginning13.295seconds after hold dispatch, then HitPay preparation503 hitpay_transport_unknown in3.262seconds. No checkout URL reached the browser.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har07-payment-transport-investigation--19-october-2026-sgt).

### Shared checkout expiry and payment-first confirmation — 19 October 2026 SGT

Owner authorizes implementing a five-minute payment deadline from successful booking creation, expiry return to calendar with contact retained, customer confirmation after verified matching HitPay payment, download-only waiting for reconciliation, and CI repair. This supersedes the earlier requirement to hide all success/actions until SimplyBook accounting finishes.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#shared-checkout-expiry-and-payment-first-confirmation--19-october-2026-sgt).

### Pending task: controlled coordinator concurrency — 19 October 2026 SGT

**Pending; start after single-booking checkout is stable.** Review latest main, then implement [controlled account-coordinator concurrency](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#pending-controlled-account-coordinator-concurrency--19-october-2026-sgt). Browsing/provider work may overlap within shared limits, valid cache hits avoid slow work, booking writes initially stay serialized, and reconciliation must not starve.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#pending-task-controlled-coordinator-concurrency--19-october-2026-sgt).

### Creation-first optimistic Review clarification — 19 October 2026 SGT

Owner clarifies that Review should appear after booking creation, with comments/readback continuing while payment stays disabled. Earlier source waited for comment acknowledgement.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#creation-first-optimistic-review-clarification--19-october-2026-sgt).

### Checkout handoff repair — 19 October 2026 SGT

HAR06 is parsed: successful hold/payment preparation, available sandbox checkout URL, aborted first context request, then pending confirmation polling without captured external navigation. Retained Details-rendered Review was missing from BookingPage's handoff guard; its cleanup aborted the redirect owner.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-handoff-repair--19-october-2026-sgt).

### Mandatory test-impact pass — 19 October 2026

Owner requires one complete test-impact review after every logical change and repair. Follow AGENTS Verify and the [Service Contracts procedure](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/docs/SERVICE_CONTRACTS.md#mandatory-test-impact-pass-after-every-change--19-october-2026), including all duplicated setup/response waits and final exact-commit CI.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#mandatory-test-impact-pass--19-october-2026).

### One-month browser expectation repair — 19 October 2026 SGT

CI39176339093 on3a34e2a passed frontend/backend, but live-email passed69/72: the same native guest journey timed out on all three engines. Its separate warmedMonths setup still waited for four responses, then asserted four calendar calls twice.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#one-month-browser-expectation-repair--19-october-2026-sgt).

### One-month calendar preload — 19 October 2026 SGT

Owner reduces eager calendar loading from four months to the displayed month only. Homepage preloads the current Singapore calendar month; another month is fetched only when opened.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#one-month-calendar-preload--19-october-2026-sgt).

### Final single-booking optimization pass — 19 October 2026 SGT

CatalogueReads overlaps the independent service/instructor reads only for ongoing customer access under the existing ProviderSession and serialized admission owner. The initial full runtime run exposed three finite-path rate rejections; finite/historical reads retain their original sequential dispatch.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#final-single-booking-optimization-pass--19-october-2026-sgt).

### Review continuity, pending confirmation and immediate home — 19 October 2026 SGT

Additional owner requests: preferred communication has Email as its default with exactly Email, Call (existing phone identifier), SMS and WhatsApp; remove the placeholder and retain stored preferences. The shared method catalogue also supplies SimplyBook comment labels.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#review-continuity-pending-confirmation-and-immediate-home--19-october-2026-sgt).

### Comment milestone and D1 latency pass — 19 October 2026 SGT

Source baseline origin/main40e735e (PR54); isolated branch perf/review-comment-milestone. Single-booking Review now qualifies from its matched acknowledged comment before association persistence, with payment still gated by all completed hold checks.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#comment-milestone-and-d1-latency-pass--19-october-2026-sgt).

### Latest05 Review transition repair — 19 October 2026 SGT

Owner HAR latest05 records a14.112s combined hold; first verifying reply is visible about12.75s after dispatch, leaving only about1.36s before completion. Main/deployed baseline836a5c4 is confirmed by the preceding successful PR53/main deployment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latest05-review-transition-repair--19-october-2026-sgt).

### Single-booking verification latency and reference clarity — 19 October 2026 SGT

PR51 merged as abad20d and PR52 as 692cf92 after their exact PR gates passed. PR51's subsequent main run39149518497 failed one tablet live-email dismissal-retry case (53/54); frontend/backend passed and Cloudflare deployment was skipped.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#single-booking-verification-latency-and-reference-clarity--19-october-2026-sgt).

### Latest04 UI and combined batch follow-up — 19 October 2026 SGT

Owner requests contact-action spacing, more prominent signed-in email, navy Book now hover text, an on-demand studio location popup, and removal of duplicate batch checks before an owner-operated two-browser conflict test. Branch feat/batch-preflight-location-ui builds on PR51's browser failures repair (4fc8ce3); do not confuse that pending parent PR with main.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latest04-ui-and-combined-batch-follow-up--19-october-2026-sgt).

### Independent checking-window regression — 19 October 2026 SGT

The repaired dismissal journey passes all3 devices on4fc8ce3. Two tablet cases timed out when combining full guest selection, uncertain holding, reload and checking-window exhaustion.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#independent-checking-window-regression--19-october-2026-sgt).

### Browser failure coverage expansion — 18 October 2026

The owner explicitly requires browser regression coverage for error handling, not only mechanism tests. The legacy suite remains23 scenarios across3 devices (69 runs).

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#browser-failure-coverage-expansion--18-october-2026).

### Combined Details-to-Review hold — 18 October 2026

Owner authorizes one request with one authoritative single-session prebooking validation. Branch `perf/combined-booking-hold` starts from owner-merged PR49/main87fde3c.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#combined-details-to-review-hold--18-october-2026).

### Latest03 immediate rebooking — 18 October 2026

Current branch `fix/returning-session-rebooking` starts from refreshed merged main d89ad5e (PR48). Latest03 shows successful email verification/contact reads, valid catalogue responses and a13.031s completed-attempt dismissal before navigation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latest03-immediate-rebooking--18-october-2026).

### Latest02 performance and email access — 18 October 2026

Branch `perf/payment-recovery-wakeup` starts from refreshed main45ec58c. Source adds durable webhook-triggered payment recovery, coordinator recovery D1 timing and the ongoing contact authority repair.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latest02-performance-and-email-access--18-october-2026).

### Checkout authority optimization — 18 October 2026

Branch `perf/checkout-authority` starts from refreshed main9a15cae. Consolidate repeated forward checkout grant reads while preserving entry/response authentication, write-boundary grants, atomic dispatch/effect claims, cleanup and payment recovery.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-authority-optimization--18-october-2026).

### Booking presentation repair and measured latency — 17 October 2026

Owner HAR-fixed-01 reached hold200, payment handoff200 and eventual confirmation/receipt200 on deployed PR39 source b9f2b51. Measured preparation7.8seconds plus hold21.1seconds remains too long for the owner.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#booking-presentation-repair-and-measured-latency--17-october-2026).

### Migration process and testing requirements documentation — 16 October 2026

Owner requests a separate documentation-only PR for the next client migration: per-environment secret configuration, saved-versus-active deployment verification, legacy recovery/receipt continuity, actual application-API browser tests, isolated code mutation and side-effect tests, and measured latency/performance acceptance. Rules and Architecture and Service Contracts own the requirements; Journey records the decision.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#migration-process-and-testing-requirements-documentation--16-october-2026).

### Migration sweep: remove old-account session preload — 16 October 2026

The owner-requested final pass found the experimental NativeSessionInit frame still loading soccerbotstudiosg on every live booking selection. Direct HitPay checkout does not use that native hosted-session experiment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#migration-sweep-remove-old-account-session-preload--16-october-2026).

### Migration version activated — 16 October 2026

Owner explicitly authorized activation. Deployment ad3432df-b58f-4c74-b1a6-d5db7fb6729a activated saved version140 c2a562d1-3469-4b5c-8ecc-cd22837377f4 at17:29:45SGT,100% traffic.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#migration-version-activated--16-october-2026).

### Deployed provider mismatch — 16 October 2026

Ordinary curl through the supported managed network returns HTTP200 for Worker health, catalogue and October calendar; the earlier Python HTTP403/1010 is client-dependent evidence, not general Cloudflare unreachability. Health still identifies source be9982b3 and version f2400190-6db5-4436-8c74-16371055b117.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#deployed-provider-mismatch--16-october-2026).

### First new-account acceptance preparation — 16 October 2026

Owner requests verification and readiness for one first acceptance test, confirms local HitPay connectivity, treats old test records as noncritical, confirms new-account checklist settings complete and webhook unchanged. Keep old rows intact; original-scope application receipt continuity is outside this new-account acceptance scope.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#first-new-account-acceptance-preparation--16-october-2026).

### Environment readiness and owner confirmations — 16 October 2026

Owner reports latest environment changes installed, confirms migration checklist item3 complete (new-account signing/settings/schedules), and confirms item4 webhook configuration remains unchanged. Record these as owner confirmations, separate from independently observed provider evidence.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#environment-readiness-and-owner-confirmations--16-october-2026).

### Migration verification and booking queue review — 16 October 2026

Fresh GitHub main and Cloudflare SOURCE_REVISION both remain be9982b3b0420db88907ecb727d049cd87a86ee4. Preserve the clean historical checkout at 897cbfe; current local work is on fix/migration-booking-check-review in /workspace/work/soccerbot-migration.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#migration-verification-and-booking-queue-review--16-october-2026).

### Opening hours, four-hour lead and observed HitPay host — 16 October 2026

PR37 is merged in remote main9d9e273. New branch applies the owner-approved noon–20:00 SGT opening window,240-minute lead and exact checkout.sandbox.hit-pay.com allowance established by local read-only evidence.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#opening-hours-four-hour-lead-and-observed-hitpay-host--16-october-2026).

### HAR06 checkout latency and payment diagnostics — 16 October 2026

Owner HAR06 and redacted Worker/D1 evidence establish booking49/invoice40 created successfully at11:38SGT, with confirmed booking flags and an unpaid invoice. Details-to-Review took about53seconds: roughly20seconds queued behind background month work,5seconds for the browser-triggered fresh day read,6seconds for preparation (another fresh read), and21seconds for holding creation/readback (19 provider calls).

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#har06-checkout-latency-and-payment-diagnostics--16-october-2026).

### Sandbox deployment and recovery correction — 16 October 2026

Owner requests durable sandbox settings, automatic calendar return for confirmed reservation conflicts, and webhook recovery from recoverable manual review. Main dd3c31b passed all three CI gates and deployed, but the generated live artifact inherited native/disabled payment defaults and omitted five sandbox settings.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#sandbox-deployment-and-recovery-correction--16-october-2026).

### Hold-state experiment evidence — 16 October 2026

Owner authorizes narrow diagnostic capture before the next physical hold experiment. Deployed4e98eae retained structural errors and identifiers but not rejected status values.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#hold-state-experiment-evidence--16-october-2026).

### Complete sandbox configuration readback — 16 October 2026

Owner requested a full configuration check, which exposed five missing bindings beyond the previously restored route/enablement flags. Owner then authorized setting them.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#complete-sandbox-configuration-readback--16-october-2026).

### Calendar return and local reconciliation — 16 October 2026

Owner verified24October09:00 is correctly unavailable; that report is withdrawn. A separate frontend pause survives successful fresh validation followed by preparation failure, leaving Back-to-calendar loading until a selection edit.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#calendar-return-and-local-reconciliation--16-october-2026).

### Stable guest option and HAR04/05 — 16 October 2026

PR34 is owner-merged as4e98eae after all three PR gates passed in38828870612. Owner reports guest-button movement when saved identity restores.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#stable-guest-option-and-har0405--16-october-2026).

### Confirmation restoration race exposed by mechanism tests — 16 October 2026

CI38823092566 reaches real holding/payment on all browser projects. Paid return passes on phone/tablet, while desktop receives confirmed200 then remains Checking: initial BookingProvider hydration/restoration changes the revision and cancels that protected read before a second request is throttled.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#confirmation-restoration-race-exposed-by-mechanism-tests--16-october-2026).

### Test reliability audit — 16 October 2026

Reviewed the inventory of50 test files (24 frontend/unit,10 Worker,3 browser,13 tooling/installer) for clock dependence, fixture coupling, weak assertions, isolation and mocked boundaries. PR34 fixes the weekday clock failure.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#test-reliability-audit--16-october-2026).

### Deterministic booking test clock — 16 October 2026

PR33 merged6a88134; main run38816624792 frontend failed two real-clock tomorrow fixtures at Singapore midnight (expected8800, correct Saturday price10800). Pin the test Date clock to a known weekday without changing product pricing or receipt assertions.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#deterministic-booking-test-clock--16-october-2026).

### Holding HTTP boundary repair — 15 October 2026

Baseline deployed40cca80, branch fix/allow-booking-hold-request. HAR03 and bounded backend evidence identify a missing hold=1 query allowance before authentication/provider dispatch.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#holding-http-boundary-repair--15-october-2026).

### Review booking owner-test repair — 15 October 2026

Current branch fix/review-hold-continuation starts from deployed main1971d26. HAR and D1 establish preparation without holding/payment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#review-booking-owner-test-repair--15-october-2026).

### Direct hosted HitPay implementation resumed — 15 October 2026

Worktree /workspace/work/direct-hitpay, branch feat/direct-hitpay-sandbox, refreshed main baseline49eed77f10811c8787596b1ca44a49dfb50c889c. Source implementation now includes direct hosted navigation, Details-stage fresh selection validation, additive0029 payment provenance, independent HitPay ingress/retrieval, one-shot external SimplyBook finalisation and bounded financial recovery.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#direct-hosted-hitpay-implementation-resumed--15-october-2026).

### Durable Object read optimization and Turnstile layout — 14 October 2026

Current baseline is deployed f268988. Additive admission indexes and a populated-object runtime regression are implemented; focused regression and Worker types/source checks passed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#durable-object-read-optimization-and-turnstile-layout--14-october-2026).

### Preparing one checkout-opening diagnostic — 13 October 2026

Source-only0025 raises native grant schema cap624→688; carried618 otherwise cannot satisfy availability admission. Focused extended-grant runtime test passed; full checks/CI/artifact and a new executor remain in progress.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#preparing-one-checkout-opening-diagnostic--13-october-2026).

### Owner settings evidence received — 13 October 2026

Homepage loads; SBPay PRO on free trial; Take Me Back Home enabled with no settings available to owner. General homepage failure/disabled PRO are not supported causes.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-settings-evidence-received--13-october-2026).

### Read-only native settings checked; owner browser results pending — 13 October 2026

Connected SimplyBook identity matches the developer binding. Accept Payments enabled/configured; Client Login off; Take Me Back Home on.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#read-only-native-settings-checked-owner-browser-results-pending--13-october-2026).

### Checkout diagnosis: endpoint and handoff match; native error unresolved — 13 October 2026

Confirmed exact handoff/retained URL equality, invoice31 association and failure before the original submission/checkout deadlines and access closure. Official documentation matches our payment-link endpoint.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkout-diagnosis-endpoint-and-handoff-match-native-error-unresolved--13-october-2026).

### Owner checkout 404; test stopped and independently closed — 13 October 2026

Packet301173108ab6 created booking40 and exact unpaid invoice31, SGD88, for Nabil3/service2 on15October15:40 Singapore. Both callback subscriptions were active and the protected checkout handoff passed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-checkout-404-test-stopped-and-independently-closed--13-october-2026).

### Owner payment packet preparation continues — 13 October 2026

Merchant verification will occur on the owner checkout before payment, as requested. Application preparation adds explicit704 budget support and refreshes release metadata; current live640 remains closed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-payment-packet-preparation-continues--13-october-2026).

### Payment test preparation, access still closed — 13 October 2026

Owner readiness is confirmed for one proposed native payment test. YS confirms Sandbox mode and tentatively names app404; actual merchant display identity remains to be checked in the owner browser.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#payment-test-preparation-access-still-closed--13-october-2026).

### Paired control source prepared — 13 October 2026

The next experiment uses fixed booking/invoice callback routes with independent finite windows, caps and deduplication. Each subscription keeps its one-use grant and exact baseline checks; remove invoice first, then booking, preserving prior subscriptions.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#paired-control-source-prepared--13-october-2026).

### Webhook investigation: verify the event prerequisite — 13 October 2026

No callback was recorded through 10:44:54 Singapore. The exact destination and active `new_booking` registration were verified before booking 38; current Cloudflare reads report Access not enabled and the public Worker address enabled.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#webhook-investigation-verify-the-event-prerequisite--13-october-2026).

### Live DELETE fix passed; signed delivery not observed — 13 October 2026

Packet7ec56094976f created confirmed booking38 and exact unpaid invoice29, SGD88, with Nabil on15October15:40 Singapore. The checkout link remains unopened.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#live-delete-fix-passed-signed-delivery-not-observed--13-october-2026).

### Active subscription baseline restored — 13 October 2026

Approved read-only packet1089bf8b452a returned an empty active-subscription array without repeating DELETE. The original empty active baseline is restored; this does not establish permanent deletion of inactive provider records or webhook delivery acceptance.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#active-subscription-baseline-restored--13-october-2026).

### Latest live result: DELETE unknown, test stopped — 13 October 2026

Approved packet10c62a001eea passed actual string-flag and unique subscription identity checks, then dispatched DELETE once and stopped on `provider_representation_unknown`. No new live booking/subscription test started.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latest-live-result-delete-unknown-test-stopped--13-october-2026).

### Current source repair — 13 October 2026

YS requested the subscription parser fix. Exact string"0"/"1" and numeric0/1 are now accepted; unknown flags remain rejected with private field codes.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#current-source-repair--13-october-2026).

### Latest result: subscription diagnostic closed — 13 October 2026

Approved packet46b93ebc17fa7 observed a string `is_active`, rejected by the numeric-only subscription validator. Its exact value and subscription identity remain unproven.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#latest-result-subscription-diagnostic-closed--13-october-2026).

### Webhook flight stopped; access closed, subscription unresolved — 13 October 2026

Packet `b918a81d06e991549f9d67e449098bf87e8109bc9ea6affc98d69d7773d06a99` executed once under the approved campaign on source `f2e0a3e91824f569a161f29447471d5081259719`. All three gates passed in CI38313369930; artifact11776470322/SHA256 `ed0207005a4ce1a38bc3f8c9302e05895be968d9afbeddf40a05d5725c3d1e14` matched150 sealed files and273 strict Worker tests.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#webhook-flight-stopped-access-closed-subscription-unresolved--13-october-2026).

### Approved technical payment/webhook campaign — 13 October 2026

Current subscription increment: all273 Worker runtime tests passed with zero failures/skips and no external provider calls; generated types, source/policy guards, affected lint and checker regressions passed. The packaged release now verifies preservation through pending0022/0023.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#approved-technical-paymentwebhook-campaign--13-october-2026).

### Payment/webhook source increment — 13 October 2026

PR21 merged at `383cc2e70d952f2a37377046ccfd226c0e2a403e` after explicit owner approval. Independent main CI `38276366243` passed frontend, backend, live-email and Pages demo publication.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#paymentwebhook-source-increment--13-october-2026).

### Developer native booking accepted and independently closed — 13 October 2026

Packet `217dfd4e4df2` executed once after YS approved the exact packet and amended resource limits. Source `8bd66c1` passed all three CI gates in run `38273011816`; artifact `11758121123` matched 148 sealed files, 257 Worker tests and all 21 immutable migrations.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#developer-native-booking-accepted-and-independently-closed--13-october-2026).

### Owner roster and instructor priority — 12 October 2026

YS supplied the October 2026 roster and explicitly set instructor priority **Faisal → Caelan → Nabil** when multiple instructors are available. Apply priority only among instructors eligible and freshly available for the entire selected session; do not replace an unavailable preferred instructor with an unverified one.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#owner-roster-and-instructor-priority--12-october-2026).

### Approved setup inspection completed and closed — 12 October 2026

Independent closure at 23:21:46 Singapore verified source `3af1323` / version `bd48335e-de9b-4b11-b0ba-b6ed5267f2f5`: Worker and coordinator matched, provider and identity access disabled, end 0, 387/512 calls with active 0 and 16 recovery calls untouched. Both new capabilities expired and returned 401; schedules remain empty; all 18 historical table snapshots and 21 applied migrations are preserved.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#approved-setup-inspection-completed-and-closed--12-october-2026).

### Full native acceptance execution resumed — 12 October2026

YS instructed “execute it now” against the consolidated full native acceptance draft. Continue technical implementation, evidence-backed discovery preparation, tests and PR21 publication.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#full-native-acceptance-execution-resumed--12-october2026).

### Native campaign stopped on actual date availability — 12 October2026

Sealed packet3f6019db7880 ran sourcee122ba5 after all-three CI38236452119/artifact11740802365 passed. The authenticated15–29October calendar returned14 start times on15October and no other offered date.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-campaign-stopped-on-actual-date-availability--12-october2026).

### Actual calendar discovery before the final native gate — 12 October2026

Current actual campaign totals:373 provider,128 management,57 direct Worker,12 deployments;4 flights/3 actual attempts,5 conservative book allowances,1 consumed migration. One actual attempt remains, with original512 total/16 recovery and20:30Singapore deadline.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#actual-calendar-discovery-before-the-final-native-gate--12-october2026).

### Native single proof accepted and closed — 12 October2026

Flight4 consumed packet50e2a1263ac7 on24153c3, all-three CI38232933900/artifact11740055253. single proof at15 October 14:00Singapore: bookings35, invoice27, 1 signed confirmed booking reads, authoritative unpaid invoice, SGD88/tax0 and one native link retained unopened. Attempt375bbc00-297f-43fd-9671-2b0961aa5979 is observed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-single-proof-accepted-and-closed--12-october2026).

### Availability-only stop and actual-attempt accounting — 12 October2026

Flight3 consumed packet8e6824f42e2b on ee2853a (all-three CI38230887077/artifact11739086074).16October returned zero offers. The grant cache and request ledger prove no prepare/native POST, no attempt and no booking dispatch.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#availability-only-stop-and-actual-attempt-accounting--12-october2026).

### Native campaign flight2 accepted same-date; independently closed — 12 October2026

Source6ac6165 passed all three CI38229148061 gates. Artifact11737163517 verified148 sealed files/exact tree/246 Worker tests.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-campaign-flight2-accepted-same-date-independently-closed--12-october2026).

### Native campaign flight1 closed; batch closure phase isolated — 12 October2026

Sealed dea4fe21baae executed sourcea206106 from all-green CI38226503628/artifact11736683975 (148 sealed files,244 Worker cases). Applied0021 with preservation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-campaign-flight1-closed-batch-closure-phase-isolated--12-october2026).

### Current task — complete native-booking acceptance, 12 October2026

YS requests a fixed North Star and continued execution until accepted. Rechecked clean local/remote b582a46 on draft PR21 and successful final CI38224131965.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#current-task--complete-native-booking-acceptance-12-october2026).

### 256 trial executed; second receipt cardinality failure — 12 October2026

Exact approved packet c0916326b895 executed once on6bc54f7 after all three CI38222064282 gates and artifact11735290126 verification. Applied0020 with preservation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#256-trial-executed-second-receipt-cardinality-failure--12-october2026).

### Approved live-test amendment preparation — 12 October2026

YS requested a live test and explicitly approved cumulative256 with196 carried/16 reserved and deadline17:30Singapore today. Corrected source3e3628d passed all three CI38220464328 gates.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#approved-live-test-amendment-preparation--12-october2026).

### Current task — synthetic batch-membership experiment, 12 October2026

YS asked to start an experiment. Rechecked clean6759773/remote PR21 and the closed196/224 ledger evidence.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#current-task--synthetic-batch-membership-experiment-12-october2026).

### Current task — follow-up experiment identified missing batch echo, 12 October2026

Approved packet a14dfea95559 executed exact4671f37 from all-green CI38217379501/artifact11732905946. Migration0019 applied and independently preserved all historical rows/foreign keys;0001–0019 immutable, none pending.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#current-task--follow-up-experiment-identified-missing-batch-echo-12-october2026).

### Next finite experiment prepared — 12 October2026

Preparing the owner-requested next experiment using the corrected intermediate validator. Final prior source d21e2b8 passed all three CI38216192722 gates.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#next-finite-experiment-prepared--12-october2026).

### Current task — live field identified and correction prepared, 12 October2026

Approved packet5a170ff0 executed on tested47b37db (all three CI38213290654 gates; artifact11729658054). First book returned a five-field object and failed creation.booking.require_payment/missing, meaning absent or null.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#current-task--live-field-identified-and-correction-prepared-12-october2026).

### Current task — intermediate contract audit and finite proof preparation, 12 October2026

Compared every consumed creation field with official public docs/examples and staff guidance. Public example is recurring, so current multiple-booking batch_id echo, batch/client hash details and intermediate end representation remain unresolved.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#current-task--intermediate-contract-audit-and-finite-proof-preparation-12-october2026).

### Current task — creation-envelope evidence after the successful read, 12 October 2026

Approved packet120046b5 executed and closed from tested8ac2227. The single retained-booking read passed all13 independent predicates, including50-minute occupied end, with40+10 service/buffer and confirmed status.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#current-task--creation-envelope-evidence-after-the-successful-read-12-october-2026).

### Historical checkpoint — inspect the retained booking format, 12 October 2026

Owner requested an actual existing-record read instead of guessed provider semantics. Read-only source is prepared: explicit one-use inspect mode, one exact retained key, shared independent predicates, no invoice/cancel/finalize/write, no scheduler/replay and no attempt/effect mutation.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--inspect-the-retained-booking-format-12-october-2026).

### Historical checkpoint — precise native diagnostics, 12 October 2026

Owner requested specific private validation errors and evidence-based diagnosis before another booking trial. Continued draft PR21 from5dacab5 on feat/native-checkout-completion-20261011; main25aac892 is unchanged.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--precise-native-diagnostics-12-october-2026).

### Historical checkpoint — approved192 checkout-proof preparation, 12 October2026

Owner approved preparation only: carry90 used toward192, reserve16, at most102 further provider calls (86 ordinary). Existing128 policy cannot start availability with22 ordinary calls because32 must remain for checkout.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--approved192-checkout-proof-preparation-12-october2026).

### Historical checkpoint — correct the cart lifecycle, 12 October 2026

Residual-only recovery is closed and booking/cart unchanged. The owner corrected our premature expectation of an invoice for an unfinished cart.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--correct-the-cart-lifecycle-12-october-2026).

### Historical checkpoint — existing residual recovery, 12 October 2026

The corrected identity proof is closed with one retained native booking and no verified link or cancellation. Native booking is not settled.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--existing-residual-recovery-12-october-2026).

### Preview failure reporting during identity-fix CI — 12 October 2026

The corrected identity source passed backend and live-email CI, including224 Worker cases and their browser/release gates. Frontend passed68/69 browser cases; one tablet synthetic checkout received HTML404 instead of200.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#preview-failure-reporting-during-identity-fix-ci--12-october-2026).

### Historical checkpoint — identity refresh across native reads, 12 October 2026

The approved idle procedure passed exact baseline/activation/closure readiness. Native checkout reached a distinct retained failure: provider_identity_expired on sessionIndex1, catalogue-instructors, before booking.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--identity-refresh-across-native-reads-12-october-2026).

### Historical checkpoint — test coordinator idle-lifecycle activation, 12 October 2026

The protected-readiness proof isolated an actual mismatch: active Worker, same-source coordinator still on the preceding closed configuration. Four observations exhausted the packet's readiness bound before creating native authority or making any provider request.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--test-coordinator-idle-lifecycle-activation-12-october-2026).

### Historical checkpoint — coordinator readiness and private window diagnosis, 12 October 2026

The exact approved128 proof executed and closed. Migration0017 preserved all existing rows; availability stopped at customer-window admission before any provider call, attempt or booking.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--coordinator-readiness-and-private-window-diagnosis-12-october-2026).

### Historical checkpoint — exact128-call continuation preparation, 12 October 2026

YS approved preparing a finite128-call cumulative policy, carrying33 used and reserving16 for recovery; no live action is approved. Source keeps the same campaign and persistent coordinator ledger.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--exact128-call-continuation-preparation-12-october-2026).

### Historical checkpoint — preserve private prerequisite evidence, 12 October 2026

The finite native checkout's prerequisite failure previously discarded its cause. Source now retains bounded private stage/code/operation/representation evidence in the existing grant result while preserving the customer response and one-use behavior.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--preserve-private-prerequisite-evidence-12-october-2026).

### Historical checkpoint — native HTTP/RPC diagnosis after verified closure, 12 October 2026

Approved signing amendment is executed and explicitly closed. Encrypted signing binding installed;0015/0016 applied and immutable.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--native-httprpc-diagnosis-after-verified-closure-12-october-2026).

### Historical checkpoint — missing deployed signing binding, 12 October 2026

Approved native backend proof stopped after two read-only management requests: required signing binding absent from the developer Worker. No migration, deployment, activation, provider request, booking, checkout link, cancellation, payment or notification occurred.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--missing-deployed-signing-binding-12-october-2026).

### Historical checkpoint — native failure-path closure, 11 October 2026

Continuation on PR21/feat/native-checkout-completion-20261011 from5e89220, actual main25aac892 unchanged. Implemented pre-validation reference retention, durable post-booking handoff recovery, strict known-reference compensation and default-denied finite cleanup permission in source-only0016.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--native-failure-path-closure-11-october-2026).

### 11 October — protected native customer flow

The existing customer journey now carries native service/provider IDs and current names/prices from catalogue and bounded date availability through players, Details, Review, immutable preparation and the one-use native checkout. Submitted slots must match server-retained offers; the Worker still rechecks the entire cart and each write.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#11-october--protected-native-customer-flow).

### 11 October — native checkout implementation and owner configuration confirmation

Owner confirmed developer tax0/S$88 final,40+10minutes and Client Login off. Source now has scoped declaration-based prebooking, fresh guest/native-client separation, single and multi-session native booking/invoice validation, no-replay effects, lost-finalization known-ID recovery and a one-use protected checkout route.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#11-october--native-checkout-implementation-and-owner-configuration-confirmation).

### Metadata discovery accepted and closed — 11 October 2026

YS approved packet SHA256 `e535f54372e47d6cde632f8b643b91dd669cb90eade2efbcdc9c50343831321a` in this session. Executed10:07:35–10:09:04UTC (18:07:35–18:09:04SGT),89.318 seconds within the20-minute limit.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#metadata-discovery-accepted-and-closed--11-october-2026).

### Current direction — technical integration before combined testing

YS now wants native booking and webhook/reconciliation technical work settled first, then one combined physical acceptance flight. Native source increment remains in PR21; Service Contracts contains the complete webhook execution brief with explicit delivery/signature/acknowledgement/idempotency/reconciliation/fallback/negative-test and closure gates.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#current-direction--technical-integration-before-combined-testing).

### Native booking completion task — six deliverables, 11 October 2026

Outcome: complete the supported customer booking path before treating native checkout or later webhooks as accepted. Owner-approved policies above remain unchanged.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-booking-completion-task--six-deliverables-11-october-2026).

### Previous task — native one-studio policy and North Star execution, 11 October 2026

Every booking automatically attempts a Comments entry `Number of players: N` (default1, range1–4). When the optional fifth Details field is filled, append `School / organisation: VALUE` on the next line; omit that line when blank.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#previous-task--native-one-studio-policy-and-north-star-execution-11-october-2026).

### Previous checkpoint — website-confirmed contact profile, 11 October 2026

YS explicitly replaced SimplyBook-only prefill with latest website-confirmed name/phone. One profile per normalized verified email/account/origin, shared by users of that email; saving only with Remember me selected at form submission, existing booking history untouched.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#previous-checkpoint--website-confirmed-contact-profile-11-october-2026).

### Previous checkpoint — North Star planning package, 11 October 2026

YS approved execution of the full North Star plan. Refreshed main `298c9c8f443063f8b21a2e7b006993a1ec76a9e7` contains owner-merged PR19; independent main CI38112617043 passed frontend/backend/live-email and Pages demo deployment.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#previous-checkpoint--north-star-planning-package-11-october-2026).

### Historical checkpoint — PR19 identity proof closed, 10 October 2026

Owner approved exact packet SHA256 `29eaa053cf5f251744aea5accbcf4fff121de90b6906b32b70d04fd3cb785148` and confirmed readiness. Executed sealed source `4a10133a001e1c1a4552e120a3d91b3c875bc664`, CI38045722099 (all three jobs passed), live artifact11667384145/ZIP SHA256 `8de0df981805a6f1f5aa81f0e0e14194182bd9740d649e820dcbaf08b2b23790`.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoint--pr19-identity-proof-closed-10-october-2026).

### Replacement email test closed — 10 October 2026

Deployed sourcef2795a1ef9c54e06ac2335f824a59e20c3b17f5e passed all three CI38036772168 jobs. Artifact11663527637/SHA2569bfc92f07ce78b73ab63d4d08c0d136f7b3cc6c57aab70bb05714f3119c06254,139 sealed files and12 migration byte identities verified;17 exact compiled-Worker cases passed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#replacement-email-test-closed--10-october-2026).

### Historical checkpoints — superseded by the current ledger

### Unused email window replacement — 10 October 2026

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-checkpoints--superseded-by-the-current-ledger).

### Email execution preparation — 10 October 2026

PR17 remains draft/open. Pinned deployment candidate is source `087576edbebe90bc60097d8655d6f758d91ab722`, successful CI37943447592, live artifact11622777711, ZIP SHA256 `14d31042f96a44f4b1d1124a1aa1104f84086ba8141de6a7e030bb60ab8e287c`.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#email-execution-preparation--10-october-2026).

### Live-email preparation continuation — 9 October 2026

Recovered exact PR16 `d8180f82e9556e9640227edd76c58d72e33b1b4b` / tree `85f4f011f65f883c5bb75921320c3a359645443b`; GitHub still reports draft/open/unmerged. New branch `feat/live-email-candidate-20261009` is stacked on it.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#live-email-preparation-continuation--9-october-2026).

### Resend composition continuation — 9 October 2026

Recovered PR14 source5673e79 and PR15 sourcea43ffb8, both draft/open/unmerged. Independently re-read both required successful CI jobs37909399171/37909424450.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#resend-composition-continuation--9-october-2026).

### Main integration campaign — active 9 October 2026

Governing instruction: MAIN INTEGRATION NORTH STAR, supplied9October. One agent.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#main-integration-campaign--active-9-october-2026).

### Approved discovery execution — closed 9 October 2026

YS approved the concrete discovery-only packet with “Yes Go.” Management window07:42:10–08:42:10UTC; one180-second grant, maximum5 provider calls,66 management requests and4 deployments including rollback. Exact approved/deployed source661cbf54ae33bd8e08f00d631ea78772f9ea2ded passed both CI jobs37899051046; backend artifact11600959051 was downloaded, SHA256-checked and its135 sealed files/eight migrations verified without rebuilding.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#approved-discovery-execution--closed-9-october-2026).

### Historical native mapping discovery preparation — 9 October 2026

One agent, start15:10SGT, hard stop21:10SGT, maximum3 repairs per distinct issue. Owner-merged PR13 verified at main757fd288084d0e76c7cb7b766e33c4724d6988d0; main CI37896841542 actually passed verify/frontend and verify/backend and existing Pages deploy.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-native-mapping-discovery-preparation--9-october-2026).

### Historical native adapter checkpoint — completed 9 October 2026

One agent; start13:00SGT, deadline19:00SGT; at most3 repairs per distinct issue. PR12 remains draft/unmerged, reviewed7b83a8b passed both CI jobs37884721443 (123 application,97 Worker,69 browser per path).

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-native-adapter-checkpoint--completed-9-october-2026).

### Historical native preparation checkpoint (completed in PR12)

### Preparation history

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-native-preparation-checkpoint-completed-in-pr12).

### Historical Experiment1 handover (superseded current status)

**Technical checkpoint passed:** source842adb94cdd0cc9c2952d8e13a62c3f43d98c30f, [Verify37874680093](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37874680093): exact `verify / frontend` and `verify / backend` both success.95 Worker cases,121 application cases and63 browser executions per root/Pages path, all original Chromium/phone-WebKit/tablet-WebKit projects, strict zero-skip/retry receipts. CI tested merge of this source into unchanged main3bf8e3b; deploy skipped.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-experiment1-handover-superseded-current-status).

### M3.3 technical handover — 9 October 2026

**Implemented:** existing access/intent/idempotency/effect/association/coordinator owners reused. Additive0006 records due work atomically with dispatch; internal bounded recovery claims fence original processes, expire/reclaim with durable generations and attempts, reject stale completion and retain unknown effect identity.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#m33-technical-handover--9-october-2026).

### M3.2 technical handover — 9 October 2026

**Implemented / Synthetic-tested:** the existing Preview journey now uses named asynchronous availability, checkout, pay, check and resolve contracts. Customers see loading and safe failure/unavailable states; selections/contact input survive errors.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#m32-technical-handover--9-october-2026).

### M3.1 technical handover — 08 October 2026, 23:21 SGT

**M3.1 technical scope verified under the approved exception; formal milestone closure pending the named dependencies.** Technical verification uses isolated runtime/concurrency evidence plus deployed foundation checks. Live log retrieval is separately unverified because the scoped observability query returned403; no production timing/placement or owner acceptance is claimed.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#m31-technical-handover--08-october-2026-2321-sgt).

### M3.1 execution record — 8 October 2026, 22:26 SGT

One agent; maximum six hours, deadline 9 October 04:26 SGT. Provider campaign stays closed: zero new provider calls/bookings/payments authorized.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#m31-execution-record--8-october-2026-2226-sgt).

### Closed continuation — 8 October 2026, 18:38 SGT

**Campaign complete; North Star incomplete.** One-agent continuation ran from the conservative17:26SGT start; closed before23:26SGT deadline. No automatic restart.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#closed-continuation--8-october-2026-1838-sgt).

### Continuation execution record — 8 October 2026

- Window: conservative start 17:26 SGT, deadline 23:26 SGT, maximum six hours; no automatic restart. One agent.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#continuation-execution-record--8-october-2026).

### Historical Cloudflare developer campaign — 8 October 2026

- Base: PR #10 owner-merged at `3bf8e3b45b0d771bc76e9087932c0180000d83d0`; main CI37743098312 passed. Historical checkout897cbfe remains unchanged.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-cloudflare-developer-campaign--8-october-2026).

### Finite accounting and resume boundary

Conservative execution window 16:00–22:00 SGT on 8 October 2026, maximum six hours; no automatic restart. Final automated management accounting is **56/200** Cloudflare requests, including 11 preflight and 36 Wrangler requests.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#finite-accounting-and-resume-boundary).

### Historical provider continuation checkpoint — 8 October 2026

- Provider continuation closed with concrete blockers; **M2 remains incomplete**. Execution source was PR#9 candidate `21c8fc855a0e6d8371b541b7ef35d3d4ee1b4e75`.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-provider-continuation-checkpoint--8-october-2026).

### Historical campaign checkpoint — superseded by continuation above

- Developer evidence campaign finished with concrete blockers; M2 is not complete. Source remains PR9 draft/unmerged at `21c8fc855a0e6d8371b541b7ef35d3d4ee1b4e75`, detached isolated worktree.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-campaign-checkpoint--superseded-by-continuation-above).

### Historical pre-campaign checkpoint — 8 October 2026

- PR#9 refreshed open/draft/unmerged at `21c8fc855a0e6d8371b541b7ef35d3d4ee1b4e75`. Reused detached worktree; historical `897cbfe737d31069ae25dca39c638cdededf3593`, empty index and seven existing documentation edits preserved.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-pre-campaign-checkpoint--8-october-2026).

### Checkpoint — 7 October 2026

- Active North Star: official research plus staged controlled developer experiments; no blanket six-answer support gate. Current preparation uses **0 provider-account requests, 0 business writes**; original allowance remains **3/3 exhausted**. - Refreshed main after merged PR #8: `97b42c7d561ffa0167eb3ca1113d18e143a9e0d9`, tree `976cf0a064a82bb655d22fc9156c5a4663a80068`.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#checkpoint--7-october-2026).

### Historical task ledger — superseded by current campaign checkpoint

Detailed checkpoint, decisions and verification evidence retained in the immutable source below.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-task-ledger--superseded-by-current-campaign-checkpoint).

### Native checkout staged preparation — 7 October 2026

- YS confirms development company/merchant/HitPay isolation, intended service/instructor/resource/timing/price-tax/intake structure, controlled notification inbox and YS dashboard reconciliation. Recorded as owner confirmations, not executed API evidence; do not request them again. - Service Contracts retains D6–D14 native invoice/payment-link research and adds D15–D20 corrections.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#native-checkout-staged-preparation--7-october-2026).

### Developer access and backend-plan reconciliation — 7 October 2026

- Fresh managed attachment: source configuration `5b37073b-4577-4be4-ac01-85c7f49399d0~cecfg_6ac526346c988198a82b0507650e2a7b`, version `5b37073b-4577-4be4-ac01-85c7f49399d0~cecfgver_6ac5dbcc564881988d31dffcafbb93e5`, desired/observed revision **4**, observations current, phase running. No environment display name was returned; the exact environment ID is in the sanitized receipt.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#developer-access-and-backend-plan-reconciliation--7-october-2026).

### C3 runtime restoration evidence — 7 October 2026

- Verified reviewed checkpoint: `experiment/codex-cloud-workflow-2026-10-06` at full HEAD `897cbfe737d31069ae25dca39c638cdededf3593`; base `0cea68168738c722d05be9d3580938b65a4860c7` ancestry passed. Source and index were clean and unchanged throughout verification.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#c3-runtime-restoration-evidence--7-october-2026).

### C4 evidence review — 7 October 2026

- Existing [PR #6](https://github.com/LimYouSheng/SoccerBotStudioSG/pull/6) was open, draft and unmerged at that historical review. At review, the head was `897cbfe737d31069ae25dca39c638cdededf3593` on `experiment/codex-cloud-workflow-2026-10-06`, matching local HEAD and the C3 checkpoint.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#c4-evidence-review--7-october-2026).

### Preparation evidence

- Latest OneFitfinity comparison: PR #8 head `16eea945f9324b6f20610d0a0b98b1a1cb6014e9`, based on main `7970f65b5975a6554c46eb521c7ca118939e4bb9`. Re-read its four entry/Cloud files and the relevant canonical docs/runbook sections.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#preparation-evidence).

### Provider evidence and remaining work

- Client public catalogue, timezone, timeframe, work-calendar envelopes, 1/7/31-day availability and sampled end-time reads were exercised. Read-only discovery is sufficient to proceed with this source transition. - Latest R2: 51/51 calls passed, no retries, 268 offered starts unchanged between snapshots, 16 offered end-time samples all 50 minutes.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#provider-evidence-and-remaining-work).

### Documentation handoff — 7 October 2026

The user authorized committing/pushing only the intended documentation to existing draft PR #6 and updating its description. This handoff preserves the C3/C4 findings above and replaces obsolete host-install instructions in `docs/CODEX_CLOUD.md` with the verified retained Docker reuse procedure.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#documentation-handoff--7-october-2026).

### Bounded CI repair — 7 October 2026

- Documentation handoff commit `74ca490f8a52025eff16933e500933c359eebfee` reached [CI run 37559663874](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37559663874), attempt 1, but `verify / frontend` failed at `time-step.test.tsx:47` (two instructor cards expected, one received). Preserve the [original failure artifact](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37559663874/artifacts/11456785312); 42 unit/component/service cases passed and one failed, so build/browser gates did not execute.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#bounded-ci-repair--7-october-2026).

### M2.1 reconciliation — 7 October 2026

- Started from clean branch `experiment/codex-cloud-workflow-2026-10-06`, HEAD `a6f1a6cc151200727d7806ff97a79c963edb2516`, clean index. [Full CI 37560542328](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37560542328) passed that repair candidate (43 unit/component/service, 42 browser cases); C3 runtime/evidence and original failures are reused, not rerun or rewritten. - [Service Contracts](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/docs/SERVICE_CONTRACTS.md#m21-capability-matrix--reconciled-7-october-2026) now owns the 14-row capability matrix, dated official sources, exact next proof, responsible access roles and synthetic reconciliation plan. No production adapter, Worker API or payment flow is implemented. - Reused the canonical 51/51 R2 findings, 268 unchanged starts and 16 offered-start 50-minute intervals.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#m21-reconciliation--7-october-2026).

### Elapsed-slot application trial — 7 October 2026

- Preserved checkpoint/index identity in `/workspace/work/elapsed-slot-trial/baseline.json`. Preparation key/image and all three inherited variables match the C3 configuration.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#elapsed-slot-application-trial--7-october-2026).

### Historical developer native-payment reconciliation — before PR #7 merge

- Four original private chat attachments inspected: Card HitPay `Screenshot 2026-10-07 121355.png`, Card SimplyBook/SBPay `121405.png`, PayNow HitPay `122134.png`, PayNow SimplyBook/SBPay `122144.png` (same filename prefix/date). Originals remain with YS/in the conversation; no repository image copies, contact data or reconstructed original files.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#historical-developer-native-payment-reconciliation--before-pr-7-merge).

### Next run

Use the single next-ready task in the current ledger above and the proposed ordering in NORTH_STAR. Historical discovery/email setup instructions below are not fresh authority.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#next-run).

### Update discipline

- Keep one current ledger, not a transcript. Move completed milestone summaries to Journey. - Retain source identity, command, environment, result/count, log/workflow reference and limitations. - Carry diagnoses and next actions forward.

[Full dated evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_JOURNEY.md#update-discipline).

### Historical contract and rule source index

The superseded [4 October diagram](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/architecture/SoccerBotStudio_Architecture.svg) remains in Git history.

Supporting sections not repeated in the narrative remain available at the exact pre-refactor revision. These links preserve complete details without duplicating current rules.

- [Complete historical SERVICE_CONTRACTS.md](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md).
- [Complete historical SOCCERBOT_RULES_AND_ARCHITECTURE.md](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md).
- [Complete historical CODEX_CLOUD.md](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/CODEX_CLOUD.md).

<details>
<summary>Historical section index: SERVICE_CONTRACTS.md</summary>

- [Prepared isolated load runner — 21 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#prepared-isolated-load-runner--21-october-2026).
- [Burst results and overload follow-up — 21 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#burst-results-and-overload-follow-up--21-october-2026).
- [Remaining acceptance and combined resilience campaign — 21 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#remaining-acceptance-and-combined-resilience-campaign--21-october-2026).
- [Consistent calendar selection — 21 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#consistent-calendar-selection--21-october-2026-sgt).
- [Rejected checkout readback — 21 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#rejected-checkout-readback--21-october-2026-sgt).
- [Unresolved confirmation refresh — 21 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#unresolved-confirmation-refresh--21-october-2026-sgt).
- [Confirmation details and acceptance follow-up — 21 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#confirmation-details-and-acceptance-follow-up--21-october-2026).
- [Backend OpenTelemetry export — preparation, 21 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#backend-opentelemetry-export--preparation-21-october-2026).
- [Test-suite audit — 21 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#test-suite-audit--21-october-2026).
- [Checkout and recovery storage contracts](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#checkout-and-recovery-storage-contracts).
- [Provider token cache contract](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#provider-token-cache-contract).
- [Confirmation read snapshot contract](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#confirmation-read-snapshot-contract).
- [Current checkout and queue contracts — 20 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#current-checkout-and-queue-contracts--20-october-2026).
- [Historical contracts and evidence](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#historical-contracts-and-evidence).
- [Checkout phase tracing — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#checkout-phase-tracing--20-october-2026-sgt).
- [Batch checkout creation path — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#batch-checkout-creation-path--20-october-2026-sgt).
- [Checkout D1 consolidation — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#checkout-d1-consolidation--20-october-2026-sgt).
- [Lean single checkout — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#lean-single-checkout--20-october-2026-sgt).
- [PR66 CI cookie-adapter correction — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#pr66-ci-cookie-adapter-correction--20-october-2026-sgt).
- [Authentication rejection diagnostic follow-up — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#authentication-rejection-diagnostic-follow-up--20-october-2026-sgt).
- [HAR10 confirmation stability and pre-dispatch authentication failure — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#har10-confirmation-stability-and-pre-dispatch-authentication-failure--20-october-2026-sgt).
- [Confirmation read timestamp race — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#confirmation-read-timestamp-race--20-october-2026-sgt).
- [Independent payment deadlines — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#independent-payment-deadlines--20-october-2026-sgt).
- [Interrupted provider transport recovery — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#interrupted-provider-transport-recovery--20-october-2026-sgt).
- [Lost checkout response test ordering — 20 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#lost-checkout-response-test-ordering--20-october-2026).
- [PR62 checkout transport verification — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#pr62-checkout-transport-verification--20-october-2026-sgt).
- [Validated batch closure handoff — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#validated-batch-closure-handoff--20-october-2026-sgt).
- [Direct saved checkout handoff — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#direct-saved-checkout-handoff--19-october-2026-sgt).
- [Scheduled public snapshots — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#scheduled-public-snapshots--19-october-2026-sgt).
- [Public display cache fast path and loading scope — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#public-display-cache-fast-path-and-loading-scope--19-october-2026-sgt).
- [Local Review and fixed payment-checking contract — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#local-review-and-fixed-payment-checking-contract--19-october-2026-sgt).
- [Editable Review, combined checkout and compact confirmation — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#editable-review-combined-checkout-and-compact-confirmation--19-october-2026-sgt).
- [HAR08 confirmation continuity and record reconciliation — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#har08-confirmation-continuity-and-record-reconciliation--19-october-2026-sgt).
- [Email-code browser interaction repair — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#email-code-browser-interaction-repair--19-october-2026-sgt).
- [Fifteen-minute hold and eight-minute payment policy — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#fifteen-minute-hold-and-eight-minute-payment-policy--19-october-2026-sgt).
- [Completed-dismissal CI setup repair — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#completed-dismissal-ci-setup-repair--19-october-2026-sgt).
- [Pre-creation read concurrency — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#pre-creation-read-concurrency--19-october-2026-sgt).
- [HitPay transport failure diagnostics — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#hitpay-transport-failure-diagnostics--19-october-2026-sgt).
- [Checkout progress, expiry and customer success — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#checkout-progress-expiry-and-customer-success--19-october-2026-sgt).
- [Checkout handoff lifecycle regression — 19 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#checkout-handoff-lifecycle-regression--19-october-2026).
- [Mandatory test-impact pass after every change — 19 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#mandatory-test-impact-pass-after-every-change--19-october-2026).
- [One-month calendar preload — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#one-month-calendar-preload--19-october-2026-sgt).
- [Final single-booking optimization pass — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#final-single-booking-optimization-pass--19-october-2026-sgt).
- [Checkout display details and immediate confirmed-page exit — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#checkout-display-details-and-immediate-confirmed-page-exit--19-october-2026-sgt).
- [Latest05 latency pass and comment milestone — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#latest05-latency-pass-and-comment-milestone--19-october-2026-sgt).
- [Review presentation continuity — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#review-presentation-continuity--19-october-2026-sgt).
- [Single-booking latency contract — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#single-booking-latency-contract--19-october-2026-sgt).
- [Combined batch validation and owner conflict check — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#combined-batch-validation-and-owner-conflict-check--19-october-2026-sgt).
- [Independent checking-window regression — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#independent-checking-window-regression--19-october-2026-sgt).
- [Browser failure acceptance matrix — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#browser-failure-acceptance-matrix--18-october-2026).
- [Combined holding request — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#combined-holding-request--18-october-2026).
- [Rebooking background dismissal and latest03 evidence — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#rebooking-background-dismissal-and-latest03-evidence--18-october-2026).
- [Latest02 latency and email repair — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#latest02-latency-and-email-repair--18-october-2026).
- [Checkout authority and timing — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#checkout-authority-and-timing--18-october-2026).
- [Initial comments enabled in source — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#initial-comments-enabled-in-source--18-october-2026).
- [Comment-delivery audit and HitPay handoff — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#comment-delivery-audit-and-hitpay-handoff--18-october-2026).
- [Completed booking exit and provider diagnostics — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#completed-booking-exit-and-provider-diagnostics--18-october-2026).
- [Single-session validation consolidation — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#single-session-validation-consolidation--18-october-2026).
- [Saved confirmation and current receipt — 17 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#saved-confirmation-and-current-receipt--17-october-2026).
- [Paid return continuity and restore-before-prefetch — 17 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#paid-return-continuity-and-restore-before-prefetch--17-october-2026).
- [PR41 CI repair and paid-return diagnosis — 17 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#pr41-ci-repair-and-paid-return-diagnosis--17-october-2026).
- [HAR-fixed-01 booking loading and latency review — 17 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#har-fixed-01-booking-loading-and-latency-review--17-october-2026).
- [Migration runbook and required acceptance evidence — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#migration-runbook-and-required-acceptance-evidence--16-october-2026).
- [Migration sweep: remove old-account session preload — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#migration-sweep-remove-old-account-session-preload--16-october-2026).
- [One-attempt new-account acceptance packet — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#one-attempt-new-account-acceptance-packet--16-october-2026).
- [Environment readiness and owner confirmations — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#environment-readiness-and-owner-confirmations--16-october-2026).
- [Booking-check review and legacy continuity requirements — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#booking-check-review-and-legacy-continuity-requirements--16-october-2026).
- [Opening hours, four-hour lead and observed HitPay host — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#opening-hours-four-hour-lead-and-observed-hitpay-host--16-october-2026).
- [HAR06 checkout latency and payment diagnostics — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#har06-checkout-latency-and-payment-diagnostics--16-october-2026).
- [Sandbox deployment and recovery correction — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#sandbox-deployment-and-recovery-correction--16-october-2026).
- [Private hold evidence — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#private-hold-evidence--16-october-2026).
- [Holding request HTTP boundary — 15 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#holding-request-http-boundary--15-october-2026).
- [Review booking continuation and failed selection — 15 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#review-booking-continuation-and-failed-selection--15-october-2026).
- [Direct hosted HitPay handoff — 15 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#direct-hosted-hitpay-handoff--15-october-2026).
- [Ongoing identity and physical-test readiness — 15 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#ongoing-identity-and-physical-test-readiness--15-october-2026).
- [Indexed admission acceptance — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#indexed-admission-acceptance--14-october-2026).
- [Token-boundary calendar failure and correction — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#token-boundary-calendar-failure-and-correction--14-october-2026).
- [Customer lead-time contract — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#customer-lead-time-contract--14-october-2026).
- [Anonymous homepage metadata and entry reuse — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#anonymous-homepage-metadata-and-entry-reuse--14-october-2026).
- [Cold calendar prefetch freshness contract — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#cold-calendar-prefetch-freshness-contract--14-october-2026).
- [Premium catalogue map and deployment health evidence — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#premium-catalogue-map-and-deployment-health-evidence--14-october-2026).
- [Cached time offers and priced native services — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#cached-time-offers-and-priced-native-services--14-october-2026).
- [Continuous customer browsing and checkout — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#continuous-customer-browsing-and-checkout--14-october-2026).
- [Session/calendar inspection window — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#sessioncalendar-inspection-window--14-october-2026).
- [Anonymous calendar and final receipt — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#anonymous-calendar-and-final-receipt--14-october-2026).
- [Calendar overview, fresh continuation and hidden initialization — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#calendar-overview-fresh-continuation-and-hidden-initialization--14-october-2026).
- [Revised experiment: no visible provider-homepage detour — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#revised-experiment-no-visible-provider-homepage-detour--14-october-2026).
- [Proposed full customer-journey experiment — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#proposed-full-customer-journey-experiment--14-october-2026).
- [Homepage-first checkout34 rendered after displayed due time — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#homepage-first-checkout34-rendered-after-displayed-due-time--14-october-2026).
- [Broader community research: related precedents, no exact verified fix — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#broader-community-research-related-precedents-no-exact-verified-fix--13-october-2026).
- [Invoice authorization investigation: session continuity is the specific lead — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#invoice-authorization-investigation-session-continuity-is-the-specific-lead--13-october-2026).
- [Same original reference34 link reaches both checkout and e403 — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#same-original-reference34-link-reaches-both-checkout-and-e403--13-october-2026).
- [Native checkout34 reached intermittently with30-minute window — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-checkout34-reached-intermittently-with30-minute-window--13-october-2026).
- [Native invoice33 exists; displayed due time confounds the control — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-invoice33-exists-displayed-due-time-confounds-the-control--13-october-2026).
- [SBPay transaction33 explicitly has no related invoice document — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#sbpay-transaction33-explicitly-has-no-related-invoice-document--13-october-2026).
- [Native control exact error and post-failure pending state — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-control-exact-error-and-post-failure-pending-state--13-october-2026).
- [Native emailed link reproduces invoice-details403 with cookies sent — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-emailed-link-reproduces-invoice-details403-with-cookies-sent--13-october-2026).
- [Native dashboard Pay Later link issued; navigation stopped — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-dashboard-pay-later-link-issued-navigation-stopped--13-october-2026).
- [Ten-minute payment timeout compared with original failure — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#ten-minute-payment-timeout-compared-with-original-failure--13-october-2026).
- [Invoice 32 now cancelled by timeout — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#invoice-32-now-cancelled-by-timeout--13-october-2026).
- [Owner-reported remaining account allowance — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#owner-reported-remaining-account-allowance--13-october-2026).
- [Native invoice-link authorization: documented boundary — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-invoice-link-authorization-documented-boundary--13-october-2026).
- [Native invoice access403 captured; browser payment remains blocked — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-invoice-access403-captured-browser-payment-remains-blocked--13-october-2026).
- [Checkout diagnostic budget failure and verified closure — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#checkout-diagnostic-budget-failure-and-verified-closure--13-october-2026).
- [Fresh checkout-opening diagnostic preparation — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#fresh-checkout-opening-diagnostic-preparation--13-october-2026).
- [Owner confirms native homepage and PRO trial — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#owner-confirms-native-homepage-and-pro-trial--13-october-2026).
- [Current native settings readback — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#current-native-settings-readback--13-october-2026).
- [Checkout 404 diagnosis narrowed — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#checkout-404-diagnosis-narrowed--13-october-2026).
- [Native payment-link navigation failure — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-payment-link-navigation-failure--13-october-2026).
- [Proposed owner payment and paired callback test — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#proposed-owner-payment-and-paired-callback-test--13-october-2026).
- [Booking 39 ingress correlation and provider trace boundary — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#booking-39-ingress-correlation-and-provider-trace-boundary--13-october-2026).
- [Paired delivery control result and next evidence — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#paired-delivery-control-result-and-next-evidence--13-october-2026).
- [Paired booking/invoice capture contract — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#paired-bookinginvoice-capture-contract--13-october-2026).
- [Deeper investigation: pre-payment event expectation is unproven — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#deeper-investigation-pre-payment-event-expectation-is-unproven--13-october-2026).
- [Stored delivery evidence: no recorded arrival at the Worker — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#stored-delivery-evidence-no-recorded-arrival-at-the-worker--13-october-2026).
- [New booking accepted; webhook observation failed; cleanup verified — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#new-booking-accepted-webhook-observation-failed-cleanup-verified--13-october-2026).
- [Body-independent DELETE acknowledgement — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#body-independent-delete-acknowledgement--13-october-2026).
- [Read-only reconciliation restored the active baseline — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#read-only-reconciliation-restored-the-active-baseline--13-october-2026).
- [Cleanup DELETE outcome unknown; access closed — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#cleanup-delete-outcome-unknown-access-closed--13-october-2026).
- [Subscription flag repair — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#subscription-flag-repair--13-october-2026).
- [Subscription diagnostic executed and closed — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#subscription-diagnostic-executed-and-closed--13-october-2026).
- [Webhook flight stopped; access closed, subscription unresolved — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#webhook-flight-stopped-access-closed-subscription-unresolved--13-october-2026).
- [Read-only subscription structure diagnostic](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#read-only-subscription-structure-diagnostic).
- [Approved technical payment/webhook campaign — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#approved-technical-paymentwebhook-campaign--13-october-2026).
- [Finite webhook subscription lifecycle](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#finite-webhook-subscription-lifecycle).
- [Payment correction and authenticated webhook capture — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#payment-correction-and-authenticated-webhook-capture--13-october-2026).
- [Developer native booking accepted and independently closed — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#developer-native-booking-accepted-and-independently-closed--13-october-2026).
- [Owner roster and instructor priority — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#owner-roster-and-instructor-priority--12-october-2026).
- [Approved setup inspection completed and closed — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#approved-setup-inspection-completed-and-closed--12-october-2026).
- [Full native acceptance execution resumed — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#full-native-acceptance-execution-resumed--12-october2026).
- [Native campaign stopped on actual date availability — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-campaign-stopped-on-actual-date-availability--12-october2026).
- [Actual calendar discovery before the final native gate — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#actual-calendar-discovery-before-the-final-native-gate--12-october2026).
- [Native single proof accepted and closed — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-single-proof-accepted-and-closed--12-october2026).
- [Availability-only stop and actual-attempt accounting — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#availability-only-stop-and-actual-attempt-accounting--12-october2026).
- [Native acceptance evidence after flight2 — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-acceptance-evidence-after-flight2--12-october2026).
- [Observed closeBatch envelope and invoice validation contract — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#observed-closebatch-envelope-and-invoice-validation-contract--12-october2026).
- [Native acceptance checklist and approved autonomous campaign — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-acceptance-checklist-and-approved-autonomous-campaign--12-october2026).
- [Batch response collection validation — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#batch-response-collection-validation--12-october2026).
- [256 trial: second book receipt collection rejected — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#256-trial-second-book-receipt-collection-rejected--12-october2026).
- [Approved limits and next live-test packet — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#approved-limits-and-next-live-test-packet--12-october2026).
- [Retained batch identity and optional receipt echo — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#retained-batch-identity-and-optional-receipt-echo--12-october2026).
- [Observed missing intermediate batch echo — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#observed-missing-intermediate-batch-echo--12-october2026).
- [Next finite experiment prepared — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#next-finite-experiment-prepared--12-october2026).
- [Observed intermediate payment-flag absence — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#observed-intermediate-payment-flag-absence--12-october2026).
- [Intermediate creation contract audit — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#intermediate-creation-contract-audit--12-october-2026).
- [Executed existing-record inspection — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#executed-existing-record-inspection--12-october-2026).
- [Native validation diagnosis contract — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-validation-diagnosis-contract--12-october-2026).
- [Finite192-call continuation contract — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#finite192-call-continuation-contract--12-october-2026).
- [Documented native lifecycle and validation phases — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#documented-native-lifecycle-and-validation-phases--12-october-2026).
- [Residual-only recovery and post-write diagnostics — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#residual-only-recovery-and-post-write-diagnostics--12-october-2026).
- [Preview handler error boundary](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#preview-handler-error-boundary).
- [Forward-read identity contract — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#forward-read-identity-contract--12-october-2026).
- [Idle-lifecycle configuration experiment — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#idle-lifecycle-configuration-experiment--12-october-2026).
- [Native readiness contract after verified closure — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-readiness-contract-after-verified-closure--12-october-2026).
- [Finite128-call policy contract — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#finite128-call-policy-contract--12-october-2026).
- [Internal native prerequisite diagnosis — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#internal-native-prerequisite-diagnosis--12-october-2026).
- [Native proof observations and safe RPC errors — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-proof-observations-and-safe-rpc-errors--12-october-2026).
- [Deployed signing prerequisite — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#deployed-signing-prerequisite--12-october-2026).
- [Native failure recovery and compensation — 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-failure-recovery-and-compensation--11-october-2026).
- [Protected customer-native operations — 11 October](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#protected-customer-native-operations--11-october).
- [11 October — native checkout implementation and owner configuration confirmation](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#11-october--native-checkout-implementation-and-owner-configuration-confirmation).
- [Current metadata evidence — 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#current-metadata-evidence--11-october-2026).
- [Webhook and payment reconciliation task — 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#webhook-and-payment-reconciliation-task--11-october-2026).
- [Native completion implementation contract — 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-completion-implementation-contract--11-october-2026).
- [Native execution priority and studio allocation — 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-execution-priority-and-studio-allocation--11-october-2026).
- [Next A3 delivery package — source preparation, 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#next-a3-delivery-package--source-preparation-11-october-2026).
- [PR19 proof execution outcome — closed, 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#pr19-proof-execution-outcome--closed-10-october-2026).
- [Historical M3.4–M3.5 packet — prepared then approved and closed, 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#historical-m34m35-packet--prepared-then-approved-and-closed-10-october-2026).
- [M3.5 implementation design — 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#m35-implementation-design--10-october-2026).
- [M2.5/M3.6 lookup research — 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#m25m36-lookup-research--10-october-2026).
- [Historical proposed A3 remembered identity and prefill contract — 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#historical-proposed-a3-remembered-identity-and-prefill-contract--10-october-2026).
- [Replacement email test result — 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#replacement-email-test-result--10-october-2026).
- [Unused email window replacement — 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#unused-email-window-replacement--10-october-2026).
- [Corrected readiness and discovery package — prepared, not authorized](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#corrected-readiness-and-discovery-package--prepared-not-authorized).
- [End-to-end developer acceptance matrix — reconciled 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#end-to-end-developer-acceptance-matrix--reconciled-11-october-2026).
- [Connected developer composition — source checkpoint, 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#connected-developer-composition--source-checkpoint-9-october-2026).
- [M3.3 durable recovery contract — 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#m33-durable-recovery-contract--9-october-2026).
- [Implemented developer foundation — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#implemented-developer-foundation--8-october-2026).
- [Composition and authority — M3.2, 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#composition-and-authority--m32-9-october-2026).
- [Implemented operations — demo only](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#implemented-operations--demo-only).
- [Demo instructor rotation and customer disclosure](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#demo-instructor-rotation-and-customer-disclosure).
- [Current data and state model](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#current-data-and-state-model).
- [Future Worker contract requirements — not implemented endpoints](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#future-worker-contract-requirements--not-implemented-endpoints).
- [Planned latency-aware live operations — design only, 5 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#planned-latency-aware-live-operations--design-only-5-october-2026).
- [Required evidence and change discipline](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#required-evidence-and-change-discipline).
- [Presentation navigation boundary — 4 October restoration](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#presentation-navigation-boundary--4-october-restoration).
- [Iteration dependencies — current planning baseline](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#iteration-dependencies--current-planning-baseline).
- [Observed SimplyBook reads — 6 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#observed-simplybook-reads--6-october-2026).
- [M2.1 capability matrix — reconciled 7 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#m21-capability-matrix--reconciled-7-october-2026).
- [Developer native-payment evidence and first proof — 7 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#developer-native-payment-evidence-and-first-proof--7-october-2026).
- [M2 Card proof and browser-return reliability preparation — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#m2-card-proof-and-browser-return-reliability-preparation--8-october-2026).
- [Historical M2.2 CAP05 preparation — retired by subsequent owner scope decision](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#historical-m22-cap05-preparation--retired-by-subsequent-owner-scope-decision).
- [Historical M2.2 DUP06 same-instructor duplicate-slot preparation — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#historical-m22-dup06-same-instructor-duplicate-slot-preparation--8-october-2026).
- [DUP06 contact-control correction — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#dup06-contact-control-correction--8-october-2026).
- [8 October 2026 — approved DUP06 stopped at first authentication](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#8-october-2026--approved-dup06-stopped-at-first-authentication).
- [Historical capacity request43 offline diagnosis and proposed diagnostic continuation — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#historical-capacity-request43-offline-diagnosis-and-proposed-diagnostic-continuation--8-october-2026).
- [Historical developer integration campaign disposition — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#historical-developer-integration-campaign-disposition--8-october-2026).
- [Focused continuation contracts and disposition — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#focused-continuation-contracts-and-disposition--8-october-2026).
- [M3.2 bounded native-contract research — 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#m32-bounded-native-contract-research--9-october-2026).
- [Finite developer email composition — 9 October continuation](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#finite-developer-email-composition--9-october-continuation).
- [Native single-session preparation — 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-single-session-preparation--9-october-2026).
- [Native adapter contracts — PR13 checkpoint, 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-adapter-contracts--pr13-checkpoint-9-october-2026).
- [Dynamic catalogue and pre-booking — current contract](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#dynamic-catalogue-and-pre-booking--current-contract).
- [Native configuration discovery — current, 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SERVICE_CONTRACTS.md#native-configuration-discovery--current-9-october-2026).

</details>

<details>
<summary>Historical section index: SOCCERBOT_RULES_AND_ARCHITECTURE.md</summary>

- [Consistent calendar selection — 21 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#consistent-calendar-selection--21-october-2026-sgt).
- [Rejected checkout presentation — 21 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#rejected-checkout-presentation--21-october-2026-sgt).
- [Unresolved return-page refresh — 21 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#unresolved-return-page-refresh--21-october-2026-sgt).
- [Confirmation details presentation — 21 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#confirmation-details-presentation--21-october-2026).
- [Backend telemetry preparation — 21 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#backend-telemetry-preparation--21-october-2026).
- [Current implementation rules — 20 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-implementation-rules--20-october-2026).
- [Isolated load preparation — 21 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#isolated-load-preparation--21-october-2026).
- [Milestone status — 21 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#milestone-status--21-october-2026).
- [Historical design record](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#historical-design-record).
- [Checkout phase tracing — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#checkout-phase-tracing--20-october-2026-sgt).
- [Batch checkout creation path — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#batch-checkout-creation-path--20-october-2026-sgt).
- [Checkout D1 consolidation — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#checkout-d1-consolidation--20-october-2026-sgt).
- [Lean single checkout — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#lean-single-checkout--20-october-2026-sgt).
- [PR66 CI cookie-adapter correction — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#pr66-ci-cookie-adapter-correction--20-october-2026-sgt).
- [Authentication rejection diagnostic follow-up — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#authentication-rejection-diagnostic-follow-up--20-october-2026-sgt).
- [HAR10 confirmation stability and pre-dispatch authentication failure — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#har10-confirmation-stability-and-pre-dispatch-authentication-failure--20-october-2026-sgt).
- [Confirmation read timestamp race — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#confirmation-read-timestamp-race--20-october-2026-sgt).
- [Independent payment deadlines — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#independent-payment-deadlines--20-october-2026-sgt).
- [Interrupted provider transport recovery — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#interrupted-provider-transport-recovery--20-october-2026-sgt).
- [Lost checkout response test ordering — 20 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#lost-checkout-response-test-ordering--20-october-2026).
- [PR62 checkout transport verification — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#pr62-checkout-transport-verification--20-october-2026-sgt).
- [Batch evidence reuse and bounded persistence — 20 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#batch-evidence-reuse-and-bounded-persistence--20-october-2026-sgt).
- [Checkout handoff optimization — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#checkout-handoff-optimization--19-october-2026-sgt).
- [Persistent display warming and booking-triggered refresh — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#persistent-display-warming-and-booking-triggered-refresh--19-october-2026-sgt).
- [Browsing cache priority and local loading — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#browsing-cache-priority-and-local-loading--19-october-2026-sgt).
- [Local Review and anchored return checking — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#local-review-and-anchored-return-checking--19-october-2026-sgt).
- [Editable Review, combined checkout and compact confirmation — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#editable-review-combined-checkout-and-compact-confirmation--19-october-2026-sgt).
- [HAR08 confirmation continuity and record reconciliation — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#har08-confirmation-continuity-and-record-reconciliation--19-october-2026-sgt).
- [Email-code browser interaction repair — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#email-code-browser-interaction-repair--19-october-2026-sgt).
- [Fifteen-minute hold and eight-minute payment policy — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#fifteen-minute-hold-and-eight-minute-payment-policy--19-october-2026-sgt).
- [Completed-dismissal CI setup repair — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#completed-dismissal-ci-setup-repair--19-october-2026-sgt).
- [Pre-creation concurrency ownership — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#pre-creation-concurrency-ownership--19-october-2026-sgt).
- [Payment failure diagnostic boundary — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#payment-failure-diagnostic-boundary--19-october-2026-sgt).
- [Customer confirmation and shared checkout deadline — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#customer-confirmation-and-shared-checkout-deadline--19-october-2026-sgt).
- [Pending: controlled account-coordinator concurrency — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#pending-controlled-account-coordinator-concurrency--19-october-2026-sgt).
- [Retained Review checkout handoff — 19 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#retained-review-checkout-handoff--19-october-2026).
- [Test-impact review is part of every change — 19 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#test-impact-review-is-part-of-every-change--19-october-2026).
- [One-month calendar preload — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#one-month-calendar-preload--19-october-2026-sgt).
- [Final single-booking optimization pass — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#final-single-booking-optimization-pass--19-october-2026-sgt).
- [Stable Review and confirmation presentation — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#stable-review-and-confirmation-presentation--19-october-2026-sgt).
- [Comment-complete Review and D1 round trips — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#comment-complete-review-and-d1-round-trips--19-october-2026-sgt).
- [Review route continuity — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#review-route-continuity--19-october-2026-sgt).
- [Verification latency ownership — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#verification-latency-ownership--19-october-2026-sgt).
- [Combined batch and location UI ownership — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#combined-batch-and-location-ui-ownership--19-october-2026-sgt).
- [Independent checking-window regression — 19 October 2026 SGT](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#independent-checking-window-regression--19-october-2026-sgt).
- [Browser failure-test ownership — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#browser-failure-test-ownership--18-october-2026).
- [Combined holding ownership — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#combined-holding-ownership--18-october-2026).
- [Immediate explicit rebooking — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#immediate-explicit-rebooking--18-october-2026).
- [Immediate payment recovery and ongoing contact access — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#immediate-payment-recovery-and-ongoing-contact-access--18-october-2026).
- [Checkout authority consolidation — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#checkout-authority-consolidation--18-october-2026).
- [New-booking comment delivery — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#new-booking-comment-delivery--18-october-2026).
- [HitPay navigation loading and missing booking comments — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#hitpay-navigation-loading-and-missing-booking-comments--18-october-2026).
- [Completed booking exit and provider diagnostics — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#completed-booking-exit-and-provider-diagnostics--18-october-2026).
- [Circular mouse cursor — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#circular-mouse-cursor--18-october-2026).
- [Single-session holding validation — 18 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#single-session-holding-validation--18-october-2026).
- [Confirmation return presentation — 17 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#confirmation-return-presentation--17-october-2026).
- [Paid return continuity and restore-before-prefetch — 17 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#paid-return-continuity-and-restore-before-prefetch--17-october-2026).
- [PR41 CI repair and paid-return diagnosis — 17 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#pr41-ci-repair-and-paid-return-diagnosis--17-october-2026).
- [Booking loading presentation — 17 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#booking-loading-presentation--17-october-2026).
- [Account migration and test evidence requirements — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#account-migration-and-test-evidence-requirements--16-october-2026).
- [Migration sweep: remove old-account session preload — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#migration-sweep-remove-old-account-session-preload--16-october-2026).
- [Foreground booking scheduling and migration boundary — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#foreground-booking-scheduling-and-migration-boundary--16-october-2026).
- [Opening hours, four-hour lead and observed HitPay host — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#opening-hours-four-hour-lead-and-observed-hitpay-host--16-october-2026).
- [HAR06 checkout latency and payment diagnostics — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#har06-checkout-latency-and-payment-diagnostics--16-october-2026).
- [Approved sandbox deployment and recoverable rejection — 16 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#approved-sandbox-deployment-and-recoverable-rejection--16-october-2026).
- [Holding request ingress — 15 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#holding-request-ingress--15-october-2026).
- [Review booking repair boundary — 15 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#review-booking-repair-boundary--15-october-2026).
- [Direct hosted HitPay handoff — 15 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#direct-hosted-hitpay-handoff--15-october-2026).
- [Ongoing developer identity — 15 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#ongoing-developer-identity--15-october-2026).
- [Admission storage query cost — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#admission-storage-query-cost--14-october-2026).
- [Identity cache cannot outlive provider tokens — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#identity-cache-cannot-outlive-provider-tokens--14-october-2026).
- [Customer booking cutoff is 150 minutes — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#customer-booking-cutoff-is-150-minutes--14-october-2026).
- [Homepage display cache survives entry — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#homepage-display-cache-survives-entry--14-october-2026).
- [Fresh catalogue for cold month reads — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#fresh-catalogue-for-cold-month-reads--14-october-2026).
- [Observed catalogue representation and deployment propagation — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#observed-catalogue-representation-and-deployment-propagation--14-october-2026).
- [Browser availability and date-dependent pricing — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#browser-availability-and-date-dependent-pricing--14-october-2026).
- [Ongoing developer customer access — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#ongoing-developer-customer-access--14-october-2026).
- [Live inspection admission repair — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#live-inspection-admission-repair--14-october-2026).
- [Homepage reads and protected receipt parity — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#homepage-reads-and-protected-receipt-parity--14-october-2026).
- [Demo parity and cached calendar implementation — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#demo-parity-and-cached-calendar-implementation--14-october-2026).
- [Customer-path constraint and readiness — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#customer-path-constraint-and-readiness--14-october-2026).
- [Current checkout experiment direction — 14 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-checkout-experiment-direction--14-october-2026).
- [Separate invoice due time, checkout rendering and link authorization — 14 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#separate-invoice-due-time-checkout-rendering-and-link-authorization--14-october2026).
- [Current checkout reliability boundary — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-checkout-reliability-boundary--13-october-2026).
- [Native diagnostic grant support remains bounded — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#native-diagnostic-grant-support-remains-bounded--13-october-2026).
- [Interpret the native error before repairing — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#interpret-the-native-error-before-repairing--13-october-2026).
- [Checkout reachability is an outstanding acceptance gate — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#checkout-reachability-is-an-outstanding-acceptance-gate--13-october-2026).
- [Payment preparation retains a separate submission gate — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#payment-preparation-retains-a-separate-submission-gate--13-october-2026).
- [Owner payment is the next diagnostic boundary — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#owner-payment-is-the-next-diagnostic-boundary--13-october-2026).
- [Read-only ingress evidence — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#read-only-ingress-evidence--13-october-2026).
- [Current developer acceptance state — 13 October 2026, 12:14 Singapore](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-developer-acceptance-state--13-october-2026-1214-singapore).
- [Paired diagnostic channels retain independent authority — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#paired-diagnostic-channels-retain-independent-authority--13-october-2026).
- [Verify event prerequisites before delivery acceptance — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#verify-event-prerequisites-before-delivery-acceptance--13-october-2026).
- [Separate accepted checkout/cleanup from failed signed-delivery observation — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#separate-accepted-checkoutcleanup-from-failed-signed-delivery-observation--13-october-2026).
- [DELETE acknowledgement is separate from restoration proof — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#delete-acknowledgement-is-separate-from-restoration-proof--13-october-2026).
- [Active webhook baseline reconciled — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#active-webhook-baseline-reconciled--13-october-2026).
- [Cleanup response boundary reached; access closed — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#cleanup-response-boundary-reached-access-closed--13-october-2026).
- [Subscription flag repair prepared — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#subscription-flag-repair-prepared--13-october-2026).
- [Current webhook diagnostic result — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-webhook-diagnostic-result--13-october-2026).
- [Webhook flight stopped; access closed, subscription unresolved — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#webhook-flight-stopped-access-closed-subscription-unresolved--13-october-2026).
- [Approved technical payment/webhook campaign — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#approved-technical-paymentwebhook-campaign--13-october-2026).
- [Payment and callback boundaries — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#payment-and-callback-boundaries--13-october-2026).
- [Developer native booking accepted and independently closed — 13 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#developer-native-booking-accepted-and-independently-closed--13-october-2026).
- [Owner roster and instructor priority — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#owner-roster-and-instructor-priority--12-october-2026).
- [Approved setup inspection completed and closed — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#approved-setup-inspection-completed-and-closed--12-october-2026).
- [Full native acceptance execution resumed — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#full-native-acceptance-execution-resumed--12-october2026).
- [Native campaign stopped on actual date availability — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#native-campaign-stopped-on-actual-date-availability--12-october2026).
- [Actual calendar discovery before the final native gate — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#actual-calendar-discovery-before-the-final-native-gate--12-october2026).
- [Native single proof accepted and closed — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#native-single-proof-accepted-and-closed--12-october2026).
- [Availability-only stop and actual-attempt accounting — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#availability-only-stop-and-actual-attempt-accounting--12-october2026).
- [Same-date closure/readback authority verified — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#same-date-closurereadback-authority-verified--12-october2026).
- [Separate allocation and batch closure evidence — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#separate-allocation-and-batch-closure-evidence--12-october2026).
- [Acceptance-driven native continuation — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#acceptance-driven-native-continuation--12-october2026).
- [Second-response collection boundary observed — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#second-response-collection-boundary-observed--12-october2026).
- [Owner-approved live-test limits — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#owner-approved-live-test-limits--12-october2026).
- [Batch association from retained creation identity — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#batch-association-from-retained-creation-identity--12-october2026).
- [Follow-up evidence and accepted boundary — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#follow-up-evidence-and-accepted-boundary--12-october2026).
- [Next finite experiment prepared — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#next-finite-experiment-prepared--12-october2026).
- [Latest creation evidence and correction boundary — 12 October2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#latest-creation-evidence-and-correction-boundary--12-october2026).
- [Creation-contract comparison and next proof boundary — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#creation-contract-comparison-and-next-proof-boundary--12-october-2026).
- [Current provider read evidence — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-provider-read-evidence--12-october-2026).
- [Existing-record inspection boundary — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#existing-record-inspection-boundary--12-october-2026).
- [Specific native diagnostics and closed192 proof — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#specific-native-diagnostics-and-closed192-proof--12-october-2026).
- [Approved192 continuation preparation — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#approved192-continuation-preparation--12-october-2026).
- [Cart allocation and invoice finalization are separate — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#cart-allocation-and-invoice-finalization-are-separate--12-october-2026).
- [Existing-residual operator recovery — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#existing-residual-operator-recovery--12-october-2026).
- [Identity freshness between forward reads — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#identity-freshness-between-forward-reads--12-october-2026).
- [Binding lifecycle evidence — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#binding-lifecycle-evidence--12-october-2026).
- [Coordinator readiness and admission diagnostics — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#coordinator-readiness-and-admission-diagnostics--12-october-2026).
- [Explicit developer budget continuation — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#explicit-developer-budget-continuation--12-october-2026).
- [Private native prerequisite evidence — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#private-native-prerequisite-evidence--12-october-2026).
- [Native amendment executed and closed — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#native-amendment-executed-and-closed--12-october-2026).
- [Native proof preflight status — 12 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#native-proof-preflight-status--12-october-2026).
- [11 October — native recovery and compensation source](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#11-october--native-recovery-and-compensation-source).
- [11 October — protected native customer flow](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#11-october--protected-native-customer-flow).
- [11 October — native checkout implementation and owner configuration confirmation](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#11-october--native-checkout-implementation-and-owner-configuration-confirmation).
- [Metadata discovery accepted and closed — 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#metadata-discovery-accepted-and-closed--11-october-2026).
- [Combined acceptance direction — 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#combined-acceptance-direction--11-october-2026).
- [Native completion source increment — 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#native-completion-source-increment--11-october-2026).
- [Native-first execution direction — 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#native-first-execution-direction--11-october-2026).
- [Current M3.6 decision — website-confirmed contact, 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-m36-decision--website-confirmed-contact-11-october-2026).
- [Governing North Star execution checkpoint — 11 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#governing-north-star-execution-checkpoint--11-october-2026).
- [Current accepted state — finite identity proof closed, 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-accepted-state--finite-identity-proof-closed-10-october-2026).
- [Finite remembered-identity proof preparation — 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#finite-remembered-identity-proof-preparation--10-october-2026).
- [Remembered identity source checkpoint — 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#remembered-identity-source-checkpoint--10-october-2026).
- [Historical A3 quick rebooking and remembered-device decision — 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#historical-a3-quick-rebooking-and-remembered-device-decision--10-october-2026).
- [Developer email acceptance checkpoint — 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#developer-email-acceptance-checkpoint--10-october-2026).
- [Unused email window replacement — 10 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#unused-email-window-replacement--10-october-2026).
- [Governing main integration continuation — 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#governing-main-integration-continuation--9-october-2026).
- [Live-email candidate preparation — 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#live-email-candidate-preparation--9-october-2026).
- [M3.2 exception — 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m32-exception--9-october-2026).
- [Development foundation exception — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#development-foundation-exception--8-october-2026).
- [Authority and current scope](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#authority-and-current-scope).
- [Current accepted developer evidence and reliability boundary — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-accepted-developer-evidence-and-reliability-boundary--8-october-2026).
- [Historical work boundary and standing source rules — 7 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#historical-work-boundary-and-standing-source-rules--7-october-2026).
- [Current product rules — latest quotation](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-product-rules--latest-quotation).
- [Target stack and ownership](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#target-stack-and-ownership).
- [Source ownership](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#source-ownership).
- [Booking invariants](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#booking-invariants).
- [Booking oracle and instructor preview — 4 October follow-up](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#booking-oracle-and-instructor-preview--4-october-follow-up).
- [Central colour and typography contract — 5 October](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#central-colour-and-typography-contract--5-october).
- [Low-latency booking architecture and acceptance plan — 5 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#low-latency-booking-architecture-and-acceptance-plan--5-october-2026).
- [B1 provider evidence register — 6 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#b1-provider-evidence-register--6-october-2026).
- [Development process — latest OneFitfinity adaptation](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#development-process--latest-onefitfinity-adaptation).
- [Development accounts and client cutover](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#development-accounts-and-client-cutover).
- [Architecture picture and component costs](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#architecture-picture-and-component-costs).
- [Guarded local delivery — retained for transition and optional use](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#guarded-local-delivery--retained-for-transition-and-optional-use).
- [Presentation fidelity and early tooling baseline](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#presentation-fidelity-and-early-tooling-baseline).
- [GitHub demo release contract](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#github-demo-release-contract).
- [Current acceptance and transition gate](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-acceptance-and-transition-gate).
- [Bounded planning delivery and identity safeguards](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#bounded-planning-delivery-and-identity-safeguards).
- [M1–M9 iteration plan — 4 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m1m9-iteration-plan--4-october-2026).
- [M1 — Foundation closure and delivery safeguards](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m1--foundation-closure-and-delivery-safeguards).
- [Current M2 acceptance — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#current-m2-acceptance--8-october-2026).
- [M2 — Provider feasibility and account configuration](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m2--provider-feasibility-and-account-configuration).
- [M3 — Server foundation and customer identity](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m3--server-foundation-and-customer-identity).
- [M4 — Live availability and reliable booking creation](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m4--live-availability-and-reliable-booking-creation).
- [M5 — Hosted payment and authoritative confirmation](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m5--hosted-payment-and-authoritative-confirmation).
- [M6 — Complete the customer flow and release preparation](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m6--complete-the-customer-flow-and-release-preparation).
- [M7 — Client testing and acceptance](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m7--client-testing-and-acceptance).
- [M8 — Production deployment and handover](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m8--production-deployment-and-handover).
- [M9 — Post deployment support and maintenance](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#m9--post-deployment-support-and-maintenance).
- [Planning scope coverage and support boundaries](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#planning-scope-coverage-and-support-boundaries).
- [Developer evidence campaign invariants — 8 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#developer-evidence-campaign-invariants--8-october-2026).
- [Experiment 1 — separate checkout scope exception, 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#experiment-1--separate-checkout-scope-exception-9-october-2026).
- [Combined developer release packet — 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#combined-developer-release-packet--9-october-2026).
- [Native adapter preparation boundary — 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#native-adapter-preparation-boundary--9-october-2026).
- [Dynamic-data findings — current, 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#dynamic-data-findings--current-9-october-2026).
- [Native discovery release boundary — current, 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#native-discovery-release-boundary--current-9-october-2026).
- [Main integration composition checkpoint — 9 October 2026](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#main-integration-composition-checkpoint--9-october-2026).
- [Resend source preparation — 9 October continuation](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/f0f000c2f600be1930cacf0b2f884103cb23fba7/docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md#resend-source-preparation--9-october-continuation).

</details>
