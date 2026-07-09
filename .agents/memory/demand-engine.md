---
name: Marketplace Demand Engine v1
description: 12-signal composite score that replaces pure Opportunity Score ranking; architecture, weights, DB columns, and key pitfalls.
---

# Marketplace Demand Engine v1

## Rule
`demandScore` is the primary ranking metric everywhere (opportunity worker, `/opportunity` endpoint, `/recommendations` endpoint). `opportunityScore` is one of the 12 inputs at ~20% weight, not the final sort key.

**Why:** Pure Opportunity Score ignored Marketplace-specific signals — Latino buyer preference, body-type popularity, financing tier fit, historical engagement, and duplicate saturation. The 12-signal composite is calibrated continuously from published listing outcomes.

**How to apply:** Any new sort or ranking of vehicles for publishing recommendations must sort by `coalesce(demandScore, opportunityScore)` not bare `opportunityScore`.

## 12 Signals & Default Weights (v1.0-default)
| Signal | Weight |
|---|---|
| opportunityScore | 20% |
| marketplaceDemand (body-type avg outcome) | 18% |
| vehicleSegmentDemand (buyer segment score) | 12% |
| latinoBuyerPreference | 10% |
| financingProbability (price tier) | 8% |
| historicalConversations | 8% |
| historicalAppointments | 6% |
| historicalSales | 5% |
| daysInInventory (inverse aging) | 5% |
| priceCompetitiveness (price score) | 4% |
| duplicateSaturation (inverse) | 2% |
| seasonalDemand (seasonal score) | 2% |

## Key Files
- Engine: `artifacts/api-server/src/intelligence/demandEngine.ts` — `computeDemandScores()`, `calibrateDemandWeights()`, `DEFAULT_DEMAND_WEIGHTS`, `DEMAND_WEIGHTS_VERSION`
- DB schema: `lib/db/src/schema/vehicleIntelligence.ts` — 9 demand columns: `demandScore`, `demandLabel`, `demandFactors`, `marketplacePopularityScore`, `latinoPreferenceScore`, `financingProbabilityScore`, `historicalEngagementScore`, `duplicateSaturationScore`, `demandWeightsVersion`
- Seed: `artifacts/api-server/src/intelligence/seed.ts` — calls `computeDemandScores()` per vehicle after `computeOpportunityScores()`; reads learned weights from `worker_state` where `workerId='learning'` at `lastResultJson.detail.demandWeights`
- Worker: `artifacts/api-server/src/workers/learning.worker.ts` — calibrates weights via EMA; `artifacts/api-server/src/workers/opportunity.worker.ts` — ranks by `demandScore DESC`

## Pitfalls
- **`coalesce` is not a named export from drizzle-orm** — use `sql\`coalesce(${col1}, ${col2})\`` not `import { coalesce } from "drizzle-orm"`.
- `duplicateConflictCount` is hardcoded to 0 in seed.ts — market scan worker integration is a future task.
- Weight learning reads `lastResultJson.detail.demandWeights` from `worker_state`; if the learning worker hasn't run yet, `DEFAULT_DEMAND_WEIGHTS` applies (version string `"v1.0-default"`).
- The API server must be restarted after route changes (it's esbuild-compiled, not hot-reloaded like Vite).
