---
name: Marketplace AI location filter
description: The vehicles.lot_location column is NULL for all Alpha Motorsport vehicles (the default Manassas lot). Any ilike filter on lot_location must include isNull() or it returns zero results.
---

## Rule
When filtering vehicles by lot location, always include `isNull(vehiclesTable.lotLocation)` alongside the `ilike` check:

```typescript
or(ilike(vehiclesTable.lotLocation, "%manassas%"), isNull(vehiclesTable.lotLocation))
```

**Why:** All 344 vehicles in the Alpha Motorsport feed have `lot_location = NULL` (the CDN feed omits this field). A pure `ilike` filter returns 0 vehicles and silently empties recommendations, KPIs, and any inventory views scoped by location.

**How to apply:** Any new route or query that filters by dealer location must use `or(ilike(...), isNull(...))` — never `ilike(...)` alone.
