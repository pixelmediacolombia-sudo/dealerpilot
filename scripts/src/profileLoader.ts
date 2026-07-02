// Loads the active photo quality profile from the database.
// Separated from photo-quality-evaluator.ts so the evaluator stays DB-free.
//
// Requires @workspace/db and drizzle-orm in scripts/package.json.

import { db, photoQualityProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { QualityProfile } from "./photo-quality-evaluator";
import { DEALER_LOT_FALLBACK } from "./photo-quality-evaluator";

export async function loadActiveProfile(): Promise<QualityProfile> {
  try {
    const rows = await db
      .select()
      .from(photoQualityProfilesTable)
      .where(eq(photoQualityProfilesTable.isActive, true))
      .limit(1);

    if (rows.length > 0) {
      const row = rows[0];
      return {
        id:                        row.id,
        name:                      row.name,
        description:               row.description,
        marketplaceReadyThreshold: row.marketplaceReadyThreshold,
        naturalnessThreshold:      row.naturalnessThreshold,
        artifactThreshold:         row.artifactThreshold,
        improvementDelta:          row.improvementDelta,
        isActive:                  row.isActive,
      };
    }

    console.warn("[photo-quality] No active profile in DB — using Dealer Lot Fallback");
    return DEALER_LOT_FALLBACK;
  } catch (err) {
    console.warn("[photo-quality] DB unavailable — using Dealer Lot Fallback:", err);
    return DEALER_LOT_FALLBACK;
  }
}
