# SoccerBotStudioSG engineering

## Start and authority

Read NORTH_STAR.md and PROGRESS.md, refresh branch/HEAD/index and remote revision, then read [Architecture](docs/Architecture/README.md) and [Service Contracts](docs/SERVICE_CONTRACTS.md). Architecture has exactly the diagram and one-page explanation. Service Contracts Part 1 owns current business/operational rules; Part 2 owns dated changes, decisions and evidence. Current rules override dated historical designs. GitHub is canonical; never assume the local checkout follows main. Preserve unknown edits, worktrees, dependency symlinks and original evidence.

Apply the repository-local [soccerbot-engineering skill](.agents/skills/soccerbot-engineering/SKILL.md). The owner's 22 October consolidation supersedes older cloud-skill references to three canonical documents, Journey, Rules & Architecture or CODEX_CLOUD. Do not recreate those deleted owners.

## Build

Use one feature branch and the existing component/domain/service/style owners. Remove superseded logic; no duplicate patched owners, CSS override tails or speculative abstractions. Preserve logos, header blue, typography, unrelated behaviour and strict source/import/type/lint boundaries. Keep business rules/history in Service Contracts and topology in Architecture; do not duplicate them here.

Server-side identity, attempt ownership, price/time policy, durable claims and current provider evidence govern effects. Preserve original attempt identity, unknown outcomes, raw/reference evidence and original deadlines. No blind replay, automatic uncertain cleanup, Preview fallback in live operations or payment-only booking confirmation. Never modify accepted migrations or expose secrets/customer data.

## Verify

After every logical change and repair, complete the mandatory test-impact pass: search all affected component, service, Worker, browser, fixture and inventory owners; update obsolete assumptions without weakening their purpose; run meaningful affected checks.

Use npm run verify:code for full non-browser verification and npm run verify:worker when applicable. Owner/CI operates browsers and physical devices: no assistant Playwright, screenshots, npm run verify, verify:browser or browser-running installers. Do not add retries, sleeps, forced clicks, skipped cases, looser timeouts or reduced inventories to conceal failures. Require all three final-commit CI gates: verify / frontend, verify / backend, verify / live-email.

Report source, selected checks, full local verification, CI, merge, deployment, provider and physical acceptance separately. Main independently verifies the merged revision; deployment consumes the tested artifact. Simulations do not establish deployed acceptance.

## Deliver and update

Inspect → change → test-impact review → affected checks → update owners → review diff → commit/push task branch and draft PR. Never merge, auto-merge, push main, deploy or change protection without applicable explicit authorization. A draft may obtain CI; readiness requires final-commit green gates.

Keep NORTH_STAR to the current goal and next gate; PROGRESS to the current revision, evidence and outstanding work; move historical checkpoints to Service Contracts Part 2. Replace stale current statements instead of prepending another handoff. Record history once in Service Contracts Part 2, linking prior revisions for older supporting records. Update affected canonical contracts and roadmap status in the same change. Do not renumber milestones or convert implementation evidence into acceptance.

## Boundaries

No assistant bookings, payments, cancellations, refunds, notification sends or historical cleanup. No destructive reset, force push, secret disclosure or unapproved provider/account changes. Historical grants, budgets and deadlines never authorize new activity. Single-checkout timing and deployed token restoration now have bounded evidence; further warm-cache/batch performance and sustained-capacity work remain optional follow-ups, not new live-test authorization. Keep eight-minute payment, fifteen-minute hold and five-minute recovery buffer policies until separately reviewed evidence supports a change.

No background agents or standing service. Routine cloud source work does not require a Mac installer. If delivering one, use the canonical guarded tooling and verify exact final bytes, hashes and links.

[Pre-compaction orientation and historical handoffs](https://github.com/LimYouSheng/SoccerBotStudioSG/blob/69945cc4ecae4593799f7205beedbc82513f9945/AGENTS.md) are retained as historical evidence, not executable instructions.

## Cloud setup and delivery essentials

Use the pinned Node/npm versions in .nvmrc and package.json, reviewed package-lock, Python 3.11+ and Git. Initial setup may install the lockfile deliberately; routine work reuses matching dependencies and browser caches. Preserve inherited proxy/CA settings; use supported network permissions, never disable TLS or bypass the proxy. Check credential presence without printing values. Local Worker tests use isolated workerd/D1/DO and intercepted synthetic providers; no live outbound calls follow from test authorization.

Use npm run check:source and check:policy for ownership/policy; npm run check:tooling and check:installer for affected tooling; verify:code for full non-browser work and verify:worker for Worker changes. Owner/CI runs verify:browser or verify. Do not launch browsers or browser-running installers as the assistant. Keep root and Pages artifacts distinct; a base-path/configuration change needs its own verification. Local port 4173 is not a public preview; do not start standing servers or claim a preview URL without evidence.

For local delivery only, use scripts/build-local-installer.py, local-installer.py and guarded-update.py. Validate exact baseline/candidate bytes, inventory, paths/case and receipt hashes under one repository lock; preserve unknown edits, external backups and failure receipts. Planning scope stays documentation/approved delivery tooling only and never runs Node/browser checks. Application delivery retains full applicable gates. Never run historical bundled commands/installers against a current checkout. Verify exact final file/hash/link before delivery. Routine cloud work needs no Mac installer.

Publication is separate from verification: reuse valid unchanged receipts, push a task branch and draft PR, and require final-head CI before readiness. Main independently verifies the merged revision and deployment consumes its tested artifact. No new provisioning, secrets installation, production activation or migration of provider data is implied. Current client migration gaps and the safe setup plan live in Service Contracts.
