# SoccerBotStudioSG

Customer booking website built with Next.js, React and TypeScript, backed by Cloudflare Workers, D1 and an account Durable Object. SimplyBook owns bookings/invoices; the current developer payment integration uses HitPay sandbox. Client production migration remains pending.

## Start here

- [Architecture diagram](docs/Architecture/diagram.md) and [one-page explanation](docs/Architecture/README.md).
- [Service Contracts](docs/SERVICE_CONTRACTS.md): Part 1 current system rules; Part 2 dated changes and evidence.
- [AGENTS](AGENTS.md): engineering, cloud setup, verification and delivery instructions.
- [North Star](NORTH_STAR.md) and [Progress](PROGRESS.md): current goal and checkpoint, not additional rule/history owners.

## Development

Use the versions pinned by .nvmrc and package.json with the reviewed package-lock. npm run dev starts local development; npm run build creates out/ and npm run preview serves it locally. Current default base path is /SoccerBotStudioSG; root hosting requires its separately verified empty-prefix build. Repository/account portability is planned, not yet implemented.

npm run verify:code performs full non-browser checks; npm run verify:worker covers the isolated Worker runtime. Owner/CI runs npm run verify:browser or the combined npm run verify. Frontend/backend/live-email CI gates remain required. Only main deploys tested artifacts; provider and physical-device acceptance remain separate.

No secrets, raw HAR files or customer logs belong in the repository. Historical source-fingerprint/review-verification JSON files are immutable receipts, not current source inventories.
