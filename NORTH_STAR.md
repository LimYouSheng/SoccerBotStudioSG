# North Star: CLOUD-01

## Outcome

- Evaluate reproducible SoccerBotStudioSG development in a fresh Codex Cloud task on an experimental feature branch, with reviewed source, strict validation and a usable preview.
- Start from main `0cea68168738c722d05be9d3580938b65a4860c7`, which contains the inspected Mac source and naming PR #5. The Cloud experiment remains separate and unmerged, including after its checks pass.
- End at a reviewable PR and recorded setup evidence. Merging and application deployment remain separate decisions. Feature-branch/PR publication is part of the authorized handoff.

## Scope

- Concise `AGENTS.md`, cloud operating guide and compact progress/task ledger.
- Preserve the reconciled source and latest main changes. The previous unauthorized PR #4 merge is recorded in Journey; source identity and passing CI do not imply merge authorization.
- Preserve measured SimplyBook findings in the experimental documentation without claiming live-adapter acceptance.
- Configure and verify the cloud environment using existing repository commands.
- Preserve application behaviour, test strength and canonical ownership.

## Acceptance

- [x] Inspected Mac source is preserved in main; merged naming PR #5 is included. The prior merge-authorization failure is recorded without relabelling it as approval.
- [ ] Cloud changes remain on a separate experimental feature PR based on the synchronized main; they are not merged or applied to the Mac baseline.
- [ ] A fresh cloud task reads the current instructions and records its repository, branch, HEAD and runtime versions.
- [ ] Dependencies install from the committed lockfile; relevant frontend checks and Playwright run against a fresh internal preview.
- [ ] Provider discovery findings and remaining M2 gates are preserved; no client booking/payment writes or live-adapter acceptance are implied.
- [ ] Full required GitHub Actions checks pass for the final PR candidate; all three Chromium/WebKit projects and strict result inventories remain intact.
- [ ] A usable user preview is demonstrated, with the exact revision and demo/API mode stated. If unavailable, this criterion remains blocked.
- [ ] The PR includes verification evidence and remaining human/device/provider boundaries; no merge or deployment occurs in the development loop.

## Exclusions

- No business features, client production rollout, provider configuration changes, deployment activation, database migrations or real bookings/payments.
- No new CI preview deployment, always-running agent, scheduler, paid service, custom MCP server or code graph in this milestone.
- Existing hosted Pages is the merged-main demo; it must not be represented as a PR preview.

## Run policy

- One ready ledger task per run; stop at its acceptance or a concrete blocker.
- No unattended relaunches are configured. A future orchestrator needs an explicit run/time/spend limit and stop condition before activation.
- Run focused checks while changing code; consume existing full-CI results for the final candidate rather than repeatedly duplicating that suite.
- Do not enlarge scope or edit acceptance criteria to make the milestone appear complete. Ask the user for a changed outcome when needed.

## Owners

- Tasks, blockers and evidence: `PROGRESS.md`.
- Engineering authority: `docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md`; concise entry instructions: `AGENTS.md`.
- Setup and verification commands: `docs/CODEX_CLOUD.md`.
- After acceptance, replace this bounded milestone with the next user-approved outcome; retain the completed receipt in Journey.

Source adaptation: OneFitfinity PR #8 at `16eea945f9324b6f20610d0a0b98b1a1cb6014e9`, `docs/codex-cloud-workflow-2026-10-06`, refreshed after its main `7970f65b5975a6554c46eb521c7ca118939e4bb9`. The structure and bounded run policy are retained; SoccerBot acceptance replaces Fitfinity backend/AWS gates.
