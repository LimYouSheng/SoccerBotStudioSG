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

For a local live frontend build, supply the public `NEXT_PUBLIC_TURNSTILE_SITE_KEY` through your shell or an ignored `.env.local` file. The `live-email` CI job supplies this build-time value in `.github/workflows/verify.yml`; client setup must supply the client's public widget key. Cloudflare Worker secrets separately hold the private `TURNSTILE_SECRET_KEY` and provider credentials; setting Worker secrets does not configure the static frontend build. Default local development remains demo; live builds require their own verification.

No secrets, raw HAR files or customer logs belong in the repository. [Historical verification receipts](https://github.com/LimYouSheng/SoccerBotStudioSG/tree/d7a8d2b209b535d23a62702e4d59538e00a47012/docs) remain in Git history, not current source inventories.
