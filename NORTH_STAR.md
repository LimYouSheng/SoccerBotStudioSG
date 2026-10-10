# North Star: quick rebooking through a connected customer website

## Merged identity and next finite proof — 10 October 2026

PR18 merged atfe179d2; main CI38044816610 passed frontend/backend/live-email and Pages demo publication. Remembered identity is merged source, not deployed/accepted identity. Next authorized source task prepares additive0014 and a separately reviewed60-minute identity-proof gate/packet. Both older windows stay closed; no remote execution is authorized. Correct provider prefill remains a separate prerequisite for quick rebooking. PROGRESS is the current ledger; Service Contracts owns the new packet.

## Authorized source continuation — 10 October 2026

A returning customer on a remembered device can resume with a server-verified identity, review the correct current SimplyBook name/phone, choose sessions, and complete supported native payment with authoritative confirmation. New-device, expired-session and signed-out customers verify again. No demo fallback, guessed customer match or browser payment claim can produce success.

The complete objective is quoted A1–A7 together, written client acceptance and separately approved launch. The immediate vertical slice is **A3 quick rebooking**, using existing M3.4–M3.6. The wider North Star still includes A2/A4–A7 booking, capacity, multi-session acceptance, native SimplyBook/SBPay/HitPay payment and protected confirmation. A3 success alone is not end-to-end completion.

## Source and current baseline

- Uploaded APP404-SBS-Q-WEB-001,4October2026,p3 A3: verify email before approved SimplyBook name/phone prefill; permit review/correction; handle duplicate/shared emails safely; use expiring single-use verification and rate limits. Rules records the source hash and distinguishes quotation terms from owner decisions.
- Owner decision10October: opt-in Remember me lasts **90 days from successful email verification**, absolute expiry with no silent sliding extension. This duration is an implementation choice, not wording in the quotation. The current30-minute guest-bound verified session does not implement it.
- Proved in the controlled developer test: two email receipts, codeB redemption and sign-out; server evidence confirms revoked verified access. Both delivery windows closed; provider access disabled. Old-code/replay live rejection and full device acceptance remain open.
- M3.5 persistent identity is now source-implemented with synthetic checks; live/device acceptance remains pending. Live SimplyBook customer prefill and the complete native booking/payment/reconciliation journey remain unaccepted. Developer happy-path evidence does not close A3.

## Ordered game plan

| Order | Existing milestones  | Outcome and gate                                                                                                                                                                                                                                                                                    |
| ----- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | M3.4–M3.5            | Design and implement opt-in90-day remembered identity separately from short access/guest capability. Preserve revocation, rotation/concurrency, absolute expiry, CSRF and guest attempt ownership. Complete synthetic/session tests and remaining identity live proofs under a new finite approval. |
| 2     | M2.5, M3.6           | Establish the supported exact verified-email/customer binding and authorized minimal name/phone read. Handle no match, unique match, ambiguous/shared email and provider failure without disclosure or scans. Compose into the existing account/details UI.                                         |
| 3     | M3.5–M3.6, M7.2      | Demonstrate quick rebooking after closing/reopening the browser, correct prefill/review/correction, sign-out/all-devices revocation and expiry/new-device verification. Synthetic time advancement proves90-day boundaries; owner browser/physical-device checks prove actual UX.                   |
| 4     | M2.2–M2.5, M4.1–M4.6 | Resolve player/required-field/customer/quote/shared-studio/instructor mappings; connect authoritative availability and all-session booking with partial/unknown recovery. No independent HitPay substitute.                                                                                         |
| 5     | M5.1–M5.5, M6.1–M6.2 | Prove native invoice/payment associations, sandbox outcomes, manual return and browser-independent reconciliation, protected confirmation/exports and native notifications.                                                                                                                         |
| 6     | M6.3–M6.6, M7–M8     | Client-account mappings, full UAT/device/recovery evidence, reviewed production release and handover. M9 warranty/optional support remains governed by the quotation.                                                                                                                               |

Provider contract research may proceed alongside the session design within the single-agent budget; it is not a reason to invent a lookup or activate unsupported calls. Start with the one ready task in PROGRESS, then continue only authorized work.

## Quick-rebooking completion evidence

- First verified visit offers a clear opt-in. Without opt-in, existing short-session behavior remains.
- Same remembered browser after restart restores identity and approved current details without another code during the absolute90-day lifetime. It still validates current booking eligibility/price/capacity server-side.
- At expiry, after sign-out/revocation, or on a different device, verification is required before private details appear. Ordinary use and token rotation cannot extend the original90-day end.
- Server-side customer binding is unique and correct; ambiguous or missing matches expose no other person's name/phone. Customer can correct booking contact details without an implicit provider-profile write.
- Session races/replay, forged browser state, cross-customer reads and storage/provider errors fail safely. Retain guest checkout and durable attempt/recovery records.
- Local non-browser tests, exact PR/main CI, tested artifact, controlled deployed proof and owner/device acceptance are recorded separately. Synthetic90-day evidence is not a claim of90 elapsed days in production.

## Authority, budgets and release path

Source implementation, synthetic checks and one feature PR are authorized. This is not a new live-execution grant or budget reset. Existing authorizations persist only in their original scope. The31/4/24 replacement packet closed at27 management/3 deployments/11HTTP; the original packet closed at34/3/13. Preserve management311 plus unknown Dashboard activity, deployment lower bound21, email2, bot2, provider8/80 and historical80. No reset, third window, automatic retries or use of safety reserves for new setup. New external work requires a concrete tested packet, finite costs, closure/rollback and approval.

One agent; existing24 active-hour/72 elapsed-hour/60-loop/6-repair bounds continue from9October08:18:56UTC, deadline12October16:18:56SGT. The next campaign's proposed scope does not restart that clock or conceal unmeasured active time. No browser execution by the assistant, secret installation, merge/main push, production, paid upgrade or real payment/refund is included.

PR17 merged at2f08b1c; PR16 functionality reached main through it. PR14 merged and PR15 is superseded/closed. Main independently passed CI38041760947. New source work uses a new feature branch/PR; no further merge is authorized. Deployed sourcef2795a1 remains distinct from subsequent documentation commits. Rules owns policy, Service Contracts owns operations/acceptance, Journey owns receipts; PROGRESS is the single current task ledger.

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
