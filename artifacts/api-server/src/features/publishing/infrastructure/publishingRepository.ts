import {
  aiPhotoImagesTable,
  db,
  dealersTable,
  listingVersionsTable,
  listingsTable,
  marketplaceListingsTable,
  publishingBatchesTable,
  publishingJobsTable,
  vehicleImagesTable,
  vehiclesTable,
  type PublishingJob,
} from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { deriveBatchProgress } from "../../../publishing/batchProgress";
import { toJob } from "../domain/jobPresenter";

export async function reconcileBatchProgress(batchId: number | null | undefined) {
  if (!batchId) return;

  const [counts] = await db
    .select({
      completed: sql<number>`count(*) filter (where ${publishingJobsTable.status} = 'Published')`,
      failed: sql<number>`count(*) filter (where ${publishingJobsTable.status} = 'Failed')`,
      skipped: sql<number>`count(*) filter (where ${publishingJobsTable.status} = 'Cancelled')`,
      needsReview: sql<number>`count(*) filter (where ${publishingJobsTable.status} = 'Needs Review')`,
      total: sql<number>`count(*)`,
    })
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.batchId, batchId));

  const [batch] = await db
    .select({ totalVehicles: publishingBatchesTable.totalVehicles })
    .from(publishingBatchesTable)
    .where(eq(publishingBatchesTable.id, batchId));

  const totalVehicles = Number(batch?.totalVehicles ?? counts?.total ?? 0);
  const progress = deriveBatchProgress({
    completed: Number(counts?.completed ?? 0),
    failed: Number(counts?.failed ?? 0),
    skipped: Number(counts?.skipped ?? 0),
    needsReview: Number(counts?.needsReview ?? 0),
    totalVehicles,
  });

  await db
    .update(publishingBatchesTable)
    .set({
      status: progress.status,
      completedCount: progress.completed,
      failedCount: progress.failed,
      skippedCount: progress.skipped,
      needsReviewCount: progress.needsReview,
      startedAt: new Date(),
      completedAt: progress.isDone ? new Date() : null,
    })
    .where(eq(publishingBatchesTable.id, batchId));
}

export async function moveJobToNeedsReviewWithoutListingUrl(
  job: PublishingJob,
  reason = "Publish completion was reported without a Marketplace listing URL. Verify Facebook manually before marking live.",
) {
  const [updated] = await db
    .update(publishingJobsTable)
    .set({
      status: "Needs Review",
      needsReview: true,
      reviewReason: reason,
      failedReason: "Missing Marketplace listing URL confirmation",
      listingUrl: null,
      completedAt: null,
      claimedByExtension: null,
    })
    .where(eq(publishingJobsTable.id, job.id))
    .returning();

  await db
    .update(vehiclesTable)
    .set({ status: "Active" })
    .where(eq(vehiclesTable.id, job.vehicleId));

  await db
    .update(listingsTable)
    .set({
      status: "Needs Review",
      externalUrl: null,
      publishedAt: null,
      publishedByExtensionId: null,
    })
    .where(and(eq(listingsTable.vehicleId, job.vehicleId), eq(listingsTable.channel, "marketplace")));

  await db
    .update(marketplaceListingsTable)
    .set({
      status: "Needs Review",
      listingUrl: null,
      publishedAt: null,
    })
    .where(eq(marketplaceListingsTable.vehicleId, job.vehicleId));

  await reconcileBatchProgress(job.batchId);

  return updated;
}

export async function getVehiclePhotos(
  vehicleId: number,
  aiPhotoSetId: number | null,
  aiPhotoStatus: string | null,
): Promise<Array<{ url: string | null; position: number | null; source: "ai" | "raw" }>> {
  if ((aiPhotoStatus === "Ready" || aiPhotoStatus === "Done") && aiPhotoSetId !== null) {
    const aiImages = await db
      .select()
      .from(aiPhotoImagesTable)
      .where(eq(aiPhotoImagesTable.setId, aiPhotoSetId))
      .orderBy(asc(aiPhotoImagesTable.position));
    if (aiImages.length > 0) {
      return aiImages.map((img) => ({
        url: img.processedUrl ?? img.originalUrl,
        position: img.position,
        source: "ai" as const,
      }));
    }
  }
  const rawImages = await db
    .select()
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, vehicleId))
    .orderBy(asc(vehicleImagesTable.position));
  return rawImages.map((img) => ({ url: img.url, position: img.position, source: "raw" as const }));
}

export async function enrich(jobs: PublishingJob[]) {
  if (jobs.length === 0) return [];
  const vehicleIds = [...new Set(jobs.map((j) => j.vehicleId))];
  const dealerIds = [...new Set(jobs.map((j) => j.dealerId))];
  const versionIds = [...new Set(jobs.map((j) => j.listingVersionId).filter((id): id is number => id !== null))];

  const vehicles = await db.select().from(vehiclesTable).where(inArray(vehiclesTable.id, vehicleIds));
  const dealers = await db.select().from(dealersTable).where(inArray(dealersTable.id, dealerIds));
  const versions =
    versionIds.length > 0
      ? await db.select().from(listingVersionsTable).where(inArray(listingVersionsTable.id, versionIds))
      : [];

  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const dealerById = new Map(dealers.map((dealer) => [dealer.id, dealer]));
  const versionById = new Map(versions.map((version) => [version.id, version]));

  return jobs.map((job) => {
    const vehicle = vehicleById.get(job.vehicleId);
    const dealer = dealerById.get(job.dealerId);
    const version = job.listingVersionId != null ? versionById.get(job.listingVersionId) : undefined;
    return toJob(job, {
      vehicleLabel: vehicle
        ? `${vehicle.year ?? ""} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`.trim()
        : null,
      dealerName: dealer?.name ?? null,
      listingTitle: version?.title ?? null,
    });
  });
}
