/**
 * Canonical dealer constants for DealerPilot AI.
 *
 * lot_location for dealer_id = 1 (Alpha Motorsport) is populated from the
 * feed's physical city and, when available, the website's
 * VehicleLocationID-filtered stock crosswalk. The XML dealer_id is a
 * dealership-level identifier, not a branch identifier.
 *
 * The active Alpha Motorsports location is Manassas only.
 *
 * Scope rules:
 *   - Active dealer scope  → eq(vehiclesTable.dealerId, ALPHA_DEALER_ID)
 *   - Manassas only        → and(eq(vehiclesTable.dealerId, ALPHA_DEALER_ID), eq(vehiclesTable.lotLocation, ALPHA_LOT_MANASSAS))
 */

export const ALPHA_DEALER_ID = 1;
export const ALPHA_DEALER_LABEL = "Alpha Motorsport";
/** Current Alpha dealership identifier emitted by the Facebook catalog feed. */
export const ALPHA_FEED_DEALER_ID = "DC1786";

export const ALPHA_LOT_MANASSAS = "Manassas";

/** DealerCentric VehicleLocationID → city name (used by locationScraper.ts) */
export const ALPHA_VEHICLE_LOCATION_IDS: Record<string, string> = {
  "3004268": ALPHA_LOT_MANASSAS,
  "3004265": "Fredericksburg",
};

/** Read the raw catalog dealer_id retained in vehicles.source_raw. */
export function getFeedDealerId(sourceRaw: string | null | undefined): string | null {
  if (!sourceRaw) return null;
  try {
    const parsed = JSON.parse(sourceRaw) as Record<string, unknown>;
    const raw = Object.entries(parsed).find(
      ([key]) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === "dealerid",
    )?.[1];
    return raw === null || raw === undefined || String(raw).trim() === "" ? null : String(raw).trim();
  } catch {
    return null;
  }
}

/** Internal provenance marker written only after the branch crosswalk passes. */
export function getVerifiedFeedLotLocation(sourceRaw: string | null | undefined): string | null {
  if (!sourceRaw) return null;
  try {
    const parsed = JSON.parse(sourceRaw) as Record<string, unknown>;
    const value = parsed.dealerpilot_lot_location;
    return value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim();
  } catch {
    return null;
  }
}

export function markVerifiedFeedLotLocation(sourceRaw: string, lotLocation: string): string {
  try {
    const parsed = JSON.parse(sourceRaw) as Record<string, unknown>;
    parsed.dealerpilot_lot_location = lotLocation;
    return JSON.stringify(parsed);
  } catch {
    return sourceRaw;
  }
}

export function clearVerifiedFeedLotLocation(sourceRaw: string): string {
  try {
    const parsed = JSON.parse(sourceRaw) as Record<string, unknown>;
    delete parsed.dealerpilot_lot_location;
    return JSON.stringify(parsed);
  } catch {
    return sourceRaw;
  }
}

/** A vehicle is safe for Alpha's current Manassas-only workflow only when
 * the internal dealer, catalog dealer, and physical lot are all known. */
export function isAlphaManassasVehicle(vehicle: {
  dealerId: number;
  lotLocation: string | null;
  sourceRaw?: string | null;
}): boolean {
  return (
    vehicle.dealerId === ALPHA_DEALER_ID &&
    vehicle.lotLocation === ALPHA_LOT_MANASSAS &&
    getVerifiedFeedLotLocation(vehicle.sourceRaw) === ALPHA_LOT_MANASSAS &&
    getFeedDealerId(vehicle.sourceRaw) === ALPHA_FEED_DEALER_ID
  );
}
