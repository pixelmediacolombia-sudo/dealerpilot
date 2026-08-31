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

export const ALPHA_MARKETPLACE_KNOWLEDGE = {
  es: {
    address: "9120 Euclid Ave, Manassas, VA 20110",
    phone: "+1 703-763-4675",
    hours: "lunes a sábado de 9:00am a 8:00pm; domingo de 10:00am a 4:00pm",
    title: "Todos nuestros vehículos son de título limpio",
    testDrive: "Sí, con licencia de conducir vigente",
    tradeIn: "Sí, recibimos su carro como parte de pago",
    payment: "Contado y financiamiento",
    financingRequirements: "Identificación, Tax ID, Social o pasaporte; comprobante de ingresos: cuenta bancaria activa, talones de pago o carta laboral",
    citizenRequirements: "Ciudadanos americanos: Social o identificación y cuenta bancaria",
    carfax: "Nuestros agentes de ventas tienen el reporte Carfax",
    warranty: "Los detalles de la garantía los manejan nuestros agentes de ventas",
  },
  en: {
    address: "9120 Euclid Ave, Manassas, VA 20110",
    phone: "+1 703-763-4675",
    hours: "Monday-Saturday 9:00am-8:00pm; Sunday 10:00am-4:00pm",
    title: "All our vehicles have a clean title",
    testDrive: "Yes, with a valid driver's license",
    tradeIn: "Yes, we take trade-ins",
    payment: "Cash and financing",
    financingRequirements: "ID: driver's license, Tax ID, Social Security or passport. Proof of income: active bank account, pay stubs or employment letter",
    citizenRequirements: "American citizens: Social Security or ID and a bank account",
    carfax: "Our sales agents have the Carfax report",
    warranty: "Our sales agents handle the warranty details",
  },
} as const;

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
      ([key]) => {
        const localKey = key.includes(":") ? key.slice(key.lastIndexOf(":") + 1) : key;
        return localKey.toLowerCase().replace(/[^a-z0-9]/g, "") === "dealerid";
      },
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
