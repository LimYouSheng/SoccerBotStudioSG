# SoccerBotStudioSG engineering

## Start and authority

Read NORTH_STAR.md and PROGRESS.md, refresh actual branch/HEAD/index and remote revision, then read relevant current sections of the three canonical owners:

- [Rules & Architecture](docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md): invariants, architecture and stable M1–M9 roadmap.
- [Service Contracts](docs/SERVICE_CONTRACTS.md): operations, authority, errors, recovery and acceptance.
- [Journey](docs/SOCCERBOT_JOURNEY.md): dated decisions, failures and evidence.

Current rules override dated historical designs. GitHub is canonical; never assume the local checkout follows main. Preserve unknown edits, existing worktrees, dependency symlinks and original evidence. Commands/setup: docs/CODEX_CLOUD.md. Apply soccerbot-engineering.

## Build

Use one feature branch and the existing component/domain/service/style owners. Remove superseded logic; no duplicate patched owners, CSS override tails or speculative abstractions. Preserve logos, header blue, typography, unrelated behaviour and strict source/import/type/lint boundaries. Keep exactly three canonical documentation owners.

Server-side identity, attempt ownership, price/time policy, durable claims and current provider evidence govern effects. Preserve original attempt identity, unknown outcomes, raw/reference evidence and original deadlines. No blind replay, automatic uncertain cleanup, Preview fallback in live operations or payment-only booking confirmation. Never modify accepted migrations or expose secrets/customer data.

## Verify

After every logical change and repair, complete the [mandatory test-impact pass](docs/SERVICE_CONTRACTS.md#mandatory-test-impact-pass-after-every-change--19-october-2026): search all affected component, service, Worker, browser, fixture and inventory owners; update obsolete assumptions without weakening their purpose; run meaningful affected checks.

Use npm run verify:code for full non-browser verification and npm run verify:worker when applicable. Owner/CI operates browsers and physical devices: no assistant Playwright, screenshots, npm run verify, verify:browser or browser-running installers. Do not add retries, sleeps, forced clicks, skipped cases, looser timeouts or reduced inventories to conceal failures. Require all three final-commit CI gates: verify / frontend, verify / backend, verify / live-email.

Report source, selected checks, full local verification, CI, merge, deployment, provider and physical acceptance separately. Main independently verifies the merged revision; deployment consumes the tested artifact. Simulations do not establish deployed acceptance.

## Deliver and update

Inspect → change → test-impact review → affected checks → update owners → review diff → commit/push task branch and draft PR. Never merge, auto-merge, push main, deploy or change protection without applicable explicit authorization. A draft may obtain CI; readiness requires final-commit green gates.

Keep NORTH_STAR to the current goal and next gate; PROGRESS to the current revision, evidence and outstanding work; move historical checkpoints to Journey. Replace stale current statements instead of prepending another handoff. Record history once in Journey, linking prior revisions for older supporting records. Update affected canonical contracts and roadmap status in the same change. Do not renumber milestones or convert implementation evidence into acceptance.

## Boundaries

No assistant bookings, payments, cancellations, refunds, notification sends or historical cleanup. No destructive reset, force push, secret disclosure or unapproved provider/account changes. Historical grants, budgets and deadlines never authorize new activity. Performance and deployed token-restoration acceptance are postponed by the owner. Keep eight-minute payment, fifteen-minute hold and five-minute recovery buffer policies until separately reviewed evidence supports a change.

No background agents or standing service. Routine cloud source work does not require a Mac installer. If delivering one, use the canonical guarded tooling and verify exact final bytes, hashes and links.

[Pre-compaction orientation and historical handoffs](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/69945cc4ecae4593799f7205beedbc82513f9945/AGENTS.md) are retained as historical evidence, not executable instructions.
