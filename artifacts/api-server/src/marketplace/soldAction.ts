import {
  db,
  listingsTable,
  marketplaceListingsTable,
  systemTimelineEventsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type SoldActionResult = "success" | "failed";

export async function recordMarketplaceSoldAction(params: {
  listingId: number;
  dealerId?: number;
  status: SoldActionResult;
  error?: string | null;
  extensionId?: string | null;
}) {
  const conditions = [eq(marketplaceListingsTable.id, params.listingId)];
  if (params.dealerId) conditions.push(eq(marketplaceListingsTable.dealerId, params.dealerId));
  const [listing] = await db
    .select()
    .from(marketplaceListingsTable)
    .where(and(...conditions))
    .limit(1);
  if (!listing) return null;

  const now = new Date();
  const action = params.status === "success" ? "completed" : "failed";
  const note = params.status === "success"
    ? "Facebook Marketplace listing marked Sold by DealerPilot."
    : `Facebook Marketplace sold action failed${params.error ? `: ${params.error}` : "."}`;
  await db
    .update(marketplaceListingsTable)
    .set({ status: "Sold", notes: note, updatedAt: now })
    .where(eq(marketplaceListingsTable.id, listing.id));
  await db
    .update(listingsTable)
    .set({ status: "Sold", updatedAt: now })
    .where(and(eq(listingsTable.channel, "marketplace"), eq(listingsTable.vehicleId, listing.vehicleId)));
  await db.insert(systemTimelineEventsTable).values({
    category: "marketplace_cleanup",
    workerId: null,
    message: params.status === "success" ? "Marketplace sold action completed" : "Marketplace sold action failed",
    detailJson: JSON.stringify({
      action,
      status: params.status,
      listingId: listing.id,
      vehicleId: listing.vehicleId,
      extensionId: params.extensionId ?? null,
      error: params.error ?? null,
      completedAt: now.toISOString(),
    }),
  });
  return { listingId: listing.id, vehicleId: listing.vehicleId, status: params.status };
}
