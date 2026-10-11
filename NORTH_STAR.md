# North Star: dependable customer booking and quick rebooking

## Governing objective — 11 October 2026

Deliver the complete quoted A1–A7 customer journey: new and returning customers select valid SoccerBot sessions, safely reuse verified contact details, pay through SimplyBook → SBPay → HitPay, and receive authoritative protected confirmation, including recovery when requests fail, payment is delayed or the browser never returns. Completion includes client-configured UAT, written acceptance, reviewed production activation and operating handover.

YS approved execution of this overarching plan on11October. Source, public research, focused non-browser checks, canonical documentation and feature-branch/draft-PR work proceed within the carried campaign. Live operations require their concrete finite packets; prior closed grants do not reopen. YS reprioritized native booking followed by payment reconciliation/webhooks. Execute supported source and preparation now; the immediate source change adopts one native studio allocation and rejects unexpected overlapping providers; optional group size belongs in the native booking Comments section; remaining account contracts determine the next finite live packet. Native booking stays unavailable until its actual mappings are established.

## Verified baseline

PR19 is merged at `298c9c8f443063f8b21a2e7b006993a1ec76a9e7`. [Main CI38112617043](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/38112617043) passed frontend/backend/live-email and published the Pages demo. PR-head c2f2506 independently passed CI38049449145. Main publication does not redeploy the Worker.

The last verified developer Worker is source4a10133/version6c2730a6-9591-4c06-8830-803cb6d30790, identity/provider disabled/end0; no fresh Cloudflare inspection is claimed on11October. Applied0001–0014 are immutable. All three identity windows explicitly closed. Owner acceptance passed opt-out/access-only, supersession, remembered issuance, restart/two tabs, phone independence, fresh all-device sign-out and final closure. Replay and real short-session restoration remain open. Developer infrastructure/source tests do not imply provider or production acceptance.

The recorded quotation originally specified verified SimplyBook name/phone prefill. On11October YS explicitly replaced that engineering design with the latest contact details confirmed on this website: one shared profile per verified email, saving on Details submission only with Remember me selected, editable prefill and unchanged booking history. Optional safe unique SimplyBook import is deferred and does not block this feature. The recorded source hash remains in Rules; no fresh PDF validation or signed commercial amendment is claimed. The separate opt-in90-day absolute remembered policy remains unchanged. Identity alone does not complete A3.

## Product boundaries

One Singapore venue/shared studio, one concurrent session,40-minute play with10-minute changeover,1–4 players and multiple same/different-date sessions. Dates/times determine eligible instructors. Preserve the approved current roster and ID-bound assignment policy. A selection is not a reservation; trusted price, eligibility and capacity are rechecked at the write boundary. YS confirms provider schedules never overlap. Treat multiple eligible providers as configuration drift and stop; current50-minute occupancy and native competition evidence remain required. Historical cross-instructor resource-allocation proof stays deferred, not passed.

SimplyBook owns customer/scheduling/bookings and the native payment route owns payment authority. D1 stores minimal identity, immutable attempt/effect and recovery state, not a replacement provider database. Booking contact correction is not provider-profile mutation. Unknown writes reconcile under the original attempt; partial cleanup touches only newly created confirmed-unpaid bookings. Cancellation is not refund; native authorized staff handle refunds.

Keep custom staff AI/PWA/portal, memberships/packages/podcasts, recurring charging, payroll, historical migration and replacement booking database outside scope. Session Replay remains off. Demo enquiry/exports do not establish production delivery.

## Dependency-ordered milestones

Stable M1–M9 and all44 subiteration IDs remain in Rules. Existing source exceptions do not silently close their formal prerequisites.

| Milestone | Outcome / remaining work                                                                                              | Exit gate                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| M1.1–M1.4 | Baseline, release protection, tooling/advisories and approved visual baseline                                         | Source/release-control evidence and named desktop/phone/tablet acceptance                                    |
| M2.1–M2.5 | Account/merchant entitlement; customer/player/quote/timetable mappings; native scheduling/payment/recovery operations | Supported contracts, observed mappings, bounded costs and explicit blockers per capability                   |
| M3.1–M3.6 | Preserve foundation and async/durable owners; finish identity evidence; implement authorized contact prefill          | Correct remembered/fresh prefill, safe absent/ambiguous/error results, expiry/revocation and guest isolation |
| M4.1–M4.6 | Authoritative availability, latest-cart validation, one durable attempt, all-session creation and recovery            | No duplicate effects/overselling; incomplete or uncertain bookings never expose payment                      |
| M5.1–M5.5 | Exact invoice association, native checkout, authoritative payment evidence and protected confirmation                 | Required success/pending/failed/expired/late/unknown/no-return scenarios pass                                |
| M6.1–M6.6 | Final exports/content/native emails, client rehearsal, pipeline, monitoring and release audit                         | Complete client-configured candidate, recoverable operations and A1–A7 UAT package                           |
| M7.1–M7.4 | Full client/device UAT, defect closure and written acceptance                                                         | Final candidate/account/device receipts and no failed required case                                          |
| M8.1–M8.4 | Approved production readiness, exact-artifact deployment, live checks and handover                                    | Actual production evidence, operating guide, access/source/configuration and training                        |
| M9.1–M9.4 | Stabilization, six-month warranty, optional elected maintenance and eventual exit                                     | Verified repairs, explicit support/access dates and current operational records                              |

Critical path: completed M3 identity/website contact profile plus supported M2 booking contracts → M4 booking/recovery → M5 payment/confirmation → M6 client release → M7 written acceptance → M8 launch. Independent source/contract preparation may continue while external evidence is blocked, within one-agent scope. Unsupported multi-session finalization or customer binding requires a documented decision before dependent live implementation.

## Execution order — native booking through launch

| Order / stable milestone | Work and owner                                                                                                                                                                                                                                                                        | Required evidence before advancing                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / M2.1–M2.5            | Resolve native contract/configuration: one-studio allocation, tax-inclusive quote, exact customer association, instructor priority IDs and one shared studio. Existing field-discovery/provider transport own reads. Research native notification and batch contracts alongside this. | Sanitized account-specific mappings and supported DTOs; missing values remain blocked. Native count stays1; prepare optional native booking comments and verify non-overlapping provider schedules.                                                                         |
| 2 / M4.1–M4.4            | Complete one native session through existing prebooking, orchestration and native adapter; wire protected customer operations only after server checks exist. Preserve date-first assignment, 1–4 players, 40+10 occupancy, immutable intent and one durable effect.                  | Current quote and capacity checks at commit; preserved website group size and correct native count1/customer/session; rejected stale/foreign/duplicate requests; unknown write reconciles under original attempt without replacement. No payment on incomplete association. |
| 3 / M5.1–M5.4            | Bind native invoice and checkout to the exact accepted booking/account/amount/currency; use SimplyBook → SBPay → HitPay. Existing native adapter, protected checkout and canonical confirmation remain owners.                                                                        | One approved sandbox booking/payment reaches authoritative protected confirmation; pending/failed/expired/late/unknown states remain truthful. Reuse historical Card evidence without relabelling it current.                                                               |
| 4 / M5.1–M5.5            | Integrate the actual supported notification mechanism with bounded independent reconciliation. Research starts at order1; activation follows exact event/signing/account mapping.                                                                                                     | Signature/tamper/replay/duplicate/out-of-order tests; notification only prompts authoritative readback. Close payment browser and prove confirmation without return or callback. Lost events cannot cause a second charge or booking.                                       |
| 5 / M4.4–M4.6            | Complete multi-session native finalization and recovery in existing orchestration. Single-session proof is an intermediate checkpoint, not reduced product scope.                                                                                                                     | All selected sessions accepted before payment, exact invoice arrangement, safe partial failure and unknown finalization. Unsupported batch replay/recovery blocks release; no fabricated atomicity or refund.                                                               |
| 6 / M3.4–M3.6, M6        | Finish identity/contact live evidence, native booking notifications, protected PDF/calendar/export, final content/accessibility and operational diagnostics.                                                                                                                          | Remember opt-out/submit-save, replay, real idle restore, shared profile and closure; actual booking emails/export; bounded recovery and monitored errors. Identity successor policy remains separate from provider discovery.                                               |
| 7 / M1, M6–M7            | Revalidate the client account's mappings/entitlements and execute complete A1–A7 UAT on desktop, phone and tablet.                                                                                                                                                                    | All required performance/security/device/recovery cases pass, defects closed, exact client artifact and written acceptance. No credential-only cutover.                                                                                                                     |
| 8 / M8–M9                | Reviewed production release, finite live checks, handover and stabilization; provide the two quoted60-minute sessions, source/configuration/access records, refund guidance and support dates.                                                                                        | Exact-artifact activation and closure/rollback readiness, launch sign-off, six-month warranty and optional elected maintenance.                                                                                                                                             |

Source checkpoint: PR20 headf881510 passed CI38116387515 frontend/backend/live-email, including browser and release-package gates. Contact changes are implemented but unmerged/undeployed. The new allocation-policy source requires its own final CI; prior sealed artifact bytes remain historical evidence. The mutable current task, bounds and receipts stay in PROGRESS; Service Contracts owns the current allocation/information contract and remaining native gaps.

Native completion means a customer can select an eligible slot, submit reviewed details, obtain the correct provider booking/invoice, pay natively and see verified confirmation even without returning. Complete North Star acceptance additionally requires multi-session behavior, identity/profile evidence, client UAT, launch and support handover. No promise that unsupported provider contracts can be completed within one session.

## Verification and operations

Each increment declares outcome, scope, dependencies, owners/contracts/data, tests, user-device checks, recovery and exact completion evidence. Keep source implementation, selected tests, PR CI, independent main CI, deployment, provider and physical-device acceptance distinct. Assistant executes no browsers; user/CI own browser work. Retain failures and fix the owning cause without weakened tests, retries, hidden fallback or changed acceptance.

The existing P01–P12 register in Rules remains the measurement owner. Freeze provider-dependent latency/cart/query/TTL/quota budgets through M2.5. Separate provider settlement/visibility from application processing; preserve cold/warm/device cohorts and low-sample limits. Zero duplicate effects, overselling, false paid confirmation or unrelated disclosure are hard required-test gates. No provider load test or paid infrastructure is inferred from synthetic concurrency.

Deployment consumes exact verified environment artifacts; schema evolution is deliberately compatible. Code rollback does not restore data backwards, cancel provider effects or refund money. Rehearse bounded containment, unresolved-attempt recovery, redacted correlation and actual alert delivery before launch. Client mappings, entitlements and UAT must be revalidated; changing credentials alone is not cutover.

## Planning windows and decision points

Dates preserve the recorded quotation schedule and do not amend commercial terms. Provider feasibility is the critical schedule dependency; the earlier M2 target was missed and is re-estimated from evidence, never silently marked complete.

| Singapore planning window | Intended outcome                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| 11–16October              | Reconciled baseline, remaining identity preparation/proof and supported provider/customer contracts |
| 19–23October              | Authoritative booking and recovery                                                                  |
| 26–30October              | Native payment and protected confirmation                                                           |
| 2–6November               | Client rehearsal, exports/notifications, monitoring and release preparation                         |
| 10–16November             | Client UAT and affected defect closure                                                              |
| 17–22November             | Approved launch/training/handover                                                                   |
| After launch              | Stabilization and quoted support lifecycle                                                          |

Provider unsupported operations, unsafe identity matching, capacity uncertainty, absent merchant readiness or missing client inputs trigger an explicit dependency/schedule decision. They do not justify guessing mappings, substituting independent checkout or weakening correctness. Reconcile operating costs against actual entitlements before launch. The quotation's cost allowance is a planning estimate, not a certified cap.

## Authority and completion

One agent; existing24 aggregate active hours/72 elapsed hours/60 loops/6 repairs per cause continue from9October08:18:56UTC to12October16:18:56SGT. User waiting is not active work; unknown prior intervals stay unknown. This plan does not restart the clock. Current usage and unspent safety reserves remain in PROGRESS.

Feature work uses reviewed branches/PRs. Every merge and live operation retains its own authorization; no main push, production activation, paid upgrade, real payment/refund, secret installation or message to providers is implied by this preparation package. No database reset or historical-window reopening. Source policy for any successor identity proof must be explicitly reviewed before an executable packet exists.

Completion requires A1–A7 on the client configuration, all required automated/provider/device/UAT evidence, written acceptance, identified production release and operating handover. Include both quoted60-minute in-person setup/handover sessions across M2–M8, source/configuration/access/test records, native refund guidance and confirmed warranty dates. Six-month warranty and optional maintenance follow the quotation; no extra SLA or automatic renewal is created.

Exactly three canonical owners: Rules and Architecture (invariants/roadmap/accepted state), Service Contracts (operations/authority/errors/recovery/availability), Journey (dated decisions/failures/evidence). PROGRESS is the current ledger. Deferred CLOUD-01 below stays separate from customer/provider acceptance.

## Deferred CLOUD-01 — incomplete

### Deferred outcome

- Evaluate reproducible SoccerBotStudioSG development in a fresh Codex Cloud task on an experimental feature branch, with reviewed source, strict validation and a usable preview.
- Start from main `0cea68168738c722d05be9d3580938b65a4860c7`, which contains the inspected Mac source and naming PR #5. This was the original experiment base; YS subsequently merged PR #6 at `37c220a33caa85f875baaf98726205cec7b9d495`. Preserve that history without implying preview acceptance.
- End at a reviewable PR and recorded setup evidence. Merging and application deployment remain separate decisions. Feature-branch/PR publication is part of the authorized handoff.

### Scope

- Concise `AGENTS.md`, cloud operating guide and compact progress/task ledger.
- Preserve the reconciled source and latest main changes. The previous unauthorized PR #4 merge is recorded in Journey; source identity and passing CI do not imply merge authorization.
- Preserve measured SimplyBook findings in the experimental documentation without claiming live-adapter acceptance.
- Configure and verify the cloud environment using existing repository commands.
- Preserve application behaviour, test strength and canonical ownership.

### Acceptance

- [x] Inspected Mac source is preserved in main; merged naming PR #5 is included. The prior merge-authorization failure is recorded without relabelling it as approval.
- Historical branch-isolation gate was superseded by YS merging PR #6. New work uses a new feature PR; the actual Mac checkout is not changed by this task.
- [ ] A fresh cloud task reads the current instructions and records its repository, branch, HEAD and runtime versions.
- [ ] Dependencies install from the committed lockfile; relevant frontend checks and Playwright run against a fresh internal preview.
- [ ] Provider discovery findings and remaining M2 gates are preserved; no client booking/payment writes or live-adapter acceptance are implied.
- [ ] Full required GitHub Actions checks pass for the final PR candidate; all three Chromium/WebKit projects and strict result inventories remain intact.
- [ ] A usable user preview is demonstrated, with the exact revision and demo/API mode stated. If unavailable, this criterion remains blocked.
- [ ] The PR includes verification evidence and remaining human/device/provider boundaries; no merge or deployment occurs in the development loop.

### Exclusions

- CLOUD-01 scope excludes business features, client production rollout, provider configuration changes, deployment activation, database migrations and real bookings/payments. The separately authorized application trial above and M2 planning are exceptions to that original experiment scope; neither completes Cloud preview or provider acceptance.
- No new CI preview deployment, always-running agent, scheduler, paid service, custom MCP server or code graph in this milestone.
- Existing hosted Pages is the merged-main demo; it must not be represented as a PR preview.

### CLOUD-01 run policy

- One ready ledger task per run; stop at its acceptance or a concrete blocker.
- No unattended relaunches are configured. A future orchestrator needs an explicit run/time/spend limit and stop condition before activation.
- Run focused checks while changing code; consume existing full-CI results for the final candidate rather than repeatedly duplicating that suite.
- Do not enlarge scope or edit acceptance criteria to make the milestone appear complete. Ask the user for a changed outcome when needed.

### Owners

- Tasks, blockers and evidence: `PROGRESS.md`.
- Engineering authority: `docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md`; concise entry instructions: `AGENTS.md`.
- Setup and verification commands: `docs/CODEX_CLOUD.md`.
- After acceptance, replace this bounded milestone with the next user-approved outcome; retain the completed receipt in Journey.

Source adaptation: OneFitfinity PR #8 at `16eea945f9324b6f20610d0a0b98b1a1cb6014e9`, `docs/codex-cloud-workflow-2026-10-06`, refreshed after its main `7970f65b5975a6554c46eb521c7ca118939e4bb9`. The structure and bounded run policy are retained; SoccerBot acceptance replaces Fitfinity backend/AWS gates.
