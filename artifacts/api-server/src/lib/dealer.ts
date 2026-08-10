/**
 * Canonical dealer constants for DealerPilot AI.
 *
 * lot_location for dealer_id = 1 (Alpha Motorsport) is populated by scraping
 * the website's VehicleLocationID-filtered pages on each feed sync.
 * The XML feed itself contains NO location discriminator — all 315 vehicles
 * share the same dealer address, phone, and lat/lon in the feed.
 *
 * The active Alpha Motorsports location is Manassas only.
 *
 * Scope rules:
 *   - Active dealer scope  → eq(vehiclesTable.dealerId, ALPHA_DEALER_ID)
 *   - Manassas only        → and(eq(vehiclesTable.dealerId, ALPHA_DEALER_ID), eq(vehiclesTable.lotLocation, ALPHA_LOT_MANASSAS))
 */

export const ALPHA_DEALER_ID = 1;
export const ALPHA_DEALER_LABEL = "Alpha Motorsport";

export const ALPHA_LOT_MANASSAS = "Manassas";

/** DealerCentric VehicleLocationID → city name (used by locationScraper.ts) */
export const ALPHA_VEHICLE_LOCATION_IDS: Record<string, string> = {
  "3004268": ALPHA_LOT_MANASSAS,
};
