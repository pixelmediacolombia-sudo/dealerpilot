import {
  and,
  asc,
  desc,
  eq,
  inArray,
  ne,
} from "drizzle-orm";
import {
  autoPublishSettingsTable,
  db,
  listingVersionsTable,
  listingsTable,
  publishingBatchesTable,
  publishingJobsTable,
  vehicleImagesTable,
  vehiclesTable,
  type AutoPublishSettings,
} from "@workspace/db";
import { getCachedGmDecision } from "../routes/gm";
import { getDuplicateConflictVehicleIds } from "../workers/market.worker";
import {
  ACTIVE_PUBLISHING_JOB_STATUSES,
  LOT_CITY_MAP,
} from "./controlledMode";
import { findLatestNeedsReviewVehicleIds } from "./needsReviewGuard";
import { photoDirectorPublishBlockReason } from "../photo/publishReadiness";

const PLAN_TIME_ZONE = "America/New_York";
const DISPLAY_TIME_ZONE = "America/Bogota";

function dateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
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
  const hours = Math.floor(minutes / 60);
  const localMinutes = minutes % 60;
  const asUtc = Date.UTC(year!, month! - 1, day, hours, localMinutes);
  const offset = timeZoneOffsetMinutes(new Date(asUtc), timeZone);
  return new Date(asUtc - offset * 60_000);
}

function addCalendarDays(date: Date, days: number, timeZone: string): string {
  const [year, month, day] = dateKey(date, timeZone).split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${next.getUTCFullYear().toString().padStart(4, "0")}-${(next.getUTCMonth() + 1).toString().padStart(2, "0")}-${next.getUTCDate().toString().padStart(2, "0")}`;
}

function formatInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isWithinWindow(date: Date, start: number, end: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PLAN_TIME_ZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const current = (Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24) * 60
    + Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return start < end ? current >= start && current <= end : current >= start || current <= end;
}

function nextWindowStartAt(
  now: Date,
  notBefore: Date,
  start: number,
  end: number,
): Date {
  if (isWithinWindow(now, start, end) && now.getTime() >= notBefore.getTime()) {
    return now;
  }
  for (let offset = 0; offset < 31; offset++) {
    const localDate = addCalendarDays(notBefore, offset, PLAN_TIME_ZONE);
    const candidate = zonedDateTimeToUtc(localDate, start, PLAN_TIME_ZONE);
    if (candidate.getTime() >= now.getTime() && candidate.getTime() >= notBefore.getTime()) {
      return candidate;
    }
  }
  return new Date(notBefore);
}

function analyzePhotos(images: { url: string; position: number }[]) {
  const total = images.length;
  const unique = new Set(images.map((image) => image.url)).size;
  const photoCount = total >= 20 ? 40 : total >= 15 ? 35 : total >= 10 ? 28 : total >= 5 ? 18 : total >= 3 ? 10 : total > 0 ? 5 : 0;
  const diversity = Math.round((unique / Math.max(total, 1)) * 20);
  const variety = total >= 12 ? 20 : total >= 8 ? 14 : total >= 5 ? 8 : total > 0 ? 4 : 0;
  const completeness = total >= 5 ? 20 : Math.round((total / 5) * 20);
  const photoScore = Math.min(100, photoCount + diversity + variety + completeness);
  return {
    photoCount: total,
    photoScore,
    photoDecision: photoScore >= 80 ? "use_original" : photoScore >= 60 ? "use_original_recommend_ai_cover" : photoScore > 0 ? "generate_ai_creative" : "needs_review",
  };
}

function priorityScore(vehicle: {
  bodyStyle: string | null;
  price: number | null;
  firstSeenAt: Date;
}, photoScore: number): number {
  const bodyStyle = (vehicle.bodyStyle ?? "").toLowerCase();
  const bodyBonus = bodyStyle.includes("truck") || bodyStyle.includes("pickup")
    ? 30
    : bodyStyle.includes("suv") || bodyStyle.includes("crossover")
      ? 20
      : bodyStyle.includes("van") || bodyStyle.includes("minivan")
        ? 15
        : bodyStyle.includes("sedan") || bodyStyle.includes("coupe") ? 10 : 5;
  const price = vehicle.price ?? 0;
  const priceBonus = price >= 7000 && price < 16000 ? 22 : price < 22000 ? 18 : price < 28000 ? 12 : price < 35000 ? 6 : price >= 45000 ? -10 : 0;
  const ageDays = Math.floor((Date.now() - vehicle.firstSeenAt.getTime()) / 86_400_000);
  const freshnessBonus = ageDays <= 3 ? 15 : ageDays <= 7 ? 10 : ageDays <= 14 ? 5 : 0;
  const photoBonus = photoScore >= 80 ? 10 : photoScore >= 60 ? 6 : photoScore >= 40 ? 3 : 0;
  return bodyBonus + priceBonus + freshnessBonus + photoBonus + 5;
}

export type AutoPublishForecastVehicle = {
  vehicleId: number;
  label: string;
  vin: string;
  price: number | null;
  mileage: number | null;
  photoCount: number;
  photoScore: number;
  photoDecision: string;
  priorityScore: number;
};

export async function previewAutoPublishVehicles(
  dealerId: number,
  count: number,
): Promise<{ selected: AutoPublishForecastVehicle[]; totalEligible: number }> {
  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(and(
      eq(vehiclesTable.dealerId, dealerId),
      ne(vehiclesTable.status, "Published"),
      ne(vehiclesTable.status, "Sold/Removed"),
      ne(vehiclesTable.status, "Removed"),
    ));
  if (vehicles.length === 0) return { selected: [], totalEligible: 0 };

  const vehicleIds = vehicles.map((vehicle) => vehicle.id);
  const [allImages, allListings, allVersions, activeJobs, needsReviewVehicleIds, duplicateConflictIds] = await Promise.all([
    db.select().from(vehicleImagesTable).where(inArray(vehicleImagesTable.vehicleId, vehicleIds)).orderBy(asc(vehicleImagesTable.position)),
    db.select().from(listingsTable).where(inArray(listingsTable.vehicleId, vehicleIds)),
    db.select().from(listingVersionsTable).where(inArray(listingVersionsTable.vehicleId, vehicleIds)).orderBy(desc(listingVersionsTable.createdAt)),
    db.select({ vehicleId: publishingJobsTable.vehicleId }).from(publishingJobsTable).where(and(
      inArray(publishingJobsTable.vehicleId, vehicleIds),
      inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
    )),
    findLatestNeedsReviewVehicleIds(vehicleIds),
    getDuplicateConflictVehicleIds(),
  ]);
  const activeVehicleIds = new Set(activeJobs.map((job) => job.vehicleId));
  const imagesByVehicle = new Map<number, typeof allImages>();
  for (const image of allImages) imagesByVehicle.set(image.vehicleId, [...(imagesByVehicle.get(image.vehicleId) ?? []), image]);
  const listingByVehicle = new Map(allListings.map((listing) => [listing.vehicleId, listing]));
  const latestVersionByVehicle = new Map<number, typeof allVersions[number]>();
  for (const version of allVersions) if (!latestVersionByVehicle.has(version.vehicleId)) latestVersionByVehicle.set(version.vehicleId, version);

  const eligible = vehicles.flatMap((vehicle) => {
    if (activeVehicleIds.has(vehicle.id) || needsReviewVehicleIds.has(vehicle.id) || duplicateConflictIds.has(vehicle.id)) return [];
    const listing = listingByVehicle.get(vehicle.id);
    if (listing?.status === "Published" || !vehicle.lotLocation || !LOT_CITY_MAP[vehicle.lotLocation]) return [];
    const images = imagesByVehicle.get(vehicle.id) ?? [];
    if (!vehicle.vin || !vehicle.year || !vehicle.price || !vehicle.mileage || images.length < 5) return [];
    if (getCachedGmDecision(vehicle.id)?.recommendation && ["HOLD", "RECONSIDER"].includes(getCachedGmDecision(vehicle.id)!.recommendation)) return [];
    if (photoDirectorPublishBlockReason(vehicle)) return [];
    const photos = analyzePhotos(images);
    const label = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`.trim();
    return [{
      vehicleId: vehicle.id,
      label,
      vin: vehicle.vin,
      price: vehicle.price,
      mileage: vehicle.mileage,
      photoCount: photos.photoCount,
      photoScore: photos.photoScore,
      photoDecision: photos.photoDecision,
      priorityScore: priorityScore(vehicle, photos.photoScore),
      listingVersionId: latestVersionByVehicle.get(vehicle.id)?.id ?? null,
    }];
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  return { selected: eligible.slice(0, count).map(({ listingVersionId: _listingVersionId, ...vehicle }) => vehicle), totalEligible: eligible.length };
}

export async function getNextAutoPublishForecast(params: {
  dealerId: number;
  count: number;
  now?: Date;
}): Promise<Record<string, unknown>> {
  const now = params.now ?? new Date();
  const [settings] = await db.select().from(autoPublishSettingsTable).where(eq(autoPublishSettingsTable.dealerId, params.dealerId));
  if (!settings) return { enabled: false, status: "Not configured", vehicles: [] };
  if (!settings.enabled) return { enabled: false, status: "Disabled", settings, vehicles: [] };

  const activeJobs = await db.select({ id: publishingJobsTable.id, batchId: publishingJobsTable.batchId, vehicleId: publishingJobsTable.vehicleId, status: publishingJobsTable.status, scheduledAt: publishingJobsTable.scheduledAt })
    .from(publishingJobsTable)
    .where(and(eq(publishingJobsTable.dealerId, params.dealerId), inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES])));
  if (activeJobs.length > 0) {
    const batchIds = [...new Set(activeJobs.map((job) => job.batchId).filter((id): id is number => id !== null))];
    const activeVehicleIds = [...new Set(activeJobs.map((job) => job.vehicleId))];
    const [batches, activeVehicles] = await Promise.all([
      batchIds.length > 0 ? db.select().from(publishingBatchesTable).where(inArray(publishingBatchesTable.id, batchIds)) : Promise.resolve([]),
      db.select().from(vehiclesTable).where(inArray(vehiclesTable.id, activeVehicleIds)),
    ]);
    const vehicleById = new Map(activeVehicles.map((vehicle) => [vehicle.id, vehicle]));
    return {
      enabled: true,
      status: "Queued",
      source: "persisted",
      timezone: PLAN_TIME_ZONE,
      displayTimezone: DISPLAY_TIME_ZONE,
      batch: batches[0] ?? null,
      jobs: activeJobs.sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0)).map((job) => ({
        ...job,
        vehicle: vehicleById.has(job.vehicleId)
          ? {
              id: vehicleById.get(job.vehicleId)!.id,
              label: `${vehicleById.get(job.vehicleId)!.year ?? ""} ${vehicleById.get(job.vehicleId)!.make} ${vehicleById.get(job.vehicleId)!.model}${vehicleById.get(job.vehicleId)!.trim ? ` ${vehicleById.get(job.vehicleId)!.trim}` : ""}`.trim(),
            }
          : null,
        scheduledAt: job.scheduledAt?.toISOString() ?? null,
        scheduledAtLocal: job.scheduledAt ? formatInTimeZone(job.scheduledAt, DISPLAY_TIME_ZONE) : null,
      })),
      note: "Este batch ya está persistido; las horas son las programadas en producción.",
    };
  }

  const start = parseTimeToMinutes(settings.preferredWindowStart) ?? 0;
  const end = parseTimeToMinutes(settings.preferredWindowEnd) ?? start;
  const [lastAutoBatch] = await db.select({ createdAt: publishingBatchesTable.createdAt })
    .from(publishingBatchesTable)
    .where(and(eq(publishingBatchesTable.dealerId, params.dealerId), eq(publishingBatchesTable.notes, "Created automatically by Publishing Agent")))
    .orderBy(desc(publishingBatchesTable.createdAt))
    .limit(1);
  const today = dateKey(now, PLAN_TIME_ZONE);
  const todayJobs = await db.select({ createdAt: publishingJobsTable.createdAt }).from(publishingJobsTable).where(eq(publishingJobsTable.dealerId, params.dealerId));
  const postsToday = todayJobs.filter((job) => dateKey(job.createdAt, PLAN_TIME_ZONE) === today).length;
  const capReached = postsToday >= settings.maxPostsPerDay;
  const frequencyNotBefore = lastAutoBatch ? new Date(lastAutoBatch.createdAt.getTime() + settings.frequencyDays * 86_400_000) : now;
  const capNotBefore = capReached ? zonedDateTimeToUtc(addCalendarDays(now, 1, PLAN_TIME_ZONE), 0, PLAN_TIME_ZONE) : now;
  const notBefore = frequencyNotBefore.getTime() > capNotBefore.getTime() ? frequencyNotBefore : capNotBefore;
  const plannedAt = nextWindowStartAt(now, notBefore, start, end);
  const preview = await previewAutoPublishVehicles(params.dealerId, Math.min(params.count, settings.vehiclesPerBatch));
  const jobs = preview.selected.map((vehicle, index) => ({
    sequence: index + 1,
    vehicle,
    plannedAt: new Date(plannedAt.getTime() + index * settings.minDelayMinutes * 60_000).toISOString(),
    plannedAtLocal: formatInTimeZone(new Date(plannedAt.getTime() + index * settings.minDelayMinutes * 60_000), DISPLAY_TIME_ZONE),
  }));

  return {
    enabled: true,
    status: "Forecast",
    source: "read_only_projection",
    timezone: PLAN_TIME_ZONE,
    displayTimezone: DISPLAY_TIME_ZONE,
    planWindow: { start: settings.preferredWindowStart, end: settings.preferredWindowEnd },
    plannedAt: plannedAt.toISOString(),
    plannedAtLocal: formatInTimeZone(plannedAt, DISPLAY_TIME_ZONE),
    executionToleranceMinutes: 5,
    postsToday,
    maxPostsPerDay: settings.maxPostsPerDay,
    capReached,
    vehiclesPerBatch: settings.vehiclesPerBatch,
    totalEligible: preview.totalEligible,
    jobs,
    note: "Proyección de solo lectura: aún no crea el batch ni reserva los vehículos. El worker puede ajustar la selección si cambia el inventario, fotos o estados antes de la ventana.",
  };
}
