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

DealerPilot AI — a standalone SaaS for an agency that manages Facebook Marketplace
listings and buyer conversations for car dealerships (first dealer: Alpha Motorsport).
Sprint 0 was a Chrome-extension technical spike: a web dashboard + a Chrome MV3
extension that fills test vehicle listings on Marketplace and suggests Messenger
replies, saving leads to a CRM. The extension never clicks Publish or Send.
Sprint 1 builds the XML inventory foundation: a flexible XML feed engine, delta
detection on sync, the Inventory Dashboard, Vehicle Detail, Connection Center, and
Settings (editable feed URL). Marketplace Publisher, Messenger AI, Dealer Brand DNA,
and AI Studio are intentionally "Coming Soon".

### Where things live (Sprint 0)
- Architecture doc: `docs/marketplace-ai-architecture.md`
- Dashboard (web artifact): `artifacts/dashboard/` (previewPath `/`)
- Backend spike routes: `artifacts/api-server/src/routes/extension.ts`
- Leads (CRM) schema: `lib/db/src/schema/leads.ts`
- Chrome extension (load-unpacked): `chrome-extension/` (see its README for install + test checklist)

### Where things live (Sprint 1)
- XML inventory engine + delta detection: `artifacts/api-server/src/inventory/` (`xmlEngine.ts`, `importFeed.ts`, `sampleFeed.ts`, `feedSource.ts`, `seed.ts`)
- Inventory/feed/connection routes: `artifacts/api-server/src/routes/{dealers,vehicles,connection,feed}.ts`
- Inventory schema: `lib/db/src/schema/` (dealers, feeds, feed_runs, vehicles, vehicle_images, vehicle_changes, listings, extension_connections)
- Inventory UI: `artifacts/dashboard/src/pages/{Inventory,Settings,ConnectionCenter}/`
- Dealer inventory is seeded on API-server startup via `seedDealerAndInventory` (two-pass import for realistic change history)
- Sample feed is served at `GET /api/sample-feed`; the dealer's feed URL is editable in Settings

### Where things live (Worker Framework v1.0)
- Worker framework core: `artifacts/api-server/src/workers/` (`types.ts`, `registry.ts`, `timeline.ts`, `scheduler.ts`, `index.ts`, `costGuardrail.ts`)
- 6 worker wrappers: `workers/{inventory,opportunity,market,photo,publishing,learning}.worker.ts` — each reuses an existing engine (inventory sync, opportunity engine, market scan, photo auto-enqueue, autoPublish, learning calibration check) rather than duplicating logic
- Schema: `lib/db/src/schema/` (worker_runs, worker_state, system_timeline_events)
- API: `GET /api/workers` (status list), `POST /api/workers/:id/run` (manual trigger), `GET /api/workers/timeline` (event feed) — `routes/workers.ts`
- Dashboard panel: "AI Workers" / Background Workers card in `artifacts/dashboard/src/pages/ConnectionCenter/index.tsx` (`AiWorkersPanel`), polls every 15s, includes per-worker "Run now" and a Recent Activity feed
- Started via `startWorkers(logger)` in `index.ts`, after `startPhotoWorker` (which is a separate, pre-existing job *processor* — unrelated to the new 15-min photo *enqueue* worker)
- Cost guardrail: `WORKER_DAILY_FAL_BUDGET_USD` (default $10) and `WORKER_PHOTO_MAX_VEHICLES_PER_RUN` (default 5) env vars cap AI photo spend per run/day
- Separate `WORKER_DAILY_OPENAI_BUDGET_USD` (default $1) guardrail enforces OpenAI classification spend **per image** (not per vehicle/job): `ai_usage_events` table logs one row per real `classify()` call; `checkOpenAiBudget()`/`recordOpenAiClassification()` in `costGuardrail.ts` are called inside the per-image loop in `photo/stages/1_classify.ts`, falling back to "Miscellaneous" (no API call, no crash) once exhausted. FAL and OpenAI budgets are tracked and enforced independently. `GET /api/workers` also returns `todayOpenAISpendEstimate`/`todayFALSpendEstimate`/`openAIBudgetRemaining`/`falBudgetRemaining`, surfaced in the Background Workers dashboard panel.
- Generic catch-up scheduling (`scheduleWithCatchup` in `workers/index.ts`) drives all 6 workers off `worker_state`, replacing the old bespoke `startInventoryScheduler` catch-up logic (removed from `inventory/scheduler.ts`, which still exposes `runSyncNow`/`setNextSyncAt`/`getNextSyncAt` for the existing UI)

### Where things live (AI Orchestrator v1.0)
- Orchestrator core: `artifacts/api-server/src/workers/orchestrator.ts` — per-worker `decide*()` functions (dependency/change/budget-aware RUN/SKIP/PAUSE rules), `decideAll()`, `runOrchestrationCycle(log, trigger)` (delegates RUN decisions to `runWorkerOnce` from `scheduler.ts`, logs SKIP/PAUSE to the System Timeline, upserts `orchestrator_state`, never throws), `getOrchestratorStatus()` (read-only, never throws)
- Schema: `orchestrator_state` (single-row: id, lastDecisionAt, lastDecisionJson, status, timestamps) in `lib/db/src/schema/`
- API: `GET /api/orchestrator/status` (read-only snapshot), `POST /api/orchestrator/run` (manual cycle trigger) — `routes/orchestrator.ts`
- Replaces the old per-worker `scheduleWithCatchup` timers in `workers/index.ts`: a single 5-min interval (matching the shortest worker interval) calls `runOrchestrationCycle` on a startup catch-up + timer; manual per-worker `POST /api/workers/:id/run` is untouched
- Dashboard panel: "AI Orchestrator" card in `artifacts/dashboard/src/pages/ConnectionCenter/index.tsx` (`AiOrchestratorPanel`), above the existing "AI Workers" panel; polls every 15s, shows Active/Sleeping/Failed status, last decision time, running/skipped/paused counts, FAL/OpenAI budget remaining, extension online/offline, and the per-worker decision list with reasons
- Does not call OpenAI/FAL directly or create new workers — reuses `checkOpenAiBudget`/`checkFalBudget` from `costGuardrail.ts` and `runWorkerOnce` from `scheduler.ts` for actual execution

### Where things live (Sprint 4 — Creative Intelligence Engine)
- Creative engine: `artifacts/api-server/src/creative/` (`pipeline.ts`, `scoring.ts`, `worker.ts`, `templates.ts`, `seed.ts`)
- Creative routes: `artifacts/api-server/src/routes/creative.ts`
- Creative schema: `lib/db/src/schema/` (dealer_brand_dna, creative_templates, creative_versions, creative_scores, creative_jobs)
- Creative UI: `artifacts/dashboard/src/pages/{CreativeStudio,DealerDna}/` + shared `components/CreativePreview.tsx`
- In-process background worker started in `index.ts`; generates versioned, scored creatives from Dealer Brand DNA
- Image transforms are PLACEHOLDER/pluggable: a real provider fills `outputs[].url` from `renderSpec` with no DB/UI change (previews render from `renderSpec` via CSS)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
