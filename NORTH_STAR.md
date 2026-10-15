# North Star: dependable customer booking and quick rebooking

## Review booking owner-test repair — 15 October 2026

Restore the observed Details → holding → Review transition and unavailable-selection calendar return before another owner trial. PR31 is merged/deployed; direct HitPay sandbox flags were separately activated. Current frontend repair requires exact-source CI, specific merge approval and deployment/readback. Continue to payment still uses the existing hold without a slot-availability query. Provider payment/finalisation/no-return recovery and physical acceptance remain pending.

## Direct hosted HitPay source checkpoint — 15 October 2026

Finish final non-browser verification and source review of the disabled direct HitPay integration, then publish the feature PR and obtain exact-source CI evidence. Customer flow is calendar → Details/fresh check → disclaimer → hosted HitPay → protected confirmation; retain details on unavailable selections. Independent payment, invoice and all-booking evidence remains mandatory. Next external stage requires a concrete sandbox deployment/configuration and owner-operated test packet; no provider or physical acceptance is claimed.

Latest owner clarification: Review booking after Details creates the SimplyBook holding appointment and invoice. Continue to payment uses that existing hold, with no further slot availability query or booking recreation. Backend holding/payment separation and frontend held-state restoration/consent handling are implemented; non-browser verification passed (177 frontend unit tests and333 Worker tests); exact-source CI remains pending.

## Pending implementation completed; deployment gate — 14 October 2026

Anonymous entry prefetch and shared protected confirmation/export implementation are now present. Display cache is non-authoritative; continuation and dispatch checks remain. Deliver the exact CI-tested live interface and Worker to the developer target with provider/delivery access closed. A real browser must still prove hidden SimplyBook initialization and native checkout reachability; fixtures and iframe load events cannot establish that outcome.

## Current North Star: demo parity with truthful live availability — 14 October 2026

The customer uses the same approved demo layout, step order, session card, player control, month calendar, basket, details, review and payment summary. Live records replace demo data; Turnstile, verified identity, protected access and honest provider status remain. Customers never visit SimplyBook's homepage as a visible extra step. Trainer priority is withdrawn: schedules should not overlap, and overlapping live eligibility remains a configuration error.

### Delivery order and acceptance

1. **M5.2 experimental preparation:** one hidden, fixed-origin SimplyBook homepage frame during an authorized live booking session, retained across booking steps. No checkout-token preload, navigation interception, polling/retry, cookie copying or fake readiness. Frame load is not evidence of usable provider authorization. Its effectiveness is accepted only by an owner-run fresh-browser checkout test.
2. **M4.1/M4.2 calendar and continuation:** prefetch up to four months during authorized session selection through a same-origin range contract: visible month first, then three background months. Fetch provider start-time matrices in bounded ranges, never one provider call per calendar cell. Keep a 60-second, eight-month-entry account/environment/source-scoped display cache. A month has at most31 days; verified empty dates, out-of-scope/unknown dates, loading and failure are distinct. Only verified available dates are selectable, past dates remain disabled, and the next-available action selects a known bookable date. Display cache never reserves capacity. Recheck selected sessions when continuing and preserve fresh server checks at payment/dispatch. On a failed fresh check preserve the basket, invalidate the affected shared month and refresh the calendar; failed reads mean unknown, not sold out.
3. **M3.2/M6 interface parity first:** use shared demo presentation owners with real live labels/prices; retain approved security additions. No developer labels, catalogue-only replacement screen, demo instructor rotations in live mode, pretend paid status, or demo payment methods asserted as available. Hosted payment itself remains provider-owned. Protected confirmation may show only verified returned fields; missing provider fields remain an explicit acceptance gap, not invented content.
4. **M5/M6 fuller flight:** after exact-source checks/CI and a separately bounded live window, exercise guest/member, pax/date selection, changed availability, native checkout, owner sandbox payment, independent receipt, callbacks and protected confirmation. Interface/code acceptance can complete even if provider/browser/payment/webhook acceptance is blocked. Report each separately.

### Boundaries and evidence

Keep existing dates/instructor constraints, single studio, 40-minute sessions at50-minute starts,1–4 players, immutable attempt identity, no-write retries, no real charge and no production changes. Calendar range support does not grant live access or widen an existing installed scope: unknown/unapproved dates remain unselectable. Prefetch starts as soon as authorized booking context and a valid service exist; public anonymous homepage prefetch must not bypass account admission. Refresh current entitlements and eligible test dates before a live flight.

Validation: meaningful range/cache/scope/freshness/race tests; calendar unavailable/loading/error states; unchanged demo assertions; security and write-boundary regressions; full non-browser verification where the pinned toolchain is available. User/CI own browser and physical-device execution. Existing quotation and milestone identities remain unchanged. Rules & Architecture owns invariants, Service Contracts owns request/cache/authority semantics, Journey owns evidence; this North Star is the concise execution index.

Current state: owner authorized local implementation and verification; source base matches remote draftPR22 head b2862e0. No publication, deployment, new live budget, provider call or payment is implied. Background-frame feasibility and actual browser parity remain unaccepted until observed.

## Next proof isolates initial native navigation — 13 October 2026

Prepare the owner-approved checkout-opening diagnostic with browser request evidence captured before navigation and no payment submission. Homepage/payment-feature checks passed but the initial404 cause remains unproven. Budget-schema support and exact artifact/executor validation are preparation prerequisites; a new finite flight requires concrete amended limits. Payment/webhook acceptance follows only after reachable native checkout is demonstrated.

## Immediate prerequisite: reachable native checkout — 13 October 2026

The first owner payment flight stopped when the native checkout for booking40/invoice31 returned404 immediately on opening, before payment selection. Native creation/association remain evidenced; payment and the proposed post-payment callback comparison remain untested. Prioritize establishing the correct supported native payment-link contract, then prepare a fresh bounded payment test. The consumed flight is independently closed. Service Contracts and Journey retain evidence and constraints.

## Current priority: native payment, then webhook confirmation — 13 October 2026

Native booking creation and exact invoice association are accepted within the developer integration scope. The paired unpaid control completed and closed with no recorded callback arrivals. YS now requests an owner-operated payment test and suggests payment completion may trigger delivery. Prepare one sandbox native checkout with both event subscriptions present; prove paid state through the existing authoritative readback owner and assess callback timing separately. Current sandbox/merchant evidence is required before sealing execution. Service Contracts owns the staged test; Journey retains the negative control and authorization change. General browser/device, no-return automation, semantic webhook mapping and client-production acceptance remain later gates.

## Next bounded proof: invoice versus booking delivery — 13 October 2026

Prepare separate finite capture channels for new_booking and new_invoice around one new priced checkout. This comparison addresses the unproven pre-payment event expectation; route labels remain diagnostic, never payment or booking association authority. Obtain exact-source CI and the tested artifact, then seal the packet and its reverse cleanup. Current limits cannot fund deployment and closure; amend them concretely before execution. Retain owner-controlled payment/browser acceptance. Service Contracts and Journey own exact scope and evidence.

## Webhook investigation: verify the event prerequisite — 13 October 2026

No callback was recorded through 10:44:54 Singapore. The exact destination and active `new_booking` registration were verified before booking 38; current Cloudflare reads report Access not enabled and the public Worker address enabled. Older SimplyBook staff answers say priced API booking callbacks wait for payment, while invoice 29 remains unpaid. Current REST documentation does not establish whether that rule applies here. Service Contracts owns the sources, remaining uncertainty and next diagnostic; Journey records the investigation. Keep access closed at 516 provider calls; cumulative management 359, Worker 150, deployments 35. No replay, payment or owner acceptance.

## Live DELETE fix passed; signed delivery not observed — 13 October 2026

Packet7ec56094976f created confirmed booking38 and exact unpaid invoice29, SGD88, with Nabil on15October15:40 Singapore. The checkout link remains unopened. The authenticated webhook receipt check returned zero rows, so forward work stopped. Cleanup then passed: HTTP200 with a non-JSON content type/body present, followed by exact active-baseline restoration. Independent closure at10:26:51 Singapore verified source44c53fc/version9c555cf2-24ab-4aca-9483-aed345b0e87c, disabled/end0/active0,516/640 calls and all23 historical tables preserved. Carried management349, Worker150, deployments35. No cancellation or payment occurred. Service Contracts and Journey own exact evidence. Next diagnose delivery versus rejection without replaying booking38; this packet is consumed and owner acceptance remains deferred.

## Active subscription baseline restored — 13 October 2026

Approved read-only packet1089bf8b452a returned an empty active-subscription array without repeating DELETE. The original empty active baseline is restored; this does not establish permanent deletion of inactive provider records or webhook delivery acceptance. Independent closure at09:53:37 Singapore verified source1e6bfbe/version84852bef-7346-40de-97df-220cccb9a029, disabled/end0/active0,471/640 calls and all23 historical tables preserved. Carried management310, Worker133, deployments32. The historical delete_unknown grant is unchanged. No booking, cancellation or payment occurred. This packet is consumed; further live work requires new finite authority. Service Contracts and Journey own the evidence and next step.

## Latest live result: DELETE unknown, test stopped — 13 October 2026

Approved packet10c62a001eea passed actual string-flag and unique subscription identity checks, then dispatched DELETE once and stopped on `provider_representation_unknown`. No new live booking/subscription test started. At09:36:09Singapore, independent closure verified source1e6bfbe/version43fc696a-7d40-4ded-8f58-9871003462dc, disabled/end0/active0,466/640 calls and23 preserved historical tables. Carried management293, Worker125, deployments30. Removal remains unproven; preserve delete_unknown and reconcile read-only before any further action. No DELETE replay, successor flight or owner acceptance. Service Contracts and Journey own the evidence.

## Current source repair — 13 October 2026

YS requested the subscription parser fix. Exact string"0"/"1" and numeric0/1 are now accepted; unknown flags remain rejected with private field codes. Identity/baseline/no-replay checks remain intact. This repair is source-only; the actual closed Worker remains27f03fc at460/640 and the original subscription remains unresolved. See Service Contracts for input/error semantics and Journey for regression evidence. No successor live flight is authorized.

## Latest result: subscription diagnostic closed — 13 October 2026

Approved packet46b93ebc17fa7 observed a string `is_active`, rejected by the numeric-only subscription validator. Its exact value and subscription identity remain unproven. Independent closure at07:39:36Singapore verified source27f03fc/version35894e44-9bfd-4142-9ff3-91686b87fd78, disabled/end0/active0,460/640 provider calls and23 preserved historical tables. Carried management263, Worker115, deployments27. The read succeeded; the original subscription remains unresolved. No successor live authority or owner acceptance. See the latest Service Contracts and Journey entries for exact evidence and repair boundaries.

## Webhook flight stopped; access closed, subscription unresolved — 13 October 2026

Packet `b918a81d06e991549f9d67e449098bf87e8109bc9ea6affc98d69d7773d06a99` executed once under the approved campaign on source `f2e0a3e91824f569a161f29447471d5081259719`. All three gates passed in CI38313369930; artifact11776470322/SHA256 `ed0207005a4ce1a38bc3f8c9302e05895be968d9afbeddf40a05d5725c3d1e14` matched150 sealed files and273 strict Worker tests. Migrations0022/0023 applied;0001–0023 are now immutable.

Subscription creation consumed7 provider calls through a returned fresh-list read, then failed post-create verification without establishing the subscription ID. The grant retained `create_unknown`; no booking proceeded. Pre-authorized cleanup consumed5 further calls, also failed after its list read before DELETE and retained `blocked`. The current error receipt does not identify the exact cause or field; do not guess a boolean/string/number alias or claim removal.

Independent access/preservation checks completed at **13 October06:15:13 Singapore**: sourcef2e0a3e/version `26f76ef1-e045-4e6f-98b1-b97ae0fe0165`, Worker/coordinator disabled, end0,455/640 provider calls, active0, recovery16 untouched, capture closed, schedules empty, new audit expired and both capabilities denied. All18 historical table snapshots and the applied schema (apart from the approved grant-ceiling change) are preserved; all23 migration records are verified. No new attempt, booking, checkout link, payment, cancellation, cron, email or siteverify call. Full closure is **not accepted** because the subscription's identity/removal remains unproven. The durable campaign state is `access-closed-effect-unresolved`; no successor flight may proceed under the unresolved-effects stop condition.

Actual flight cost12 provider/32 management/11 Worker/3 deployments; carried totals455 provider,240 management,105 Worker,24 deployments,4 attempts,7 conservative book dispatches,4 unopened links and3 cumulative migrations. Remaining numbers are not permission to bypass the stop condition. Next ready source task is a bounded read-only subscription structure diagnostic through the existing one-use operator and account admission owners, followed by an evidence-based parser/cleanup repair. Actual signed delivery, mapper and no-return reconciliation remain pending; owner-controlled acceptance has not started.

## Approved technical payment/webhook campaign — 13 October 2026

YS approved proposal `f26137bba0a4c4066024af27546d511b43050e3324b29e488dec84bb57a4ccd2` and separately extended only its time bounds: latest start **09:05**, final closure **09:30 Singapore on 13 October**. This supersedes earlier statements that no successor authority exists. Each flight still requires tested source, all three exact-source CI gates, verified artifact, a sealed execution/closure packet and independent closure. Campaign approval replaces separate packet confirmations only within this envelope.

Carry provider443, management208, Worker94, deployments21, attempts4, conservative book dispatches7, unopened links4 and migrations1. At most two flights,160 new provider calls (maximum603, configured ceiling640,16 recovery calls untouched),104 management,48 direct Worker,8 deployments,2 attempts,3 book dispatches,2 unopened links,2 new guests and2 additive migrations. Per flight:80 provider,52 management (12 closure reserve),24 Worker (8 closure reserve),4 deployments,20 minutes and at least5 minutes closure headroom. At most2 temporary new_booking subscriptions, deleting only those created here;32 distinct captured receipts in total,16 per window. One optional cron for at most3 minutes with one-use known-attempt readback. Provider deliveries/retries and native booking notifications are separately provider-controlled; no email/siteverify test.

Use Nabil3/service2 on15October at/after15:40 Singapore, fresh whole-session availability and ordinary48-hour lead. No date substitution or schedule edits. Stop a flight at its first failure or unknown outcome; only bounded closure may follow. No successor after unresolved effects. No owner payment/browser/device acceptance, checkout-link opening, charge/refund/cancellation, old-record mutation, replay, secret changes, merge or production work.

## Current focus: technical payment and webhook acceptance — 13 October 2026

Native booking creation/association/unopened handoff is accepted. YS now requests payment and webhook technical acceptance before owner-controlled testing. Finish authoritative payment reconciliation, authenticated provider delivery, durable deduplicated mapping to existing recovery, and bounded no-return/missing-callback fallback. Retain owner checkout/payment/browser/device acceptance as the following gate.

The first source increment repairs late-payment HTTP confirmation and prepares authenticated payload capture. It does not yet prove real provider notification delivery or payment settlement. Follow the current contract and acceptance gaps in Service Contracts; PROGRESS owns the next action and closed ledger.

## Developer native booking accepted and independently closed — 13 October 2026

Packet `217dfd4e4df2` executed once after YS approved the exact packet and amended resource limits. Source `8bd66c1` passed all three CI gates in run `38273011816`; artifact `11758121123` matched 148 sealed files, 257 Worker tests and all 21 immutable migrations. Fresh availability selected Nabil (instructor 3), service 2, **14 October 09:00 and 15 October 14:50 Singapore**. One new attempt `a8e47c99-9016-4db4-8d18-96b52675536c` completed batch 8, bookings 36/37 and exact invoice 28, SGD176 with zero tax. Both signed booking reads were confirmed; authoritative invoice readback was unpaid; the native checkout link remains unopened.

Independent closure at **13 October 2026 00:07:07 Singapore** verified source `8bd66c1` / version `d9fa3712-f536-43e8-b7ad-ad882fdd031f`, provider/identity disabled, end 0, 443/512 calls and active 0. The new guest was revoked, both new capabilities denied401, schedules remain empty, all 18 historical table snapshots and all 21 migration records are preserved. No schedule change, migration, payment, cancellation, retry, unknown request outcome or old-record change occurred.

The scoped developer native-booking checklist now passes: actual response contracts, single/same-date/different-date creation, exact association and protected confirmed/unpaid handoff, failure-boundary regression coverage and independent delivery/closure. Historical unknown effects and unsupported recovery remain unresolved and were not replayed. This does not establish paid, webhook, owner browser/device or client-production acceptance. The owner-selected 24-hour trial exception remains restricted to the installed developer contract, Nabil and 14/15 October; the ordinary 48-hour guard is unchanged.

**Next ready task:** prepare supported authenticated webhook ingress and authoritative known-invoice reconciliation for the retained combined payment/browser acceptance flight. Do not open a checkout link, register a subscription or dispatch another live operation under this consumed packet. The technical native creation/association/handoff gate is accepted; payment, supported notification delivery, owner device checks and client UAT remain separate. Keep historical unknown bookings and recovery explicitly unresolved. No merge or production rollout is authorized.

## Owner roster and instructor priority — 12 October 2026

For the next developer acceptance test, YS subsequently instructed **“just use 14/15”**: select one fresh eligible session on 14 October and one on 15 October, with Nabil (developer instructor 3), service 2 and no scheduled breaks. Exclude 18 October onward as requested; no 16–17 October opening or provider schedule mutation is planned. The proposed 16 October correction and related Friday-settings request are withdrawn. Only 15 October has live availability evidence so far; 14 October remains subject to a new fresh provider read.

The 48-hour limit is a conservative supervised-trial guard, not a provider-reported customer policy. YS selected 14/15 after the 48-hour conflict was explained; implement that instruction as a finite developer-contract exception, preserving a 24-hour minimum. The externally installed, source-bound native grant must explicitly carry `trialLeadTimeException: "owner-2026-10-14-15"`, service 2, exactly the approved dates, and a contract expiring before 14 October 00:00 Singapore. Availability, preparation and pre-write review only shorten the guard for matching account/environment/company, service 2, instructor 3 and those dates while the contract is valid. Preparation must contain exactly one session on each date. Customer DTOs cannot supply the exception; absent, malformed, expired, foreign or widened authority retains the default 48-hour guard or rejects. Recheck lead time after provider reads. All current eligibility, price, capacity, freshness, money, association and no-replay checks remain. This source change grants no live window, changes no provider schedule and does not claim 14 October availability.

Live state remains independently closed at 387/512 calls, active 0, source `3af1323` / version `bd48335e-de9b-4b11-b0ba-b6ed5267f2f5`; all prior inspection authority is consumed. Single and same-date acceptance remain passed. This update records owner priority, withdraws the 16 October proposal and implements only the date-scoped developer lead-time exception. General multi-instructor priority assignment and provider schedule configuration are not deployed by this change.

## Approved setup inspection completed and closed — 12 October 2026

Packet `87a458a946d513e8e466dcf52f1f0cc9888d7bdf313cd1c0b347224bec94f87e` consumed the explicitly approved read-only scope on source `3af1323eda250b29f2bd95e2583d5dc49cbe161b`. Company, service 2, instructor 3 and combined working-hour reads all returned 15 October 09:00–21:00 Singapore and an empty interval list for 16 October. The active REST webhook subscription list returned an empty array. These are actual developer-account observations; they do not distinguish weekly rules from date exceptions, establish other dates, establish legacy callback configuration or prove a settlement event.

Single and same-date booking integration remain accepted; different-date booking remains blocked by actual working hours. Next prepare a narrowly scoped, date-specific developer schedule correction with the exact prior state and affected company/service/instructor scopes established, then fresh availability and one different-date booking proof. Do not infer four independent schedule defects from four effective empty results or modify recurring hours broadly. Webhook work separately requires supported callback payload and secret mapping, durable authenticated ingress and authoritative known-invoice reconciliation before registration; an empty active REST list alone is not webhook acceptance. Owner payment/browser/device acceptance stays deferred until technical integration is complete. Access remains closed; further live mutations need a concrete newly authorized packet.

## Full native acceptance execution resumed — 12 October2026

YS instructed “execute it now” against the consolidated full native acceptance draft. Continue technical implementation, evidence-backed discovery preparation, tests and PR21 publication. The prior20:30Singapore live deadline has passed; its ledger is closed at378/512,153 management,68 Worker requests and15/16 deployments. The new instruction does not specify replacement numeric/time limits. Prepare a concrete new finite packet before seeking the required extension; do not reopen old grants, reset counters or perform payment/browser/production work.

Full native acceptance retains two sign-offs: complete single/same-date/different-date booking and protected exact-invoice handoff first; then technical callback/no-return reconciliation and one combined owner payment/browser/device flight. Single/same-date remain live accepted. Different-date needs a second actual offered date. Recovery admission and read-only setup inspection are the next source increment; no new live acceptance is claimed.

## Native campaign stopped on actual date availability — 12 October2026

Native integration is partially accepted: single booking35/invoice27 and same-date bookings33/34/invoice26 passed full association, signed confirmed/unpaid readback and unopened checkout links. Different-date remains blocked. Stop this campaign closed. Resume requires a second eligible date on the developer provider account, then a newly bounded exact-source different-date proof; schedule changes and additional deployment authority are not included in this consumed packet. Do not guess new dates, reopen grants, retry historical effects, merge or deploy production. The later owner-operated payment/browser/webhook flight remains separate.

## Actual calendar discovery before the final native gate — 12 October2026

Single and same-date native integration have passed full invoice association, signed confirmed/unpaid readback and unopened native link. Different-date acceptance is the final native gate. Use one bounded read-only15–29October calendar probe to discover real offered dates; select and bind exactly two dates before preparation. Stop closed if the provider has fewer than two eligible dates. The later owner-operated payment/browser/webhook flight remains separate.

## Native single proof accepted and closed — 12 October2026

Accepted shapes: same-date, single. Pending: different-date. Prepare the remaining different-date flight under existing approval, after release metadata, exact-source CI/artifact and packet validation. One approved flight remains; no extra authority is inferred. Historical unknown effects remain preserved; no paid/browser/webhook/client-production acceptance is inferred.

## Availability-only stop and actual-attempt accounting — 12 October2026

Flight3 consumed packet8e6824f42e2b on ee2853a (all-three CI38230887077/artifact11739086074).16October returned zero offers. The grant cache and request ledger prove no prepare/native POST, no attempt and no booking dispatch. No application-code failure or retry is inferred. Access was independently closed17:49:25Singapore: sourceee2853a/versionecf0c3fe-8f06-4776-8d32-9c2238f64fbb,339/512/active0, disabled provider/identity/end0, expired grants/revoked guest, denied401, empty schedules,18 preserved historical tables and21 unchanged migrations.

The exact owner approval says “up to4 new attempts and8 booking dispatches”. Earlier local wording conflated attempts with flights. This availability-only stop created no attempt, so two of four actual attempts remain. Correct that bookkeeping interpretation without extending resource authority: original512/496/16 provider bounds,208 management/96 Worker/16 aggregate deployments, per-flight64/52/24/4/20minutes, one migration already consumed and20:30Singapore deadline are unchanged. Cap execution at five flights total including this one availability-only stop, and at four actual prepare dispatches (unknown prepare outcomes count). Original approval/hash and pre-reconciliation ledger are retained; private campaign-authority-v2 links them. Only the proved zero-effect flight releases its reserved book/link allowances; provider/request/deployment counters never decrease.

Same-date native integration remains accepted. Next single-session packet uses15October at/after14:00 and separately reads22October as a future-date availability probe; only the15October session enters the intent. Then one different-date attempt may use15/22October if fresh offers and every bound permit. All prior bookings/attempts remain excluded, links unopened, and payments/cancellations/merge/production remain outside scope.

## Same-date native acceptance passed — 12 October2026

Flight2 completed same-date native integration: bookings33/34 in batch7, exact invoice26/S$176/tax0, both signed confirmed booking reads, authoritative unpaid invoice and one native checkout link retained unopened. Current contract correction is accepted for this shape; single-session and different-date gates remain pending. Independently closed17:32:35Singapore at330/512/active0. Two flights remain, deadline20:30. Next: exact-source metadata checkpoint/CI and the new single-session flight, then different-date acceptance if within bounds. Historical unknowns remain preserved; no payment/browser/webhook/production acceptance is inferred.

## Native campaign flight1 — closure contract correction, 12 October2026

Flight1 passed both intermediate receipts and retained exact bookings31/32 in batch6, then stopped on the closeBatch envelope at creation.require_confirm/missing. Its bookings field was an object with two entries; no entry values or map-key semantics were retained. Native acceptance remains pending. Carry281/512/active0, three remaining flights/six booking dispatches maximum and20:30Singapore deadline. Applied0001–0021 are now immutable. Continue the fixed acceptance checklist through a separate invoice-based closure validator, exact-source CI and the next sealed packet; never repeat batch6 closure or touch its records. Service Contracts and Journey own the contract/evidence.

## Current North Star — complete native-booking acceptance, 12 October2026

YS requested a fixed North Star and continued execution until native booking is accepted. Complete the supported developer-account booking integration, then report each acceptance gate against actual evidence. A succession of narrower validation fixes is progress, not completion. Preserve the overarching quoted customer journey and stable M2/M4/M5 milestones below; YS confirmed native-booking integration first, retaining the later combined payment/webhook/owner-device acceptance flight.

1. Establish the complete current intermediate and finalized provider contracts, starting with the second book response collection. Never infer an unobserved field or choose an arbitrary receipt.
2. Complete single-session, same-date multi-session and different-date multi-session native creation; retain exact identities and signing material, close each batch once, and validate the complete intended booking set and invoice.
3. Prove authoritative booking/invoice readback and one protected native checkout link. Preserve customer, service/instructor,40+10 occupancy, fixed price/tax, players1–4 and optional non-blocking comments policy.
4. Prove unavailable/changed-price/foreign/partial/duplicate/unknown-response protections through meaningful regressions and current-account evidence where safe. Unknown writes must remain durable and must never be replayed to obtain a passing result.
5. Require exact final-source frontend/backend/live-email CI, preserved history and independently verified closed access after every live flight. Mark native integration accepted only when every applicable gate in Service Contracts has evidence; otherwise name the remaining gap and stop condition.

Execute source, public research, tests, documentation and PR21 work now. YS approved the finite autonomous campaign in Service Contracts:512 cumulative carrying238, four flights/eight booking dispatches maximum, deadline20:30Singapore, exact-source CI/sealed packets and independent closure. This explicitly replaces separate per-packet confirmation within those limits; the existing closed ledger is carried without reset. Do not promise unbounded completion or silently expand cost/time/record authority. Rules and Architecture owns invariants, Service Contracts owns acceptance/operations and Journey owns dated findings. Earlier sections below are historical checkpoints and retained scope context.

## 11 October — native recovery and compensation source

Returned native IDs/keys survive malformed creation fields and remain candidates until strict readback proves the original scope. Checkout handoff failures enter durable recovery. Separately granted confirmed-unpaid compensation uses signed cancelBooking, fresh complete invoice/subset validation, one-use effects and verified cancellation readback. It blocks possible checkout handoffs, preserves paid/foreign records and missing/unknown replies, never refunds, and consumes at most16 recovery requests under the existing80 cumulative cap. Empty0016 defaults cleanup_allowed=0; applied0001–0014 remain unchanged. No live authority or provider acceptance is claimed.

Next ready task is the final exact-source CI/release and a concrete finite developer-account contract packet. Current-account batch/signatures/link/cancellation and supported webhook delivery remain acceptance dependencies; physical testing stays deferred. Comments may remain blank where safe preservation is unsupported. Service Contracts owns the protocol and Journey owns the first failures/results; do not copy an old packet or reopen historical grants.

## 11 October — protected native customer flow

The existing customer journey now carries native service/provider IDs and current names/prices from catalogue and bounded date availability through players, Details, Review, immutable preparation and the one-use native checkout. Submitted slots must match server-retained offers; the Worker still rechecks the entire cart and each write. The browser includes the ten-minute buffer in overlap checks, never fabricates a paid receipt, and restores the authenticated server attempt after refresh. Remember me/profile consent is unchanged.

The empty, unapplied0016 grant now admits one authenticated customer's selection on at most two approved dates before binding exactly one attempt. Source/account/time/cumulative limits, the two-session developer proof limit and16-call recovery reserve remain. Display reads consume the same physical budget; the UI cannot self-grant or reset it. No live window has opened and no migration/deployment/provider/customer operation occurred.

**Next ready task:** resolve native provider response/cleanup and supported notification contracts, then assemble the exact combined developer flight from the final CI artifact. Comment content is derived, but delivery remains unsupported where staff-comment preservation cannot be guaranteed; that failure is non-blocking under the owner decision. Missing booking references remain unresolved without replay/search/payment. Native account batch/redirect/payment acceptance and webhook delivery are still pending. Do not label these remaining dependencies complete or request intermediate physical tests.

## 11 October — native checkout implementation and owner configuration confirmation

Owner confirmed developer tax0/S$88 final,40+10minutes and Client Login off. Source now has scoped declaration-based prebooking, fresh guest/native-client separation, single and multi-session native booking/invoice validation, no-replay effects, lost-finalization known-ID recovery and a one-use protected checkout route. New0016 is empty/source-only alongside pending0015; applied0001–0014 and all closed windows are unchanged. Full local Worker runtime201/201 passed; an ordered inventory mismatch in the runner was preserved and repaired against the saved output. Exact final CI is required and recorded in PR21.

**Next ready task:** complete live provider-ID selection/availability and protected preparation in the existing customer flow. Comments need preservation-safe provider semantics and remain non-blocking; partial missing references, account batch acceptance, native redirect/payment and webhook recovery remain open. Do not label this source checkpoint native-booking completion. Prepare the exact live packet only when its artifact, operations, limits and closure/cleanup are reviewable. No live window or physical test is requested by this checkpoint. Canonical details and evidence belong to the three docs.

Every booking automatically attempts a Comments entry `Number of players: N` (default1, range1–4). When the optional fifth Details field is filled, append `School / organisation: VALUE` on the next line; omit that line when blank. If comment delivery fails, leave it blank and allow payment: no notification, staff follow-up or repeated booking/payment. The session price is fixed for1–4 players and the displayed total includes applicable tax with no extra fees. A changed price stops checkout and requires restart. Any unavailable selected session stops the whole checkout for customer revision; never silently drop it. These owner decisions do not establish provider tax as zero or complete multi-session recovery.

## Governing objective — 11 October 2026

Deliver the complete quoted A1–A7 customer journey: new and returning customers select valid SoccerBot sessions, safely reuse verified contact details, pay through SimplyBook → SBPay → HitPay, and receive authoritative protected confirmation, including recovery when requests fail, payment is delayed or the browser never returns. Completion includes client-configured UAT, written acceptance, reviewed production activation and operating handover.

YS approved execution of this overarching plan on11October. Source, public research, focused non-browser checks, canonical documentation and feature-branch/draft-PR work proceed within the carried campaign. Live operations require their concrete finite packets; prior closed grants do not reopen. YS reprioritized native booking followed by payment reconciliation/webhooks. Execute supported source and preparation now; the immediate source change adopts one native studio allocation and rejects unexpected overlapping providers; required group size belongs in the native booking Comments section; remaining account contracts determine the next finite live packet. Native booking stays unavailable until its actual mappings are established.

## Technical integration first; one combined acceptance flight

YS directed on11October that native booking and webhook/reconciliation be technically settled before one joined end-to-end physical test. Automated checks, source CI and provider-contract evidence continue during development. The detailed webhook execution instructions live in Service Contracts: establish supported delivery/signatures, durable deduplication/acknowledgement, existing authoritative readback, missed-callback/no-return recovery and adverse-case coverage. No paid webhook is presumed; supported notification hints plus bounded reconciliation are the fallback when settlement delivery is unavailable. Physical acceptance and launch remain pending until the combined flight and final gates pass.

## Native booking completion task — six deliverables, 11 October 2026

Outcome: complete the supported customer booking path before treating native checkout or later webhooks as accepted. Owner-approved policies above remain unchanged. PR20 head2d48ed0 passed all three CI38128735760 jobs and the owner merged it as25aac892. The successor branch preserves that baseline; independent main verification is not inferred from PR CI.

| Item / milestones | Implementation and canonical owner                                                                                                                                                 | Completion evidence / dependency                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / M2, M3, M4    | Bind submitted contact to immutable server-approved intent; native adapter takes name/email/phone from that snapshot. Preserve guest access and verified profile separation.       | Changed contact cannot reuse the same attempt; invalid or missing snapshot cannot dispatch. Exact native customer association still needs supported account evidence; no email search or inferred client ownership.                 |
| 2 / M2, M4        | Preflight every selected session before any write, retain checks immediately before each write, restart on changed price, stop whole checkout on unavailable selection.            | No create/finalize effect when preflight fails; retain approved cart. Account-specific quote/tax and full40+10 occupancy remain required.                                                                                           |
| 3 / M4, M5        | Compose native creation, exact invoice association, one payment-link effect and known-ID recovery.                                                                                 | Existing duplicate/unknown/partial/finalize/readback tests retained; live write/signing/merchant bindings and exact finite grant required before activation.                                                                        |
| 4 / M4            | Derive per-session comment from immutable players and optional school/organisation. Integrate an automatic non-blocking annotation effect under existing transport/journal owners. | Default1 and1–4 covered, blank school omitted, no arbitrary booking IDs, no replacement booking/payment or notification on annotation failure. Provider preservation/response semantics must be established before enabling writes. |
| 5 / M4            | Whole-cart preflight now; supported native batch finalization and partial/unknown recovery next.                                                                                   | Required multiple same/different-date sessions remain open until one exact invoice includes all sessions and unknown finalization cannot replay. Public method names alone do not prove idempotency.                                |
| 6 / M2, M4, M5    | Assemble finite developer acceptance from exact final CI artifact and supported account contracts.                                                                                 | Approved request/cost/closure limits, synthetic owner-operated booking, native comments/checkout/readback, unavailable/changed-price/duplicate/partial cases; no production acceptance inferred.                                    |

Execute source and tests now in the existing owners. Draft a complete live packet only after exact operations and prerequisites are known; do not present an incomplete28+unresolved estimate as approval-ready. Current no-row4/no-reopen, applied0001–0014 and pending0015 remain unchanged. No account/provider mutation or browser execution follows from source work. Remaining contract gaps are engineering evidence gaps, not new business decisions.

## Verified baseline

PR19 is merged at `298c9c8f443063f8b21a2e7b006993a1ec76a9e7`. [Main CI38112617043](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/38112617043) passed frontend/backend/live-email and published the Pages demo. PR-head c2f2506 independently passed CI38049449145. Main publication does not redeploy the Worker.

The metadata-only pass on11October verified developer Worker source4a10133/version4f507619-4f4a-4c19-ba15-f047f981ae71, identity/provider disabled/end0, no schedules and preserved historical state. Fresh service2 catalogue and empty additional fields are observed; exact customer association, final quote/tax, full occupied capacity, comment/batch and webhook contracts remain open. Rules, Service Contracts and Journey own the execution evidence. Applied0001–0014 are immutable. All three identity windows explicitly closed. Owner acceptance passed opt-out/access-only, supersession, remembered issuance, restart/two tabs, phone independence, fresh all-device sign-out and final closure. Replay and real short-session restoration remain open. Developer infrastructure/source tests do not imply provider or production acceptance.

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
| 1 / M2.1–M2.5            | Resolve native contract/configuration: one-studio allocation, tax-inclusive quote, exact customer association, instructor priority IDs and one shared studio. Existing field-discovery/provider transport own reads. Research native notification and batch contracts alongside this. | Sanitized account-specific mappings and supported DTOs; missing values remain blocked. Native count stays1; prepare automatic non-blocking native booking comments and verify non-overlapping provider schedules.                                                           |
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
