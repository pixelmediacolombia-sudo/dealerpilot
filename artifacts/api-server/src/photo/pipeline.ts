// AI Photo Pipeline orchestrator.
// Runs all 7 stages in sequence, updating the job's currentStage + progressPercent
// in the DB after each stage so the UI can show live progress.
// Each stage is non-fatal for individual images — pipeline continues on partial failure.
//
// Reprocess mode (job.sourceSetId is set):
//   Pre-loads classification + bg-removal results from the source set so Stages 1 & 2
//   are skipped for images that already have good data (no redundant OpenAI/Fal.ai calls).
//   Only exterior compositing (Stage 3+) is re-executed with the new studio background.
import {
  db,
  aiPhotoJobsTable,
  aiPhotoSetsTable,
  aiPhotoImagesTable,
  aiStudioPacksTable,
  vehicleImagesTable,
  type AiPhotoJob,
  type AiStudioPack,
} from "@workspace/db";
import { asc, and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { stageClassify } from "./stages/1_classify";
import { stageRemoveBackground } from "./stages/2_removeBackground";
import { stageComposite } from "./stages/3_composite";
import { stageEnhance } from "./stages/4_enhance";
import { stageValidate } from "./stages/5_validate";
import { stageOrder } from "./stages/6_order";
import { stageExport } from "./stages/7_export";

// Per-image working state threaded through stages
export interface PipelineImage {
  originalUrl: string;
  backgroundRemovedUrl?: string;
  compositedUrl?: string;
  processedUrl?: string;
  classification?: string;
  isExterior?: number;
  position: number;
  processingStatus: string;
  failedReason?: string;
  usedFallback: number;
  classificationProvider?: string;
  classificationModel?: string;
  classificationConfidence?: number;
  removalProvider?: string;
  removalModel?: string;
  removalTimeMs?: number;
  backgroundVersion?: string;
  totalProcessingTimeMs?: number;
  qualityScore?: number;
  qualityFlags?: string;
}

export interface PipelineContext {
  job: AiPhotoJob;
  setId: number;
  pack: AiStudioPack | null;
  images: PipelineImage[];
  startedAt: Date;
  log: Logger;
  /** Set to true by the validate stage when a critical quality check fails.
   *  The export stage uses this to mark the photo set "Needs Review" instead of "Ready". */
  qualityGateFailed?: boolean;
}

const STAGES = [
  { name: "Classify", fn: stageClassify, async: true },
  { name: "Remove Background", fn: stageRemoveBackground, async: true },
  { name: "Composite", fn: stageComposite, async: true },
  { name: "Enhance", fn: stageEnhance, async: true },
  { name: "Validate", fn: stageValidate, async: true },
  { name: "Order", fn: (ctx: PipelineContext) => Promise.resolve(stageOrder(ctx)), async: true },
  { name: "Export", fn: stageExport, async: true },
];

async function updateJobProgress(jobId: number, stage: string, percent: number) {
  await db
    .update(aiPhotoJobsTable)
    .set({ currentStage: stage, progressPercent: percent })
    .where(eq(aiPhotoJobsTable.id, jobId));
}

export async function runPhotoPipeline(job: AiPhotoJob, log: Logger): Promise<void> {
  const startedAt = new Date();

  // Load studio pack (default pack for this dealer)
  const [pack] = await db
    .select()
    .from(aiStudioPacksTable)
    .where(and(eq(aiStudioPacksTable.dealerId, job.dealerId), eq(aiStudioPacksTable.isDefault, true)))
    .limit(1);

  // Load vehicle photos
  const rawImages = await db
    .select({ url: vehicleImagesTable.url, position: vehicleImagesTable.position })
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, job.vehicleId))
    .orderBy(asc(vehicleImagesTable.position));

  if (rawImages.length === 0) {
    throw new Error(`Vehicle ${job.vehicleId} has no images`);
  }

  // Create the ai_photo_set row (Processing)
  const existing = await db
    .select({ version: aiPhotoSetsTable.version })
    .from(aiPhotoSetsTable)
    .where(eq(aiPhotoSetsTable.vehicleId, job.vehicleId));
  const nextVersion = existing.reduce((max, r) => Math.max(max, r.version), 0) + 1;

  const [photoSet] = await db
    .insert(aiPhotoSetsTable)
    .values({
      vehicleId: job.vehicleId,
      dealerId: job.dealerId,
      version: nextVersion,
      status: "Processing",
      imageHash: job.imageHash,
      studioPackId: pack?.id ?? null,
      studioVersion: pack?.backgroundVersion ?? null,
      modelVersion: job.modelVersion ?? "bria-rmbg-2.0",
      presetVersion: job.presetVersion ?? "v1",
      totalPhotos: rawImages.length,
    })
    .returning({ id: aiPhotoSetsTable.id });

  const setId = photoSet!.id;

  // Update job with totalPhotos + setId hint
  await db
    .update(aiPhotoJobsTable)
    .set({ totalPhotos: rawImages.length, outputSetId: setId })
    .where(eq(aiPhotoJobsTable.id, job.id));

  // Build initial pipeline images from raw vehicle images
  const pipelineImages: PipelineImage[] = rawImages.map(({ url }, i) => ({
    originalUrl: url,
    position: i,
    processingStatus: "Processing",
    usedFallback: 0,
  }));

  // ── Reprocess mode: pre-load classification + bg-removal from source set ────
  // When job.sourceSetId is set (background-version change reprocess), load
  // the previous set's per-image data so Stages 1 & 2 can skip API calls.
  if (job.sourceSetId) {
    const sourceImages = await db
      .select()
      .from(aiPhotoImagesTable)
      .where(eq(aiPhotoImagesTable.setId, job.sourceSetId))
      .orderBy(asc(aiPhotoImagesTable.position));

    // Build a lookup by originalUrl for fast matching
    const byUrl = new Map(sourceImages.map((si) => [si.originalUrl, si]));

    for (const img of pipelineImages) {
      const src = byUrl.get(img.originalUrl);
      if (!src) continue;

      // Pre-load classification (Stage 1 will skip if set)
      if (src.classification) {
        img.classification = src.classification;
        img.isExterior = src.isExterior ?? 0;
        img.classificationProvider = src.classificationProvider ?? undefined;
        img.classificationModel = src.classificationModel ?? undefined;
        img.classificationConfidence = src.classificationConfidence ?? undefined;
      }

      // Pre-load bg-removal result for exterior photos (Stage 2 will skip if set + different from original)
      // Interior photos keep backgroundRemovedUrl = originalUrl (their composited is skipped anyway)
      if (src.backgroundRemovedUrl && src.backgroundRemovedUrl !== src.originalUrl) {
        img.backgroundRemovedUrl = src.backgroundRemovedUrl;
        img.removalProvider = src.removalProvider ?? undefined;
        img.removalModel = src.removalModel ?? undefined;
        img.removalTimeMs = src.removalTimeMs ?? undefined;
      }
    }

    log.info(
      { jobId: job.id, vehicleId: job.vehicleId, sourceSetId: job.sourceSetId },
      "photo:pipeline reprocess-mode — classification + bg-removal pre-loaded",
    );
  }

  // Build pipeline context
  const ctx: PipelineContext = {
    job: { ...job },
    setId,
    pack: pack ?? null,
    images: pipelineImages,
    startedAt,
    log,
  };

  // Run all 7 stages
  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i]!;
    const percent = Math.round(((i + 0.5) / STAGES.length) * 100);
    await updateJobProgress(job.id, stage.name, percent);

    try {
      await stage.fn(ctx);
    } catch (err) {
      // If a whole stage throws (not per-image), mark all pending images as Failed
      log.error({ err, stage: stage.name, jobId: job.id }, "photo:stage threw");
      if (i < STAGES.length - 1) {
        // Abort remaining stages on catastrophic stage failure (Export will still run)
        for (const img of ctx.images) {
          if (img.processingStatus !== "Failed") {
            img.processingStatus = "Failed";
            img.failedReason = `Stage "${stage.name}" threw: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      }
    }

    // Update processed count in DB for progress display
    const doneCount = ctx.images.filter((im) => im.processedUrl || im.compositedUrl).length;
    await db
      .update(aiPhotoJobsTable)
      .set({ processedPhotos: doneCount })
      .where(eq(aiPhotoJobsTable.id, job.id));
  }
}
