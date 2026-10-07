# SoccerBotStudioSG

Next.js App Router, React, TypeScript and Tailwind CSS. Customer booking demo with custom staff access removed. Repository: [LimYouSheng/SoccerBotStudioSG](https://github.com/LimYouSheng/SoccerBotStudioSG).

## Development entry

- Read [AGENTS.md](AGENTS.md), [NORTH_STAR.md](NORTH_STAR.md) and [PROGRESS.md](PROGRESS.md).
- [Codex Cloud guide](docs/CODEX_CLOUD.md) owns setup, source cutover, preview and efficient Ralph loops. It is adapted from OneFitfinity's actual 6 October Cloud workflow.
- Main source reconciliation is complete. This experiment starts from `0cea68168738c722d05be9d3580938b65a4860c7` after naming PR #5. Keep the Cloud/North Star/Ralph changes on `experiment/codex-cloud-workflow-2026-10-06`, unmerged and outside the Mac baseline.

## Setup and commands

Use Node **24.19.0**, npm **11.9.0**, Python **3.11+** and Git. The repository's `.nvmrc`, package/lock and browser config own these pins. Deliberate initial Cloud/local setup installs the reviewed lockfile and Playwright Chromium/WebKit; ordinary iterations reuse matching dependencies. The full setup procedure is in the Cloud guide.

```bash
npm run dev
```

Development URL: `http://localhost:3000/SoccerBotStudioSG/`.

```bash
npm run build
npm run preview
```

Static preview: `http://127.0.0.1:4173/SoccerBotStudioSG/`, output `out/`. These are internal addresses until a supported remote preview is demonstrated. Stop manually running servers before the browser harness takes port 4173.

```bash
npm run verify
```

The combined gate runs source/policy/tooling/installer checks, formatting, lint, strict types, unit/component tests, one production export and the complete desktop Chromium/phone WebKit/tablet WebKit matrix. Separate scopes are `npm run verify:code` and `npm run verify:browser`. Use affected checks during iteration; do not run all three commands redundantly. Cloud Playwright is authorized. Physical-device acceptance remains separate.

Exact executed identities/engines must match the reviewed inventory. Skips, retries, duplicates and incomplete results fail. Full PR/main CI remains required. `next-env.d.ts` is generated/ignored; typecheck clears only validated generated Next type trees, never source.

## Local baseline and experimental branch

The uploaded Mac checkpoint established the original 121-file source identity. Baseline PR #4 merged that source without explicit user approval; Journey records the failure. YS later merged naming PR #5, and its main verification/deployment passed. This experiment contains documentation changes only relative to that latest main. It does not update the Mac checkout.

Keep the experimental PR unmerged even after acceptance. Every future merge requires explicit user approval for that specific PR. Do not enable auto-merge or treat a request to continue as merge approval.

Existing local installer owners remain `scripts/build-local-installer.py`, `scripts/local-installer.py` and `scripts/guarded-update.py`. Their policy and application browser gate are unchanged. No transition installer is part of this experiment. Do not run historical or Fitfinity installers against the checkout.

## GitHub Pages demo

Demo: <https://limyousheng.github.io/SoccerBotStudioSG/>. The `Verify` workflow checks PRs and main through the required `verify / frontend` GitHub Actions check. Only main uploads/deploys its verified export; deployment reuses that artifact without another build. PRs do not deploy. Pages must use **GitHub Actions**, not branch/Jekyll publishing. Main is observed protected and requires `verify / frontend` from GitHub Actions. Preserve that rule; YAML alone cannot enforce it.

Default/CI base path is `/SoccerBotStudioSG`. `src/content/site-path.ts` owns native asset prefixes. Root hosting needs a separately verified empty-prefix build. The old deployed Pages revision is not a preview of an unmerged candidate. Cloudflare production remains future work.

## Presentation and demo scope

- Exact oracle logos/arena transitions, explicit Studio/booking loader, header blue `#050a2f` and local Roboto roles remain in their canonical owners.
- Synthetic guest/email verification (`360360`), 40-minute play, 50-minute starts, 1–4 players and one shared studio. Selected sessions automatically accumulate assigned instructors, including mixed instructors.
- Five-field contact form, review, five-second simulated payment, expanded confirmation, PDF/calendar and local help. No visible preview controls or custom staff login.
- Official Player App link and dismissible first-visit prompt. This does not implement a custom PWA.
- Three-hour rotations are demo fixtures. The observed client roster has three providers; submitted availability is not the final assigned roster.
- This frontend sends no real booking, charge, email, enquiry or AI request. Standalone read-only API diagnostics do not make its adapters live.

## Canonical documentation

- [Rules and Architecture](docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md): product/process rules, roadmap and performance gates.
- [Service Contracts](docs/SERVICE_CONTRACTS.md): actual operations and authority boundaries.
- [Journey](docs/SOCCERBOT_JOURNEY.md): decisions, failures and evidence.

Provider acceptance, dependency-security disposition, physical UAT and production deployment remain separate gates. The demo stays noindex.
