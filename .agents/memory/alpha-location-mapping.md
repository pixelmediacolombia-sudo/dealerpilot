---
name: Alpha Motorsport location mapping
description: How Manassas vs Fredericksburg vehicle split is determined — the XML feed contains no location field; mapping comes from website scraping.
---

## The problem
The combined Facebook catalog XML feed (`/facebook-catalog-feed.xml`) exports 315 vehicles from BOTH Alpha Motorsport lots. Every vehicle in the feed has:
- Identical `<g:latitude>` / `<g:longitude>` (Fredericksburg coords)
- Identical `<g:dealer_phone>` (+15408914449, 540 area code)
- Identical `<g:address>` city = FREDERICKSBURG
- VDP URLs all contain `fredericksburg-virginia-22408`
- No `VehicleLocationID` or any other lot-discriminating field

The location split is managed entirely inside the **DealerCentric DMS** and is only exposed via the website's `?VehicleLocationID=` URL filter.

## The authoritative mapping
| VehicleLocationID | City | Count |
|---|---|---|
| 3004265 | Fredericksburg | ~196 |
| 3004268 | Manassas | ~119 |

Both are at `https://www.alphamotorsport.net/used-cars?VehicleLocationID=NNNNNN`.

## Stock number prefixes do NOT cleanly separate locations
Both locations contain SGF, CGF, BB, BBGF, S, C prefix stocks with interleaved number ranges. Stock prefix is NOT a reliable location discriminator.

## The solution: locationScraper.ts
`artifacts/api-server/src/inventory/locationScraper.ts` scrapes both location pages (paginating up to 8 pages each) on every feed sync to build a `stockNumber → city` map, then bulk-updates `vehicles.lot_location`.

- Called from `importFeed.ts` after the main import, gated on `dealerId === ALPHA_DEALER_ID`
- Tolerates scrape failures gracefully (logs warning, doesn't abort sync)
- Runs in ~3 seconds per sync (16 HTTP requests total)

## Correct filters
```typescript
import { ALPHA_DEALER_ID, ALPHA_LOT_MANASSAS, ALPHA_LOT_FREDERICKSBURG } from "../lib/dealer";

// All Alpha vehicles
eq(vehiclesTable.dealerId, ALPHA_DEALER_ID)

// Manassas only
and(eq(vehiclesTable.dealerId, ALPHA_DEALER_ID), eq(vehiclesTable.lotLocation, ALPHA_LOT_MANASSAS))

// Fredericksburg only
and(eq(vehiclesTable.dealerId, ALPHA_DEALER_ID), eq(vehiclesTable.lotLocation, ALPHA_LOT_FREDERICKSBURG))
```

**Why:** `ilike('%manassas%')` previously matched 0 rows (lot_location stored 'Alpha Motorsports' via xmlEngine bug, now 'Fredericksburg' from VDP URL fallback). After the scraper, lot_location is populated correctly by city name.

## xmlEngine lot_location bug (fixed)
The engine had `"dealername"` in its lot_location key lookup, which matched `<g:dealer_name>Alpha Motorsports</g:dealer_name>` before any VDP URL fallback ran. Fixed by removing `"dealername"` and adding `extractAddressCity()` to parse `<g:address><g:component name="city">`.
