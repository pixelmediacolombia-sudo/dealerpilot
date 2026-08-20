import {
  db,
  listingsTable,
  marketplaceListingsTable,
  publishingJobsTable,
  systemTimelineEventsTable,
  vehiclesTable,
} from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { ACTIVE_PUBLISHING_JOB_STATUSES } from "../publishing/controlledMode";

export type SoldStateSource = "inventory_sync" | "manual";

/** Moves DealerPilot records into the Facebook sold-action queue. */
export async function syncSoldMarketplaceState(
  vehicleIds: number[],
  source: SoldStateSource,
): Promise<{ marketplaceUpdated: number; listingsUpdated: number; jobsCancelled: number }> {
  if (vehicleIds.length === 0) {
    return { marketplaceUpdated: 0, listingsUpdated: 0, jobsCancelled: 0 };
  }

  const now = new Date();
  const note =
    "DealerPilot inventory marked this vehicle sold; extension should mark the Facebook Marketplace listing as Sold.";

  await db
    .update(vehiclesTable)
    .set({ soldAt: now, soldDetectionSource: source, status: "Sold/Removed" })
    .where(and(inArray(vehiclesTable.id, vehicleIds), ne(vehiclesTable.status, "Archived")));

  const marketplaceRows = await db
    .update(marketplaceListingsTable)
    .set({ status: "Sold", notes: note, updatedAt: now })
    .where(
      and(
        inArray(marketplaceListingsTable.vehicleId, vehicleIds),
        ne(marketplaceListingsTable.status, "Sold"),
      ),
    )
    .returning({ id: marketplaceListingsTable.id, vehicleId: marketplaceListingsTable.vehicleId });

  const listingRows = await db
    .update(listingsTable)
    .set({ status: "Sold", updatedAt: now })
    .where(and(eq(listingsTable.channel, "marketplace"), inArray(listingsTable.vehicleId, vehicleIds)))
    .returning({ id: listingsTable.id });

  const cancelledJobs = await db
    .update(publishingJobsTable)
    .set({
      status: "Cancelled",
      failedReason: "Vehicle marked Sold/Removed in DealerPilot inventory.",
      currentStep: "Cancelled - vehicle sold",
      claimedByExtension: null,
      assignedExtensionId: null,
      assignedAt: null,
    })
    .where(
      and(
        inArray(publishingJobsTable.vehicleId, vehicleIds),
        inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
      ),
    )
    .returning({ id: publishingJobsTable.id });

  if (marketplaceRows.length > 0) {
    await db.insert(systemTimelineEventsTable).values(
      marketplaceRows.map((row) => ({
        category: "marketplace_cleanup",
        workerId: null,
        message: "Marketplace sold action requested",
        detailJson: JSON.stringify({
          action: "requested",
          source,
          vehicleId: row.vehicleId,
          listingId: row.id,
          requestedAt: now.toISOString(),
        }),
      })),
    );
  }

  return {
    marketplaceUpdated: marketplaceRows.length,
    listingsUpdated: listingRows.length,
    jobsCancelled: cancelledJobs.length,
  };
}
