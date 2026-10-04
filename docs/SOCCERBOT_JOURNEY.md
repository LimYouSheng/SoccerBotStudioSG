# SoccerBotStudio — Journey

Chronological decisions and evidence. Current contract: `SOCCERBOT_RULES_AND_ARCHITECTURE.md`.

## 2026-10-04 — Frontend foundation

### Inputs and authority

- `showcase(2).html`: customer visual/interaction baseline. SHA-256 `9dec73897cdddb0a46b4cc401f5a9fe4cef55b73d254aff564f07a8af65b81c2`.
- `General Development Guidelines.pdf`: engineering process, canonical ownership, fail-closed updates, tests and evidence rules.
- `Fitfinity_Renewals_Acknowledgement_Local_2026-10-04.sh`: guarded installer reference, decoded and inspected without execution. Its domain fixes, repository hashes and test counts are not SoccerBot requirements.
- `SoccerBotStudio Quotation (1)(1).zip`: main and AI technical architecture tables and authority boundaries only. No old commercial terms or staff scope reinstated.
- User direction: remove staff login, use Next.js/React/Tailwind, and establish Docs for the architecture, rules and installer pattern.

### Decisions

- New source project because no target Git checkout was supplied. Original inputs remain untouched.
- Removed the complete embedded staff area, including header/footer links, route, credentials, mock operations and styles. Customer email verification retained.
- Native Next.js routes replace hash routing. Domain, services, feature UI, assets and content have explicit owners. No legacy HTML runtime embedded in React.
- Static export aligns with future Cloudflare Pages hosting. Browser code does not contain or call real provider credentials.
- Local embedded assets extracted to reusable files, with the original attribution metadata retained.
- Customer functionality stays demo-only. Future Workers/D1/SimplyBook/SBPay/HitPay/Resend/monitoring and optional staff/AI architecture are documented, not falsely presented as implemented.
- Initially retained source prototype settings because the older ZIP was supplied only for architecture. Superseded during this turn when the user supplied the latest web quotation as rule authority.

### Evidence

Frontend implementation is complete as a reviewable demo candidate. The local verification results and remaining acceptance gates are recorded below. No Git repository, remote publication, CI execution, deployed environment or physical-device acceptance is claimed.

### Latest rule update received during implementation

- `APP404-SBS-Q-WEB-001(2).pdf`, dated 4 October 2026, became the current product-rule authority.
- Changed prototype two-studio resources to one shared studio, cadence from 40 to 50 minutes with 40 minutes play, moved instructor selection after dates/times, provided four clearly identified preview instructor records and limited returning-customer prefill to name/phone.
- Updated current contract with A1–A7, operating baseline, exclusions and B1/B2 verification/handover boundaries. Older staff/AI scope remains reference-only.
- Initial Next.js export compiled successfully. The first Playwright browser download returned a non-archive response for its browser build; pinned Playwright 1.58.2 for a reproducible compatible browser set. No browser failures are being hidden with retries.

### Completed local verification

- Source ownership/import graph/layering/integrity and declared test inventory: passed.
- ESLint: passed with zero warnings. Strict TypeScript: passed.
- Vitest domain/service regressions: **17/17 passed**.
- Source-checker failure-path regressions: **9/9 passed**.
- Guarded-update regressions: **6/6 passed**, covering canonical apply/backup/revision preservation, unknown edits, unexpected files, staged edits, corrupt payload and unsafe/symlink paths. Test Git repositories were disposable fixtures only.
- Next.js production static export: passed. Public Home/Studio/Enquiry and all seven customer booking steps generated. Unknown staff route returns 404.
- Playwright in portable Chromium 153.0.8010.0: **21/21 passed**, seven customer scenarios each at desktop, phone and tablet sizes. Zero retries/skips/flaky results. Includes multi-date booking, refresh, PDF/calendar downloads, decline/pending/late states, capacity conflict, email verification and enquiry/assistant behaviour.
- Visual review: desktop home and phone booking screenshots inspected. Responsive overflow assertion passed. Phone times use two columns. Staff links/routes are absent.
- Machine-readable evidence: `verification.json`. The declared source-level test inventory is versioned in `scripts/test-inventory.json`.

### Failed attempts and corrections

- The first browser-binary download returned HTML instead of an archive. An official WebKit mirror download succeeded, but WebKit cannot launch here because native libraries are missing and the environment cannot perform the required system package installation.
- A portable Chromium binary provided an alternative for real browser checks. Its initial single-process launch could not reuse browser contexts reliably; removing that environment-only launch flag resolved the harness failure. Application source was not changed for it.
- Initial browser tests incorrectly expected `S$` where the Singapore currency formatter renders `$`, matched Next.js's route-announcement alert in addition to the form alert, and attempted to use a preview selector after its disclosure had closed. Test selectors were corrected to the actual controls without reducing assertions or scope. These were fixture fixes, not application fixes.
- Visual/code review also reduced excessive mobile time-list height, added the Instagram link, and prevented continuation with a slot that became unavailable.

### Evidence boundaries and remaining work

- Canonical Playwright configuration still requires desktop Chromium plus phone/tablet WebKit. This environment's successful phone/tablet runs used Chromium with the same viewports; they are **not Safari/WebKit acceptance**. The complete canonical `npm run verify` gate is therefore not claimed green.
- No production booking, payment, identity, email delivery, Worker security, provider entitlement, cross-request concurrency or cleanup/recovery guarantee is inferred from these mocks.
- No physical-device acceptance, client UAT, live canonical domain/sitemap, monitoring alerts, CI execution, repository publication or deployment was performed.
- The supplied hero artwork/branding and interactive entry were rebuilt as React-owned presentation. Client visual review against the agreed prototype remains necessary.
- Next stage: integrate and prove the Worker/provider contracts against the authorised client test accounts, with the latest quoted A1–A7 rules. Run WebKit and physical devices before acceptance.

## 2026-10-04 — Documentation/process review before GitHub

### Scope and reviewed sources

User paused further frontend changes, assigned future browser tests to their side, requested “Build With Own Accounts” context, the new OneFitfinity process, an architecture picture with uses/costs, and a tooling audit. Initial GitHub publication is explicitly the next task. This supersedes the earlier entry's provider-integration-first sequencing.

- Read all 31 pages of `OneFitfinity_Engineering_Process_and_Verification_Handbook.pdf` as extracted text. Its anchor is Fitfinity main `c871aca5d746`; this review adopts the process summary, not a fresh inspection/certification of that separate repository.
- Retrieved relevant “Build With Own Accounts” chat evidence: user's 4 October 03:33:55 UTC question and prior assistant's 03:34:17 UTC proposal. Developer SimplyBook test company + HitPay sandbox first; client accounts/configuration before UAT; ID/config mappings rather than hardcoded IDs; sandbox/production separation and client activation. No GitHub owner decision was retrieved. The earlier rough completion-percentage estimate is not adopted.
- Reviewed actual package/lock inputs, configs, workflow, source checker/tests, guarded-update implementation/tests, demo contracts/adapters, booking rules/provider, date fixtures, exports and historical receipt. No browser tests, browser installation, UI changes, provider writes or GitHub publication were performed.
- Checked official SimplyBook, Cloudflare, HitPay, Resend, GitHub, Sentry help and UptimeRobot sources for cost labels; URLs and qualifications live in Rules. Sentry paid pricing could not be read reliably, so no unverified paid price is asserted.

### Documentation changes

- Replaced the outdated two-document rule with Rules & Architecture, Service Contracts and Journey; added the actual demo operation inventory in `SERVICE_CONTRACTS.md`.
- Added user-owned browser execution, selected versus full gates, portable source/CSS checks, semantic/Hooks discipline, negative testing of the test system, exact execution receipts, protected PR/main workflow, isolated server tests, compatible migration/recovery rules and separate deployment evidence.
- Added account/environment portability and client cutover guidance; retained native SimplyBook → SBPay → HitPay authority and the no-custom-staff-login boundary.
- Added the high-level architecture PNG/SVG with one-line uses/costs and present/planned labels. No service is provisioned by drawing it.
- Flagged budgeting qualifications: private branch protection is not included with a free private repository; exact SBPay checkout/API versus Payments PRO entitlement needs proof; quoted S$60–150 is a target while the upper paid-email line items total S$180 before optional additions. No paid plan was selected.

### Audit verdict

**The first iteration is a usable frontend demo foundation, not a complete OneFitfinity-equivalent verification system and not production-ready.** It is suitable to preserve as the initial GitHub source checkpoint with the following open findings recorded. Missing backend tools do not need to be installed merely to record that first source checkpoint.

| Area | Present and inspected | Gap / next acceptance requirement |
| --- | --- | --- |
| Frontend stack/structure | Static Next.js App Router; React; TypeScript strict/no-unused; Tailwind/PostCSS; Zod; local assets; separate domain/services/features/composition | No live API transport; synchronous positional demo contracts need a deliberate asynchronous/named production design |
| Product/UI components | Home, Studio, Enquiry, seven booking steps, date-before-instructor flow, four preview instructors, single studio, guest/email demo, forms, review, payment states, confirmation/PDF/ICS, local help | Real provider-authoritative A3–A7 outcomes absent; some client content/prices/hours provisional; no live canonical URL/sitemap; bespoke staff login is intentionally absent |
| Repeatable setup | Exact package declarations plus package-lock; `npm ci`; Node >=22 and CI Node22; static build/preview | No exact local Node/npm pin; Python/Git needed by installer fixtures not fully specified in first README; CI has not demonstrated fresh-machine reproduction |
| Semantic lint/types/format | Next ESLint/Hooks preset, zero-warning CLI, strict TS, layer rules, Prettier write command | No explicit `noInlineConfig`; no semantic/Hooks suppression-negative fixtures; no format-check gate. Python helper lacks a separate lint/format gate. Existing justified no-img exception is scoped conceptually but not evidence all exceptions are guarded |
| Source health | Import graph, literal dynamic imports, cycles/reachability, layer rules, one CSS file, simple undefined CSS vars, whitespace/conflicts/symlinks, some test controls | No case-insensitive file/directory collision checks; no CSS parser/duplicate-property/value checks; no required canonical CSS import/mount-owner policy; TS parse diagnostics aren't checked by this script; todo/chained test controls not exhaustively rejected; Git ignore policy is only a hardcoded folder set |
| Test-system regressions | Nine checker regressions; six guarded-update fixtures | No workflow-YAML mutation tests, lock/version-policy tests, semantic/Hooks negatives or receipt-rejection tests; these are distinct from application coverage |
| Unit/service tests | 17 Vitest cases in one service test file; clock fixtures, validation, payment simulations, identity, ICS | No React Testing Library/user-event/DOM environment; no component `.test.tsx` inclusion; missing form/state/route/modal race coverage; no dedicated accessibility automation or meaningful coverage/report baseline |
| Browser test source | Seven scenarios × three canonical projects = 21 configured executions; zero retries, forbidOnly, failure trace/screenshots, JSON report | User owns future execution. Historical phone/tablet were Chromium viewports, not canonical WebKit. Date-fixture month rollover and assertion/title gaps below remain open |
| Exact receipts | Reviewed source title inventory in JSON; historical verification JSON | Inventory discovery only: no validator ties actual result identities/counts/file totals/project engines/no-retries/no-skips to expected source and candidate hash; deleting the inventory file is not itself rejected by the checker |
| CI / repository | PR + main-push verification YAML, read-only repository permission, npm ci, browser setup, always-uploaded browser folder | No local Git checkpoint or candidate upload, verified protection, CI run or reusable policy verifier; selected remote was subsequently confirmed public. Missing retained full lint/unit/tooling/build logs and strict receipts; no explicit dependency/secret scan/update workflow; actions use mutable version tags. Reconcile user browser ownership before activating workflow |
| Guarded installer | Apply-only, exact Git state and whole-source hashes, baseline recheck, external backup, atomic per-file writes, receipts, no Git/cloud mutation | No portable case checks or completed-candidate no-write rerun; lock path changes with logs directory; no exhaustive race/partial/case/rerun negatives. It is a starter, not the mature handbook operator |
| Server/provider tools | Architecture and boundary requirements documented | No Worker/Wrangler config, server schemas, authenticated sessions, real rate limits/Turnstile, environment mappings, D1 migrations/tests, HTTP/contract snapshots, live provider adapters or compensation/reconciliation implementation |
| Operations/security/deploy | No credentials required for demo; demo/noindex boundary explicit | No deployed DNS/TLS/security headers, monitoring SDK/alerts, tested restore/cutover, dependency vulnerability evidence, production consent/retention implementation, staging/CD or client UAT |
| Intentional exclusions | No custom staff login, PWA/service worker, AI provider, AWS/PostgreSQL backend, replacement scheduling database | Do not install these just to match Fitfinity; introduce only if scope explicitly changes |

### Concrete findings for the next code/testing pass (left unchanged)

| ID | Finding and source | Impact and required follow-up |
| --- | --- | --- |
| AUD-01 | `selectionErrors` in `src/domain/booking.ts` rejects dates before today but not an elapsed start time today; `demo/booking.ts` availability has no current-time filter | Same-day past slots can look bookable in the demo. Add trusted-time rules and explicit boundary regressions before treating time validation as complete; production must revalidate server-side |
| AUD-02 | `tests/customer.spec.ts` selects tomorrow/day-after by label without moving the currently displayed calendar month | Fixtures fail at month rollover independent of a product defect. Use a controlled clock or navigate month explicitly; preserve the multi-date assertions |
| AUD-03 | Browser scenario title claims guardian validation but its actions only check required name and then adult details; guardian logic has a unit assertion | Browser guardian/under-18 path is not proved. Add the actual interaction assertion or accurately narrow the title, without claiming equivalent coverage |
| AUD-04 | Browser downloads assert filename suffix only; `exports.ts` uses jsPDF default fonts | PDF contents, Unicode names, pagination and device readability are not verified. Add content checks; user verifies rendered files/physical save. ICS has unit event/time evidence but not full import acceptance |
| AUD-05 | Demo booking creates/allocates records on simulated payment resolution; `Attempt` has no expired/unknown/partial-cleanup states | Not the required live A5 booking-before-payment protocol. Implement a separate server attempt contract, supported invoice association and fault/recovery tests before wiring real checkout |
| AUD-06 | Source inventory can pass without `scripts/test-inventory.json`; direct test-control AST check excludes `todo` and some chained forms; no result validator | A green command does not prove full intended execution. Add fail-closed inventory/receipt tooling and deliberate negative tests |
| AUD-07 | Guarded updater lock lives beneath caller-supplied logs root and doesn't recognize complete candidate reruns | Two different log roots can evade a common lock; rerun is refused rather than known-no-op. Harden operator and regression fixtures before routine distribution |

These are static audit findings, not new failing browser-test receipts. No source fix is implied by documenting them. Frontend semantic correctness and security are not exhaustively certified by this audit.

### Sequence and evidence handoff

1. Next task: upload initial source to the user-selected existing repository, resolve current write-access/visibility and required-check plan, exclude dependencies/generated output/secrets, record this baseline and known gaps. Confirm how user-owned browsers will be run/recorded before enabling the current automatic browser step; no browser suite is silently removed or labelled passed.
2. Following source checkpoint: close the relevant tooling/test-system and time/fixture findings in bounded branches, with regressions and the three documentation owners updated. User runs browser checks and supplies receipts; assistant can review those receipts.
3. Later: build Worker/D1/provider adapters and prove the dev-account route; configure client staging/UAT then production, with scoped credentials, authoritative booking/payment recovery and actual operations evidence.

Historical evidence remains unchanged: 17 application, 9 source-checker and 6 installer passes; 21 Chromium browser executions across three viewports; canonical WebKit, physical devices, provider integration, CI and deployment pending. The current documentation-only review must not relabel those as fresh executions.

### Package naming received during review

User selected **SoccerBotStudioSG** and the repository URL `https://github.com/LimYouSheng/SoccerBotStudioSG`. Updated npm identity to `soccerbotstudiosg` in package.json and the lockfile root only; dependency versions, scripts, frontend source and tests remain unchanged. The deliverable uses SoccerBotStudioSG as its archive/root name. This is the only non-document metadata change in this review.

Read-only GitHub check: repository exists, `private: false`, default branch `main`, exposed root contents returned an empty list, connection permissions `pull: true` / `push: false`. Installed-repository lookup for SoccerBotStudioSG returned no match. This supersedes earlier assumptions that a repository still needs creation; the next task is source upload after access/visibility are resolved. No source write or workflow activation was attempted. Public branch protection is available on Free; the documented paid-plan requirement applies if this client repository is made private.

### Verification of this review

- `npm run check:source`: passed after the documentation and package-name changes.
- Compared original 75-file manifest and archive: only AGENTS/README/two existing docs and the requested package-name metadata changed. The new service-contract document, architecture images and review receipt are supporting additions. Dependencies, scripts, frontend, tests and CI configuration are unchanged.
- Checked local Markdown links and visually inspected the rendered architecture PNG; no browser was used.
- Existing built `out/` bytes remain identical to the first-iteration archive. No new build, unit/installer/application/browser suite, CI run or deployment is claimed for this review.
- `review-verification.json` records this selected review; `verification.json` remains the historical application receipt. `source-fingerprint.json` identifies the updated package files excluding itself and generated/dependency folders.
