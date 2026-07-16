import { db, publishingJobsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const PHOTO_DIRECTOR_WAITING_STEP = "Waiting for Photo Director";

export async function releasePublishingJobsWaitingForPhotoDirector(
  vehicleId: number,
): Promise<{ released: number }> {
  const released = await db
    .update(publishingJobsTable)
    .set({
      status: "Queued",
      scheduledAt: new Date(),
      currentStep: "Queued",
      failedReason: null,
      assignedExtensionId: null,
      assignedAt: null,
      claimedByExtension: null,
    })
    .where(
      and(
        eq(publishingJobsTable.vehicleId, vehicleId),
        eq(publishingJobsTable.status, "Scheduled"),
        eq(publishingJobsTable.currentStep, PHOTO_DIRECTOR_WAITING_STEP),
      ),
    )
    .returning({ id: publishingJobsTable.id });

  return { released: released.length };
}
