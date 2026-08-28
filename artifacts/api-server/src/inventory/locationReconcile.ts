import { db, vehiclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import { clearVerifiedFeedLotLocation, ALPHA_DEALER_ID, markVerifiedFeedLotLocation } from "../lib/dealer";
import { vehicleOperationalColumns } from "../lib/vehicleColumns";
import { scrapeAlphaLocationMapping } from "./locationScraper";

export type AlphaLocationReconciliation = {
  scrapedStocks: number;
  vehiclesChecked: number;
  verifiedManassas: number;
  verifiedFredericksburg: number;
  clearedStaleLocations: number;
};

/**
 * Reconcile Alpha's physical lot assignment from both public, location-
 * filtered inventory pages. This is deliberately fail-closed: if scraping
 * cannot complete or produces an ambiguous stock, no database update occurs.
 */
export async function reconcileAlphaLotLocations(
  log: Pick<Logger, "info" | "warn">,
  dealerId = ALPHA_DEALER_ID,
): Promise<AlphaLocationReconciliation> {
  if (dealerId !== ALPHA_DEALER_ID) {
    throw new Error(`Alpha lot reconciliation is not configured for dealer ${dealerId}`);
  }

  const mapping = await scrapeAlphaLocationMapping(log);
  if (mapping.size === 0) throw new Error("Alpha location scrape returned no vehicles");

  const scrapedByLocation = [...mapping.values()].reduce<Record<string, number>>((counts, location) => {
    counts[location] = (counts[location] ?? 0) + 1;
    return counts;
  }, {});
  log.info({ dealerId, scrapedStocks: mapping.size, scrapedByLocation }, "Alpha location crosswalk ready");

  const vehicles = await db
    .select(vehicleOperationalColumns)
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, dealerId));

  let verifiedManassas = 0;
  let verifiedFredericksburg = 0;
  let clearedStaleLocations = 0;

  await db.transaction(async (tx) => {
    log.info({ dealerId, vehiclesChecked: vehicles.length }, "Alpha location reconciliation database transaction starting");
    for (const vehicle of vehicles) {
      const stock = vehicle.stockNumber?.trim().toUpperCase();
      const location = stock ? mapping.get(stock) : undefined;
      const nextRaw = vehicle.sourceRaw
        ? location
          ? markVerifiedFeedLotLocation(vehicle.sourceRaw, location)
          : clearVerifiedFeedLotLocation(vehicle.sourceRaw)
        : vehicle.sourceRaw;
      const nextLot = location ?? null;

      if (vehicle.lotLocation === nextLot && vehicle.sourceRaw === nextRaw) continue;

      await tx
        .update(vehiclesTable)
        .set({ lotLocation: nextLot, sourceRaw: nextRaw })
        .where(eq(vehiclesTable.id, vehicle.id));

      if (location === "Manassas") verifiedManassas++;
      else if (location === "Fredericksburg") verifiedFredericksburg++;
      else clearedStaleLocations++;
    }
    log.info(
      { dealerId, verifiedManassas, verifiedFredericksburg, clearedStaleLocations },
      "Alpha location reconciliation database transaction ready to commit",
    );
  });

  const summary = {
    scrapedStocks: mapping.size,
    vehiclesChecked: vehicles.length,
    verifiedManassas,
    verifiedFredericksburg,
    clearedStaleLocations,
  };
  log.info(summary, "Alpha lot locations reconciled from official inventory pages");
  return summary;
}
