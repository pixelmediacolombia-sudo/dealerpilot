---
name: Sprint 10 Inventory Engine
description: Meta catalog adapter, 24h auto-sync scheduler, feed health endpoint, shared component prop naming.
---

## Architecture

- **Meta catalog generator**: `artifacts/api-server/src/channels/metaCatalog.ts` — exports `generateMetaCatalogXml`, `generateMetaCatalogCsv`, `validateMetaCatalog`, `computeFeedHealth`. Single file for all channel output logic.
- **Scheduler**: `artifacts/api-server/src/inventory/scheduler.ts` — `startInventoryScheduler(log)` wires up a 24h setTimeout loop; `getNextSyncAt()` returns the next scheduled date for the health endpoint. Called last in the seed chain in `index.ts`.
- **Routes**: `GET /api/inventory/health` is in `routes/feed.ts`; `GET /api/channels/meta-catalog/feed.xml`, `feed.csv`, `diagnostics` are in `routes/channels.ts`.
- **Dashboard page**: `/inventory-engine` → `artifacts/dashboard/src/pages/InventoryEngine/index.tsx`.

## Shared component prop names (critical — wrong names cause silent TS errors)

- `PageHeader`: `action` (not `actions`), `subtitle` ✓
- `SectionCard`: `description` (not `subtitle`), `action` (not `headerRight`)
- `KpiCard`: `valueColor` (not `valueClass`), `accentColor` ("blue"|"green"|"orange"|"purple")

**Why:** These components were authored earlier in the project with these exact names. Using the wrong names produces TS2322 type errors.

## Feed health scoring (as of Sprint 10)

Score starts at 100:
- Missing price vehicles: −2 each, max −20
- Missing image vehicles: −2 each, max −25
- Duplicate VINs: −5 each, max −20
- Latest feed run failed: −15
- No feed URL: −20

Status: ≥80 → Healthy, 60–79 → Needs Attention, <60 → Critical

## Meta catalog active statuses

Only vehicles in `["New", "Active", "Price Changed", "Ready to Publish", "Published"]` are exported to the Meta feed. "Sold/Removed" and "Archived" are excluded.

## Acceptance test results (Sprint 10 live)

- 319 active vehicles, 5917 total photos, avg 18.5 photos/vehicle
- Health score: 90 (Healthy)
- Scheduler: nextSyncAt 24h from API server startup
- XML and CSV feeds confirmed working via curl
