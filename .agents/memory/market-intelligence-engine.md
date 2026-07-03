---
name: Market Intelligence Engine v1.0
description: Opportunity scoring engine — 7 sub-scores weighted into 0–100 Opportunity Score per vehicle; stored in vehicle_intelligence table.
---

# Market Intelligence Engine v1.0

## Architecture

Opportunity scores are stored as new columns on the existing `vehicle_intelligence` table (not a new table). Columns added: `opportunityScore`, `marketDemandScore`, `priceScore`, `seasonalScore`, `dealerPerformanceScore`, `buyerDemandScore`, `inventoryHealthScore`, `creativePerformanceScore`, `pricingPosition`, `daysOnLot`, `opportunityFactors` (JSON text).

## Scoring weights
- Market Demand: 30%
- Price: 20%
- Dealer Performance: 15%
- Seasonal: 10%
- Buyer Demand: 10%
- Inventory Health: 10%
- Creative Performance: 5%

## Key design decisions

**Score ceiling at fresh inventory**: With no listing history (dealer performance = 55 baseline), no conversations (buyer demand = 50 baseline), and fresh inventory < 15 days (inventory health = 45), the theoretical max score is ~79. Score exceeds 80 once real performance data flows in. "Hot" threshold set to 75 (not 80) for fresh dealers.

**Price medians computed from own inventory**: No external market data API needed. `computePriceMedians()` groups by make:model and computes median from the dealer's own inventory. For vehicles with no comparables, price score defaults to 60 (Market Average).

**Days on lot** uses `firstSeenAt` from vehicles table. For seeded inventory this is ~the import date, not real lot arrival date — all seeded vehicles show ~3 days. Real data will age naturally.

**Seed is idempotent per version**: Checks if `opportunityScore IS NULL` for any vehicle. If any are null, re-runs the full opportunity seed. Strategy seed (V2_MARKER) still uses its own skip check separately.

**Creative scores**: `creativeScoresTable.overall` (not `overallScore`) is the correct field name.

## Files
- Engine: `artifacts/api-server/src/intelligence/opportunityEngine.ts`
- Seed: `artifacts/api-server/src/intelligence/seed.ts` → `seedOpportunityScores()`
- API endpoint: `GET /api/marketplace-intelligence/opportunity`
- UI page: `artifacts/dashboard/src/pages/MarketplaceIntelligence/index.tsx`
- Route: `App.tsx` `/marketplace-intelligence` → `MarketIntelligencePage`

## API response shape
`{ vehicles[], insights, sections: { hot, cooling, competitive, byLot, bodyTypeTrend } }`
