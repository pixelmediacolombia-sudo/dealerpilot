---
name: Sprint 4.8 Autonomous Publishing Engine
description: Schema, backend, codegen, and frontend for auto-publish batch creation, photo quality decisions, and vehicle selection logic.
---

## Key design decisions

**Photo quality scoring thresholds:**
- 80–100 → `use_original`
- 60–79 → `use_original_recommend_ai_cover`
- <60 → `generate_ai_creative`
- 0 or missing data → `needs_review`

**Vehicle selection filters (batch creation):** skips already published, already queued, sold/removed, missing VIN/price/mileage/year, <5 photos, no listing generated. Seed inventory only has 3 photos per vehicle, so batch creation always correctly rejects seed data with "Only 3 photo(s) — need at least 5".

**New DB tables:** `autoPublishSettings`, `publishingBatches`, `publishingEvents`, `vehiclePhotoScores`, `publishPriorityScores`. `publishingJobs` updated with `batchId`, `mode` (Assisted/Controlled), `listingUrl`, `needsReview`, `reviewReason`.

**Extension change:** `CLAIM_JOB` response now wrapped as `{ job }` (was direct object). `SEND_JOB_EVENT` handler added in background.js. Popup displays mode label.

**Frontend new components:** `AutoPublishPlan.tsx` (settings toggle + configure drawer), `BatchProgressCard.tsx` (live batch progress), `Listings/index.tsx` extended to 9 tabs (Ready/Generating/Scheduled/Publishing/Published/Needs Review/Failed/Queue/All) + photo quality badges per vehicle card.

**Why:** Slider + Switch components confirmed present in dashboard UI kit. `useListVehiclePhotoScores` and `useListPublishPriorityScores` both take optional `params?: { dealerId?: number }`.
