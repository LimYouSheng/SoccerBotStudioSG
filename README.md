# SoccerBotStudioSG

Project/package: **SoccerBotStudioSG**. npm identifier: `soccerbotstudiosg`. Intended repository: [LimYouSheng/SoccerBotStudioSG](https://github.com/LimYouSheng/SoccerBotStudioSG).

Next.js App Router, React, TypeScript and Tailwind CSS. Customer-facing booking preview with staff access removed.

## Run locally

Requires Node.js 22+ and npm; the CI definition uses Node 22. Git and Python 3 are also required for the guarded-update regression fixtures. Extract into a fresh folder. Exact local runtime pinning remains an audit item.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

```bash
npm run build
npm run preview
```

Static preview: `http://127.0.0.1:4173`. The export is generated in `out/` for future Cloudflare Pages deployment. There are no Next.js server/API routes.

## Check the source

Assistant-safe non-browser checks (choose the affected scope; these are not a full browser acceptance receipt):

```bash
npm run check:source
npm run check:tooling
npm run check:installer
npm run lint
npm run typecheck
npm test
npm run build
```

**Browser execution belongs to the user.** The following commands are for the user, not assistant-side execution. The complete gate includes browsers; don't invoke it accidentally for a documentation check. Physical-device acceptance is separate. The existing automatic CI browser step is unchanged and must have its ownership reconciled during GitHub setup.

```bash
npx playwright install --with-deps chromium webkit
npm run verify
```

Gates run source ownership/integrity, checker regression tests, lint, strict TypeScript, Vitest, static export and Playwright. Browser matrix: desktop Chromium, phone WebKit and tablet WebKit, with no retries or skipped cases. See Journey for what actually ran in the provided environment.

## Preview behaviour

- Guest booking or simulated email verification. Demo code: `360360`. No email is sent.
- 40-minute sessions, start times every 50 minutes, 1–4 players, one shared studio.
- Multi-date selection followed by an instructor eligible for all selected times.
- Four preview instructors. Unsupplied instructor names are explicitly labelled demo and require client-approved content.
- Participant/guardian forms, review and payment acknowledgement.
- Payment preview includes success, decline, pending and late-payment controls. No money is collected.
- Confirmation, PDF download, Singapore-time calendar export and help links.
- Enquiry and customer assistant remain local simulations. No external submission, model call or message is made.
- Use synthetic test data. Demo session storage is not secure identity or authoritative provider state.

## Where to work

- Current architecture, product rules, future stack and guarded installer pattern: `docs/SOCCERBOT_RULES_AND_ARCHITECTURE.md`.
- Actual service signatures, results, errors and demo/live boundaries: `docs/SERVICE_CONTRACTS.md`.
- Decisions, exact inputs, verification and remaining gates: `docs/SOCCERBOT_JOURNEY.md`.
- `src/app`: routes and canonical global styles.
- `src/features`: React customer journeys.
- `src/domain`: booking/contact rules, dates and typed models.
- `src/services`: demo service interfaces, storage and exports; future Worker adapter composition point.
- `public/assets`: extracted original assets; attribution in `src/content/media.ts`.

These three Docs files are the canonical documentation owners. The architecture picture and current first-iteration audit are linked from Rules and Journey. This README is orientation only.

## Future guarded updates

Do not run the supplied Fitfinity installer against this project. `scripts/guarded-update.py` is a generic apply-only starting point for future candidate-specific updates. It requires a Git baseline and external candidate/manifest/log folders. It does not install dependencies, run tests or modify Git/cloud state.

```bash
python3 scripts/guarded-update.py make-manifest /absolute/repository /absolute/candidate /absolute/update.json
# Inspect the manifest before applying it.
python3 scripts/guarded-update.py apply /absolute/repository /absolute/update.json /absolute/logs
```

Do not point it at an unreviewed existing project. Unknown source changes, index/revision differences, symlinks, unsafe paths and incomplete candidates stop the update. A source-applied receipt does not mean tests or deployment passed.

Live booking/payment integration, Worker permissions, email delivery, monitoring, hosting and physical-device acceptance remain future work. The current build is noindex until a production-domain configuration is approved.

Next task: upload this initial frontend to the selected GitHub repository before further frontend work. It currently exists publicly; write access is not available through the connected installation. Resolve visibility/access and browser CI ownership at that step. The audit records remaining tooling and live-integration gaps; this package is a demo source checkpoint, not a production release.
