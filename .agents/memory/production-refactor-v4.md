---
name: Production Refactor v4.0
description: What changed when stripping demo/prototype artifacts and going production-clean.
---

## What was removed

- **Fake listing_performance records** — intelligence/seed.ts used to generate 1–3 random historical performance records per vehicle (random conversation counts, hot lead counts, outcome scores). These are GONE. The seed now derives strategy purely from vehicle attributes (type, price, make) with static global timing defaults (Saturday 6pm).
- **Simulator tab in Sales AI** — the `/simulator/run` and `/simulator/scenarios` routes still exist in the backend (dev use), but are no longer wired into any dashboard UI.
- **Down Payment Intel tab in Sales AI** — removed from the main Sales AI page.
- **Fake conversations / leads / down_payment_intelligence** — cleared from DB: 4 conversations, 5 leads, 684 listing_performance records.
- **Sample vehicle images** — `artifacts/dashboard/public/sample-vehicles/` (10 fake vehicle images) deleted.
- **`/creative-studio` list redirect** — the redirect from `/creative-studio` → `/ai-photo-studio` is kept but the unused `CreativeStudio` list page import was removed from App.tsx. `/creative-studio/:id` (detail view) is kept.

## Intelligence seed refactor

- `intelligence/seed.ts` no longer imports `listingPerformanceTable` or `type ListingPerformance`.
- Uses a local `VehiclePerfRecord` type for the `generateVehicleStrategy` signature.
- The seed gate now checks `vehicleIntelligenceTable` row count (not listing_performance) to detect "already seeded."
- `avg` helper kept as a local function (used by the strategy engine for zero-history branching).

## Sales AI page (/sales-ai)

- Complete rewrite as Marketplace CRM.
- 4 sections: **New Messages** (unread > 0), **Needs Follow-Up** (messages received, unread = 0, not sold/appointment), **Appointments** (status = "Appointment"), **Sold** (status = "Sold").
- Data source: `GET /api/marketplace-listings?dealerId=1` — no conversations/leads API calls.
- Empty states: "No listings yet" (no marketplace_listings rows), "Waiting for messages" (listings exist but 0 engagement), then the 4 sections.
- `PATCH /api/marketplace-listings/:id` now accepts `status: "Appointment"` (added to enum).

## What KEEPS running

- Simulator backend routes (`/api/simulator/*`) — useful for dev testing, just not in the UI.
- `CreativeDetail` at `/creative-studio/:id` — still active for photo review.
- Strategy recommendations (vehicle_intelligence) — kept, they're algorithmic not fake.

**Why:** Production SaaS must not show fake data to real dealer clients. All "Run simulator" copy and random seed data was a prototype artifact.
