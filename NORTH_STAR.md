# North Star: developer API access and native-payment proof preparation

## Active outcome — 7 October 2026

Establish working, securely configured developer SimplyBook authentication/catalogue access, then prepare the supported custom-site booking → native invoice/cart → SBPay-hosted checkout → authoritative payment-status proof. Record the selected Cloudflare backend and future automatic deployment plan in the existing canonical owners; do not implement/deploy the backend or execute booking/payment writes.

- [x] Preserve the four private manual-payment observations and their missing account/invoice/charge joins; no repeated payments.
- [x] Confirm fresh credential presence, ready host-restricted bindings and supported shell HTTPS connectivity without exposing values. YS confirmed the configured developer login after it differed from the historical developer label.
- [x] Complete the original allowance: `getToken` 1, `getEventList` 1, `getUnitList` 1, all successful; **3/3 requests, no retries or business writes**. The allowance is exhausted. Service Contracts owns the approved catalogue projection and its limits.
- [x] Reconcile planned Worker, Durable Object, D1 and deployment responsibilities under the existing M3/M4/M5/M6/M8 milestones in Rules. No live adapter, workflow change or Cloudflare provisioning.
- [ ] Require final-commit `verify / frontend` on the new draft PR; record exact SHA/run there after publication.
- [ ] Obtain the native checkout/status/recovery contract packet, then seek YS approval of a fully bound single-session plan before any business write. The 14-request proposal remains unapproved.

Use `docs/developer-api-cloudflare-plan-2026-10-07` from verified main `e883c1af117a960eeae9359c4db9923d774888dd`. YS merged PR #7; [main run 37581074421](https://github.com/LimYouSheng/SoccerBotStudioSG/actions/runs/37581074421) passed independent verification and the existing Pages deployment. Preserve the historical experiment checkout and original evidence. Future merges require explicit approval for that PR; no main push, merge, deployment or auto-merge is part of this task.

The application remains demo-only. No new booking/payment, admin/client call, configuration change, paid provisioning, availability benchmark or customer enumeration. Reuse matching dependencies; do not reinstall/rebuild or repeat successful local application suites to publish. Public documentation research and non-provider HTTPS diagnostics are separate from provider requests.

## One next ready task and retained gates

Collect the redacted native account/checkout/status/recovery packet in [Service Contracts](docs/SERVICE_CONTRACTS.md#developer-native-payment-evidence-and-first-proof--7-october-2026): establish isolated developer merchant/test-mode binding, explicit booking/cart/invoice/payment joins, supported hosted-checkout and authoritative status/reconciliation contracts, fixture/inbox, quota reserve and reconciliation owner. Basic access is now proved; do not rerun the exhausted catalogue allowance. This is prerequisite collection, not permission to execute the proposed proof or contact third parties.

M2.1 remains partial; M2.2–M2.4 capacity/payment/recovery proof and M2.5 freeze remain open. Authentication/catalogue success does not prove sandbox payment mode, hosted-checkout entitlement, service/provider eligibility, account isolation, multi-booking capacity or payment recovery. Client-specific validation stays a separate later gate. PERF-01–07/P01–P12 requirements are unchanged.

The elapsed-slot trial passed earlier final PR automation (52 unit/component/service cases, 45 browser executions). YS's visual inspection of deployed main is still pending; full M4.1 and physical-device acceptance are separate. CLOUD-01 remains incomplete for the original preview blocker below.

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
