---
name: Meta AIA Feed Spec
description: Exact field names, enum values, and XML/CSV format for Meta Automotive Inventory Ads (AIA) feeds — from the official reference page (Jun 24, 2026).
---

# Meta Automotive Inventory Ads — Feed Spec (Jun 24, 2026)

Source: https://developers.facebook.com/documentation/ads-commerce/marketing-api/auto-ads/reference

## XML Format
- Root: `<listings>` / `<listing>` (NOT RSS)
- No CDATA — use XML-escaped plain text for all text fields
- Element order follows official sample: vehicle_id, title, description, url, make, [image…], model, year, mileage, vin, body_style, condition, price, address, exterior_color, availability, state_of_vehicle, [optional…]

## Required Fields
- vehicle_id, title, description, url, make, model, year
- mileage.value (int; 0 for new), mileage.unit (MI or KM)
- image[0].url (at least 1 required)
- body_style (see enum below) — REQUIRED
- exterior_color — REQUIRED
- state_of_vehicle (see enum below) — REQUIRED
- price ("18000 USD" format)
- address (XML: `<address format="simple"><component name="addr1">`, CSV: JSON object)
- latitude, longitude

## Enum Values — EXACT CASE from spec

| Field | Valid Values |
|---|---|
| state_of_vehicle | `New`, `Used`, `CPO` (title-case) |
| availability | `available`, `not_available` (lowercase) |
| condition | `EXCELLENT`, `GOOD`, `FAIR`, `POOR`, `OTHER` (uppercase) |
| fuel_type | `DIESEL`, `ELECTRIC`, `FLEX`, `GASOLINE`, `HYBRID`, `OTHER` (uppercase; NO PETROL/PLUGIN_HYBRID/NONE in feed spec) |
| transmission | `Automatic`, `Manual` only (title-case; no NONE/OTHER) |
| body_style | `CONVERTIBLE`, `COUPE`, `HATCHBACK`, `MINIVAN`, `TRUCK`, `SUV`, `SEDAN`, `VAN`, `WAGON`, `CROSSOVER`, `SMALL_CAR`, `OTHER` (no PICKUP — use TRUCK) |
| drivetrain | `4X2`, `4X4`, `AWD`, `FWD`, `RWD`, `Other` (NOT TWO_WD/FOUR_WD) |

**Why:** The feed-level enum values differ from the Graph API enum values. The reference page says "case-insensitive" but Meta's parser may flag mismatches as "unsupported enum" recommendations. Use spec-exact case to avoid warnings.

## CSV Format
- address column: JSON object `{addr1: '...', city: '...', region: '...', postal_code: '...', country: '...'}`
- images: flat columns `image[0].url`, `image[1].url`, ... `image[19].url`
- Optional columns to include: trim, interior_color, dealer_id, dealer_name

## Address Format
- XML: `<address format="simple"><component name="addr1">` (not `street_address`)
- Component names: addr1, city, region, postal_code, country
- "addr1" is what Meta calls "street_address" in error messages

## Notes
- spec says "All enum-typed fields in the supported-fields tables below are case-insensitive" — but use spec-exact case anyway to avoid "unsupported enum" recommendations
- "Website link missing" error = `<url>` field empty/missing (not `<link>` or `<website_link>`)
- "street_address missing" error = `<component name="addr1">` empty/missing
- CDATA in XML is valid but NOT used in Meta's own samples — use escapeXml() instead
- mileage.value must be 0 for new vehicles per spec
