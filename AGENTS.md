# SoccerBotStudio development

Read `docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md` before changes. Three canonical documentation owners: that current contract, `docs/SERVICE_CONTRACTS.md` for operation boundaries and `docs/SOCCERBOT_JOURNEY.md` for dated decisions/audits/evidence. Update the affected owners for material changes.

The user owns browser execution. Do not install or launch browsers, run Playwright, take browser screenshots, or run `npm run verify` (it includes browsers). Inspect test source and review user-supplied receipts; use scoped non-browser checks for assistant work. Missing browser/CI/provider evidence stays pending. The existing CI browser step requires ownership reconciliation at GitHub setup, not silent disabling.

Current checkpoint: documentation/audit only; preserve frontend and tooling source until the next authorized task. Initial source upload to the selected `LimYouSheng/SoccerBotStudioSG` repository comes next, before further frontend work. Repository is public and connection is currently read-only; see Journey.

Edit the owning component, domain function or adapter. Do not add patched copies, override tails, arbitrary provider proxies, browser credentials, disabled tests or retries to hide failures. Preserve unknown changes. Follow the latest handbook adaptation and report selected/local/CI/deployed/provider/physical acceptance separately.
