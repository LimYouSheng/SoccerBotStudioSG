# SoccerBotStudioSG

Development entry point for the SoccerBotStudioSG customer booking website. See [AGENTS](AGENTS.md#authority-and-document-ownership) for the document map and engineering instructions.

## Development setup

Use Node/npm pinned by `.nvmrc` and `package.json`, Python 3.11+ and Git. On initial setup, install the reviewed lockfile with `npm ci`; routine work reuses matching dependencies and browser caches. Browser dependencies are installed deliberately by the owner or CI.

`npm run dev` starts local development; `npm run build` creates `out/`; `npm run preview` serves that export locally. The default base path is `/SoccerBotStudioSG`; root hosting uses a separately verified empty-prefix build. Client provisioning and portability requirements live in [Service Contracts](docs/SERVICE_CONTRACTS.md#deployment-migration-and-acceptance).

## Verification commands

| Command                                     | Scope                                                           |
| ------------------------------------------- | --------------------------------------------------------------- |
| `npm run check:source` / `check:policy`     | Source ownership, imports and configuration policy.             |
| `npm run check:tooling` / `check:installer` | Tooling and guarded installer regression checks.                |
| `npm run verify:code`                       | Full non-browser application/tooling checks, build and export.  |
| `npm run verify:worker`                     | Isolated Worker types and runtime suite.                        |
| `npm run verify:browser`                    | Browser suite operated by owner/CI under AGENTS.                |
| `npm run verify`                            | Combined application/browser verification operated by owner/CI. |

## Configuration

For a local live frontend build, supply the public `NEXT_PUBLIC_TURNSTILE_SITE_KEY` through your shell or an ignored `.env.local` file. The `live-email` CI job supplies this build-time value in `.github/workflows/verify.yml`; client setup must supply the client's public widget key. Cloudflare Worker secrets separately hold the private `TURNSTILE_SECRET_KEY` and provider credentials; setting Worker secrets does not configure the static frontend build. Default local development remains demo; live builds require their own verification.

[Historical verification receipts](https://github.com/LimYouSheng/SoccerBotStudioSG/tree/d7a8d2b209b535d23a62702e4d59538e00a47012/docs) remain in Git history, not current source inventories.
