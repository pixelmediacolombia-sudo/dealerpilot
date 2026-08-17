import { and, asc, eq, gt, inArray, ne } from "drizzle-orm";
import {
  autoPublishSettingsTable,
  db,
  publishingBatchesTable,
  publishingJobsTable,
} from "@workspace/db";
import { ACTIVE_PUBLISHING_JOB_STATUSES } from "./controlledMode";

const AUTO_BATCH_NOTE = "Created automatically by Publishing Agent";
const PLAN_TIME_ZONE = "America/New_York";
const DEFAULT_WINDOW_START_MINUTES = 9 * 60;
const ACTIVE_BATCH_STATUSES = ["Scheduled", "Preparing", "Active"] as const;

type QueueCompactionDateOptions = {
  now: Date;
  frequencyDays: number;
  preferredWindowStart: string;
  batchCount: number;
  timeZone?: string;
};

function dateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDays(date: Date, days: number, timeZone: string): string {
  const [year, month, day] = dateKey(date, timeZone).split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${shifted.getUTCFullYear().toString().padStart(4, "0")}-${(shifted.getUTCMonth() + 1).toString().padStart(2, "0")}-${shifted.getUTCDate().toString().padStart(2, "0")}`;
}

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date).find((entry) => entry.type === "timeZoneName");
  const match = /^GMT([+-])(\d{2}):?(\d{2})?$/.exec(part?.value ?? "GMT+00:00");
  if (!match) return 0;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

function zonedDateTimeToUtc(date: string, minutes: number, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const asUtc = Date.UTC(year!, month! - 1, day!, Math.floor(minutes / 60), minutes % 60);
  return new Date(asUtc - timeZoneOffsetMinutes(new Date(asUtc), timeZone) * 60_000);
}

export function buildCompactedAutoBatchSchedule(options: QueueCompactionDateOptions): Date[] {
  const timeZone = options.timeZone ?? PLAN_TIME_ZONE;
  const frequencyDays = Math.max(1, Math.trunc(options.frequencyDays) || 1);
  const startMinutes = parseTimeToMinutes(options.preferredWindowStart) ?? DEFAULT_WINDOW_START_MINUTES;

  return Array.from({ length: options.batchCount }, (_, index) => {
    const targetDate = addCalendarDays(options.now, frequencyDays * (index + 1), timeZone);
    return zonedDateTimeToUtc(targetDate, startMinutes, timeZone);
  });
}

export type AutoPublishQueueCompactionResult = {
  shiftedBatches: number;
  shiftedJobs: number;
  firstShiftedAt: string | null;
};

/**
 * Pull future automatic batches forward after an entire automatic batch was
 * published before its scheduled slot. The order of future batches is kept;
 * only their dates move closer so early publishing never creates idle days.
 */
export async function compactFutureAutoPublishQueue(params: {
  dealerId: number;
  completedBatchId: number | null | undefined;
  now?: Date;
}): Promise<AutoPublishQueueCompactionResult> {
  const empty: AutoPublishQueueCompactionResult = {
    shiftedBatches: 0,
    shiftedJobs: 0,
    firstShiftedAt: null,
  };
  if (!params.completedBatchId) return empty;

  const now = params.now ?? new Date();
  const [completedBatch] = await db
    .select({ id: publishingBatchesTable.id, notes: publishingBatchesTable.notes, scheduledAt: publishingBatchesTable.scheduledAt })
    .from(publishingBatchesTable)
    .where(and(
      eq(publishingBatchesTable.id, params.completedBatchId),
      eq(publishingBatchesTable.dealerId, params.dealerId),
    ));

  if (
    !completedBatch ||
    completedBatch.notes !== AUTO_BATCH_NOTE ||
    !completedBatch.scheduledAt ||
    completedBatch.scheduledAt.getTime() <= now.getTime()
  ) {
    return empty;
  }

  const completedJobs = await db
    .select({ status: publishingJobsTable.status })
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.batchId, completedBatch.id));
  if (completedJobs.length === 0 || completedJobs.some((job) => job.status !== "Published")) {
    return empty;
  }

  const futureBatches = await db
    .select({
      id: publishingBatchesTable.id,
      scheduledAt: publishingBatchesTable.scheduledAt,
    })
    .from(publishingBatchesTable)
    .where(and(
      eq(publishingBatchesTable.dealerId, params.dealerId),
      eq(publishingBatchesTable.notes, AUTO_BATCH_NOTE),
      inArray(publishingBatchesTable.status, [...ACTIVE_BATCH_STATUSES]),
      gt(publishingBatchesTable.scheduledAt, now),
      ne(publishingBatchesTable.id, completedBatch.id),
    ))
    .orderBy(asc(publishingBatchesTable.scheduledAt), asc(publishingBatchesTable.id));
  if (futureBatches.length === 0) return empty;

  const [settings] = await db
    .select({
      frequencyDays: autoPublishSettingsTable.frequencyDays,
      preferredWindowStart: autoPublishSettingsTable.preferredWindowStart,
      minDelayMinutes: autoPublishSettingsTable.minDelayMinutes,
    })
    .from(autoPublishSettingsTable)
    .where(eq(autoPublishSettingsTable.dealerId, params.dealerId));

  const targetBatchTimes = buildCompactedAutoBatchSchedule({
    now,
    frequencyDays: settings?.frequencyDays ?? 1,
    preferredWindowStart: settings?.preferredWindowStart ?? "09:00",
    batchCount: futureBatches.length,
  });
  const futureBatchIds = futureBatches.map((batch) => batch.id);
  const futureJobs = await db
    .select()
    .from(publishingJobsTable)
    .where(inArray(publishingJobsTable.batchId, futureBatchIds))
    .orderBy(asc(publishingJobsTable.scheduledAt), asc(publishingJobsTable.id));
  const jobsByBatch = new Map<number, typeof futureJobs>();
  for (const job of futureJobs) {
    if (job.batchId === null) continue;
    jobsByBatch.set(job.batchId, [...(jobsByBatch.get(job.batchId) ?? []), job]);
  }

  let shiftedJobs = 0;
  await db.transaction(async (tx) => {
    for (const [index, batch] of futureBatches.entries()) {
      const targetBatchAt = targetBatchTimes[index]!;
      const originalBatchAt = batch.scheduledAt?.getTime() ?? targetBatchAt.getTime();
      await tx
        .update(publishingBatchesTable)
        .set({ scheduledAt: targetBatchAt })
        .where(eq(publishingBatchesTable.id, batch.id));

      const batchJobs = jobsByBatch.get(batch.id) ?? [];
      for (const job of batchJobs) {
        if (!ACTIVE_PUBLISHING_JOB_STATUSES.includes(job.status as typeof ACTIVE_PUBLISHING_JOB_STATUSES[number])) continue;
        if (!job.scheduledAt) continue;

        const offsetMs = Math.max(0, job.scheduledAt.getTime() - originalBatchAt);
        await tx
          .update(publishingJobsTable)
          .set({ scheduledAt: new Date(targetBatchAt.getTime() + offsetMs) })
          .where(eq(publishingJobsTable.id, job.id));
        shiftedJobs += 1;
      }
    }
  });

  return {
    shiftedBatches: futureBatches.length,
    shiftedJobs,
    firstShiftedAt: targetBatchTimes[0]?.toISOString() ?? null,
  };
}
