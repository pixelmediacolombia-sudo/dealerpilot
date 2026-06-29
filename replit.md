# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

Marketplace AI — a standalone SaaS for an agency that manages Facebook Marketplace
listings and buyer conversations for car dealerships (first dealer: Alpha Motorsport).
Sprint 0 is a Chrome-extension technical spike: a web dashboard + a Chrome MV3
extension that fills test vehicle listings on Marketplace and suggests Messenger
replies, saving leads to a CRM. The extension never clicks Publish or Send.

### Where things live (Sprint 0)
- Architecture doc: `docs/marketplace-ai-architecture.md`
- Dashboard (web artifact): `artifacts/dashboard/` (previewPath `/`)
- Backend spike routes: `artifacts/api-server/src/routes/extension.ts`
- Leads (CRM) schema: `lib/db/src/schema/leads.ts`
- Chrome extension (load-unpacked): `chrome-extension/` (see its README for install + test checklist)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
