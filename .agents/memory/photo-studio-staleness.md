---
name: AI Photo Studio staleness pattern
description: How background-version staleness is detected and cheaply reprocessed without re-calling OpenAI/Fal.ai
---

## The rule
`ai_photo_sets.studioVersion` must match `ai_studio_packs.backgroundVersion` for a vehicle to be considered current. Any mismatch (or NULL studioVersion on old sets) means the vehicle is stale and needs re-compositing.

**Why:** When the studio background image changes, only the compositing stage (Stage 3+) needs to rerun. Classification (OpenAI) and background removal (Fal.ai) results are already good — re-running them wastes money.

## How to apply
- `ai_photo_jobs.sourceSetId` triggers "cheap reprocess" mode in `pipeline.ts`: the pipeline pre-loads `classificationJson` and `backgroundRemovedUrl` from the source set so Stages 1 and 2 skip their API calls entirely.
- `enqueue-all` (POST /photo-studio/enqueue-all) batch-loads latest set studioVersions for all Ready vehicles (one query, not N queries) before the loop, then passes `sourceSetId` for stale ones.
- `GET /api/photo-studio/stale-count` — returns count of Ready vehicles with stale/null studioVersion.
- `POST /api/photo-studio/reprocess-stale` — cancels existing Queued jobs, inserts new job with sourceSetId, resets aiPhotoStatus to Pending.
- Stats endpoint includes `staleCount` in its response so the dashboard can show the amber banner without a separate request.
- The amber stale banner on the dashboard auto-shows when `stats.staleCount > 0 && isBgConfigured`.

## Watch out
- After adding columns to a lib schema, run `pnpm run typecheck:libs` before leaf package typechecks — leaf packages see stale .d.ts files until the lib is rebuilt. This causes confusing "property does not exist" errors that look like code bugs but are actually stale declarations.
- All sets seeded before studioVersion was added will have `studioVersion = NULL`, so they'll all appear stale on first run — this is correct and intentional.
