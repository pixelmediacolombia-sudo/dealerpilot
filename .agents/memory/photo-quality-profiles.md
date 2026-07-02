---
name: Photo Quality Profiles — Phase 1.5
description: Profile-driven photo quality scoring system — architecture decisions and gotchas.
---

## Key decisions

**Evaluator stays DB-free.** `photo-quality-evaluator.ts` defines its own `QualityProfile` interface (compatible with the DB type) and exports `DEALER_LOT_FALLBACK`. All DB calls live in `profileLoader.ts`. This lets the evaluator work in test/offline contexts without importing drizzle.

**Profile is always a required param.** `evaluatePhotoQuality(origBuf, enhBuf, type, label, caption, profile)` — no optional/auto-load inside the evaluator. Callers load the profile once at the top of their `run()` and pass it in.

**Why:** scripts `tsconfig.json` has `rootDir: "src"`, so any import that pulls in `@workspace/db` or `drizzle-orm` from inside the evaluator triggers TS6059 cross-rootDir errors. Separating DB loading avoids this.

## 5-tier rating scale (absolute, not profile-relative)

| Rating       | Score |
|--------------|-------|
| Excellent    | ≥ 90  |
| Good         | ≥ 80  |
| Acceptable   | ≥ 70  |
| Needs Review | ≥ 60  |
| Rejected     | < 60  |

Ratings appear on both original and enhanced scores per dimension, and on overall scores. Gate fail reasons include the rating label.

## Seeded profiles (in `photo_quality_profiles` table)

| id | name                    | MR  | Nat | Art | Δ  | active |
|----|-------------------------|-----|-----|-----|----|--------|
| 1  | Dealer Lot Photography  | 78  | 70  | 65  | 5  | true   |
| 2  | Professional Studio     | 85  | 85  | 85  | 5  | false  |

Seeder: `artifacts/api-server/src/photo/seedProfiles.ts` — called in startup chain after `seedAiStudio`.

## scripts/package.json dependencies needed

- `@workspace/db: workspace:*` — for profileLoader.ts DB query
- `drizzle-orm: catalog:` — for `eq` import in profileLoader.ts

## Phase 1.5 test results (Dealer Lot Photography profile, overlay photos)

9/15 pass, 6/15 fail, avg +7.2 pts improvement across 5 vehicles / 15 photos.
Most failures: interior photos (Naturalness, Marketplace Ready borderline) or low delta (<+5).
