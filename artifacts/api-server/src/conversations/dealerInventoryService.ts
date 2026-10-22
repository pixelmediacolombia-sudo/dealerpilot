export type DealerInventoryCriteria = {
  dealerId: number;
  vehicleId?: number;
  vin?: string;
};

export type DealerInventoryVehicle = {
  id: number;
  dealerId: number;
  vin: string;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  price: number | null;
  mileage: number | null;
  exteriorColor: string | null;
  vdpUrl: string | null;
  sourceRaw: string | null;
  lotLocation: string | null;
};

export type DealerInventoryLookup = (
  criteria: DealerInventoryCriteria,
) => Promise<DealerInventoryVehicle | null>;

/** Dealer-scoped inventory boundary used by all conversational price answers. */
export class DealerInventoryService {
  private readonly lookup: DealerInventoryLookup;

  public constructor(lookup: DealerInventoryLookup) {
    this.lookup = lookup;
  }

  public findVehicle(criteria: DealerInventoryCriteria): Promise<DealerInventoryVehicle | null> {
    if (!Number.isInteger(criteria.dealerId) || criteria.dealerId <= 0) {
      return Promise.resolve(null);
    }
    if (!Number.isInteger(criteria.vehicleId) && !criteria.vin?.trim()) {
      return Promise.resolve(null);
    }
    return this.lookup({
      dealerId: criteria.dealerId,
      vehicleId: Number.isInteger(criteria.vehicleId) ? criteria.vehicleId : undefined,
      vin: criteria.vin?.trim() || undefined,
    });
  }
}
