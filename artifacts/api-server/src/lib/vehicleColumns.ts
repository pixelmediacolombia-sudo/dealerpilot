import { vehiclesTable } from "@workspace/db";

// Production may not yet have the optional down-payment override columns.
// Keep operational reads explicit until that migration is present everywhere.
export const vehicleOperationalColumns = {
  id: vehiclesTable.id,
  dealerId: vehiclesTable.dealerId,
  vin: vehiclesTable.vin,
  stockNumber: vehiclesTable.stockNumber,
  year: vehiclesTable.year,
  make: vehiclesTable.make,
  model: vehiclesTable.model,
  trim: vehiclesTable.trim,
  mileage: vehiclesTable.mileage,
  price: vehiclesTable.price,
  exteriorColor: vehiclesTable.exteriorColor,
  interiorColor: vehiclesTable.interiorColor,
  bodyStyle: vehiclesTable.bodyStyle,
  transmission: vehiclesTable.transmission,
  fuelType: vehiclesTable.fuelType,
  description: vehiclesTable.description,
  vdpUrl: vehiclesTable.vdpUrl,
  sourceRaw: vehiclesTable.sourceRaw,
  lotLocation: vehiclesTable.lotLocation,
  status: vehiclesTable.status,
  aiPhotoStatus: vehiclesTable.aiPhotoStatus,
  aiPhotoSetId: vehiclesTable.aiPhotoSetId,
  firstSeenAt: vehiclesTable.firstSeenAt,
  lastSeenAt: vehiclesTable.lastSeenAt,
  lastSeenInFeedAt: vehiclesTable.lastSeenInFeedAt,
  missingFeedCount: vehiclesTable.missingFeedCount,
  soldAt: vehiclesTable.soldAt,
  soldDetectionSource: vehiclesTable.soldDetectionSource,
  lastSyncAt: vehiclesTable.lastSyncAt,
  createdAt: vehiclesTable.createdAt,
  updatedAt: vehiclesTable.updatedAt,
} as const;

export type VehicleOperationalRow = Pick<
  typeof vehiclesTable.$inferSelect,
  keyof typeof vehicleOperationalColumns
>;
