// Stage 7: Export — writes all results to the database.
// 1. Inserts ai_photo_images rows
// 2. Marks ai_photo_sets as Ready + isLatest=true
// 3. Marks previous sets as Superseded
// 4. Updates vehicles.aiPhotoStatus = "Ready", vehicles.aiPhotoSetId = new set id
// 5. Updates the job's outputSetId and completedAt
import {
  db,
  aiPhotoImagesTable,
  aiPhotoSetsTable,
  aiPhotoJobsTable,
  vehiclesTable,
} from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import type { PipelineContext } from "../pipeline";

export async function stageExport(ctx: PipelineContext): Promise<void> {
  const processingTimeMs = Date.now() - ctx.startedAt.getTime();
  const processedCount = ctx.images.filter((i) => i.processingStatus !== "Failed").length;
  const failedCount = ctx.images.filter((i) => i.processingStatus === "Failed").length;

  await db.transaction(async (tx) => {
    // 1. Insert all image rows
    if (ctx.images.length > 0) {
      await tx.insert(aiPhotoImagesTable).values(
        ctx.images.map((img) => ({
          setId: ctx.setId,
          vehicleId: ctx.job.vehicleId,
          originalUrl: img.originalUrl,
          processedUrl: img.processedUrl ?? null,
          backgroundRemovedUrl: img.backgroundRemovedUrl ?? null,
          compositedUrl: img.compositedUrl ?? null,
          classification: img.classification ?? "Miscellaneous",
          isExterior: img.isExterior ?? 0,
          position: img.position,
          processingStatus: img.processingStatus,
          failedReason: img.failedReason ?? null,
          usedFallback: img.usedFallback,
          classificationProvider: img.classificationProvider ?? null,
          classificationModel: img.classificationModel ?? null,
          classificationConfidence: img.classificationConfidence ?? null,
          removalProvider: img.removalProvider ?? null,
          removalModel: img.removalModel ?? null,
          removalTimeMs: img.removalTimeMs ?? null,
          backgroundVersion: img.backgroundVersion ?? null,
          promptVersion: img.promptVersion ?? "v1",
          totalProcessingTimeMs: img.totalProcessingTimeMs ?? null,
          qualityScore: img.qualityScore ?? null,
          qualityFlags: img.qualityFlags ?? null,
        })),
      );
    }

    // 2. Supersede all previous ready sets for this vehicle
    await tx
      .update(aiPhotoSetsTable)
      .set({ isLatest: false, status: "Superseded" })
      .where(
        and(
          eq(aiPhotoSetsTable.vehicleId, ctx.job.vehicleId),
          ne(aiPhotoSetsTable.id, ctx.setId),
        ),
      );

    // 3. Mark this set Ready (or Needs Review if quality gate failed)
    const setStatus = ctx.qualityGateFailed ? "Needs Review" : "Ready";
    const vehicleAiStatus = ctx.qualityGateFailed ? "Needs Review" : "Ready";
    await tx
      .update(aiPhotoSetsTable)
      .set({
        status: setStatus,
        isLatest: true,
        processedPhotos: processedCount,
        failedPhotos: failedCount,
        processingTimeMs,
        completedAt: new Date(),
      })
      .where(eq(aiPhotoSetsTable.id, ctx.setId));

    // 4. Update vehicle
    await tx
      .update(vehiclesTable)
      .set({ aiPhotoStatus: vehicleAiStatus, aiPhotoSetId: ctx.setId })
      .where(eq(vehiclesTable.id, ctx.job.vehicleId));

    // 5. Complete the job
    await tx
      .update(aiPhotoJobsTable)
      .set({
        status: "Completed",
        outputSetId: ctx.setId,
        processedPhotos: processedCount,
        failedPhotos: failedCount,
        progressPercent: 100,
        currentStage: "Export",
        completedAt: new Date(),
      })
      .where(eq(aiPhotoJobsTable.id, ctx.job.id));
  });

  ctx.log.info(
    {
      jobId: ctx.job.id,
      vehicleId: ctx.job.vehicleId,
      setId: ctx.setId,
      processedCount,
      failedCount,
      processingTimeMs,
    },
    "photo:export complete",
  );
}
