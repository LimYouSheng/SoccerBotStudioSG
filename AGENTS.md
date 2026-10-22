# SoccerBotStudioSG engineering

## Authority and document ownership

This file is the sole owner of repository engineering instructions. User instructions take precedence; current repository instructions supersede stale external skill snapshots. The cloud skill's older Journey, Rules & Architecture and CODEX_CLOUD references are superseded; do not recreate those files.

| File                                                         | Unique purpose                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [README](README.md)                                          | Development prerequisites, configuration and command reference.                    |
| [AGENTS](AGENTS.md)                                          | Engineering workflow, coding conventions, verification and action boundaries.      |
| [Local skill](.agents/skills/soccerbot-engineering/SKILL.md) | Discover and enter this repository's instructions.                                 |
| [North Star](NORTH_STAR.md)                                  | Current outcome and priority.                                                      |
| [Progress](PROGRESS.md)                                      | Current revision, observed evidence, blockers and next actions.                    |
| [Architecture diagram](docs/Architecture/diagram.md)         | Component topology and connections.                                                |
| [Architecture explanation](docs/Architecture/README.md)      | Explain component responsibilities and interactions.                               |
| [Service Contracts](docs/SERVICE_CONTRACTS.md)               | Part 1: system rules and milestone criteria; Part 2: dated decisions and evidence. |

Read North Star, Progress, Architecture and the relevant Service Contracts before work. Refresh branch/HEAD/index and the remote revision; GitHub is canonical, but the local checkout may differ. Preserve unknown edits, worktrees, dependency symlinks and original evidence. Update the owning document and link to it elsewhere; do not maintain parallel rules, setup guides or status ledgers. Historical entries remain dated evidence, not current instructions or renewed authorization. Preserve milestone IDs and record history once in Service Contracts Part 2.

## Implement

Use one feature branch and edit existing component/domain/service/style owners. Remove superseded logic; no duplicate patched owners, CSS override tails or speculative abstractions. Preserve approved presentation, unrelated behavior and strict source/import/type/lint boundaries. Apply system invariants from Service Contracts at every affected execution path; never modify accepted migrations or expose secrets/customer data.

Use one-line JSDoc/TSDoc summaries (`/** ... */`) for major TypeScript/JavaScript functions and one-line PEP 257 docstrings (`"""..."""`) for Python functions. Describe purpose or an important constraint with an imperative sentence; omit redundant type/parameter prose. Keep detailed safety rationale beside the relevant logic. Exclude generated code, test callbacks and trivial accessors from blanket documentation.

## Verify and publish

After every logical change or repair, search affected components, services, Worker/browser tests, fixtures and inventories. Update obsolete assumptions without weakening their purpose, then run meaningful affected checks using the [command reference](README.md#verification-commands). Never add retries, sleeps, forced clicks, skipped cases, looser timeouts or reduced inventories to conceal failures. Preserve the first failed receipt and diagnose it.

Owner/CI operates browsers and physical devices: no assistant Playwright, screenshots, `npm run verify`, `verify:browser` or browser-running installers. Simulations do not establish provider or production acceptance. Report source changes, local verification, CI, merge, deployment and owner/provider acceptance separately.

Inspect → change → test-impact review → affected checks → update owning documents → review diff → commit/push task branch and draft PR. Readiness requires all three final-commit gates: `verify / frontend`, `verify / backend`, `verify / live-email`. Reuse unchanged valid local evidence when publishing; do not rerun suites solely to publish. Main verifies the merged revision independently; deployment consumes its tested artifact without rebuilding.

Never merge, auto-merge, push main, deploy or change protection without applicable explicit authorization. No assistant bookings, payments, cancellations, refunds, notification sends or historical cleanup. No destructive reset, force push or unapproved provider/account changes. New provisioning, secrets installation and production activation are separate actions. No background agents or standing service.

## Execution environment and local delivery

Follow README for tool versions and configuration. Preserve inherited network proxy/CA settings; use supported permissions, never disable TLS or bypass the proxy. Check credential presence without printing values. Worker tests use isolated workerd/D1/DO with intercepted synthetic providers; test authorization does not permit live outbound calls. Local port 4173 is not a public preview; do not claim a preview URL without evidence.

Routine cloud source work needs no Mac installer. If delivering one, use `scripts/build-local-installer.py`, `local-installer.py` and `guarded-update.py`. Under one repository lock, validate baseline/candidate bytes, inventory, paths/case and receipt hashes; preserve external backups and failure receipts. Planning scope accepts only documentation/approved delivery tooling and never runs Node or browsers; application delivery retains all applicable gates. Never execute historical bundled shells against current checkouts. Verify final bytes, hash, filename and links before delivery.
