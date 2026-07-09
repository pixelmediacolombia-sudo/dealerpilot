---
name: Marketplace Demand Engine v1
description: 12-signal composite score replacing pure Opportunity Score; durable ranking rule and pitfalls.
---

# Marketplace Demand Engine v1

## Rule
`demandScore` is the primary ranking metric everywhere (opportunity worker, `/opportunity` endpoint, `/recommendations` endpoint). `opportunityScore` is one of the 12 inputs at ~20% weight, not the final sort key.

**Why:** Pure Opportunity Score ignored Marketplace-specific signals — Latino buyer preference, body-type popularity, financing tier fit, historical engagement, and duplicate saturation. The 12-signal composite is calibrated continuously from published listing outcomes.

**How to apply:** Any new sort or ranking of vehicles for publishing recommendations must sort by `coalesce(demandScore, opportunityScore)` not bare `opportunityScore`.

## Pitfalls
- **`coalesce` is not a named export from drizzle-orm** — use `` sql`coalesce(${col1}, ${col2})` `` not `import { coalesce } from "drizzle-orm"`.
- `seedOpportunityScores` accepts `opts?: { forceRefresh?: boolean; force?: boolean }` — both styles are valid; use `opts?.forceRefresh ?? opts?.force ?? false` when reading the flag.
- Weight learning reads `lastResultJson.detail.demandWeights` from `worker_state` for the `learning` worker; falls back to `DEFAULT_DEMAND_WEIGHTS` (`"v1.0-default"`) before first learning run.
- All 9 demand columns are already in the live DB (`demand_score` through `demand_weights_version`) — no migration needed.
