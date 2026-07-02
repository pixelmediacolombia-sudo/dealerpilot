// Provider-agnostic interfaces for AI photo pipeline operations.
// Swap implementations by changing the factory in providers/index.ts.

export interface BackgroundRemovalResult {
  url: string;          // URL to the transparent-background PNG
  provider: string;
  model: string;
  timeMs: number;
}

export interface ClassificationResult {
  label: string;        // One of PHOTO_CLASSIFICATIONS
  confidence: number;   // 0–1
  isExterior: boolean;
  provider: string;
  model: string;
}

// Canonical photo classifications.
// Order defines the default sort priority (lower index = higher priority).
export const PHOTO_CLASSIFICATIONS = [
  // ── Primary exterior — studio background applied ──────────────────────────
  "Exterior Front",
  "Exterior Front 45",
  "Exterior Side",
  "Exterior Rear 45",
  "Exterior Rear",
  // ── Secondary exterior — no studio background ─────────────────────────────
  "Exterior Wheel",
  "Exterior Engine",
  "Exterior Bed",
  "Exterior Tailgate",
  // ── Interior ──────────────────────────────────────────────────────────────
  "Interior Dashboard",
  "Interior Driver Seat",
  "Interior Passenger Seat",
  "Interior Rear Seat",
  "Interior Door Panel",
  "Interior Steering Wheel",
  "Interior Center Console",
  "Interior Infotainment",
  "Interior Roof",
  "Interior Sunroof",
  // ── Technical ─────────────────────────────────────────────────────────────
  "Technical Backup Camera",
  "Technical Gauge Cluster",
  "Technical Navigation Screen",
  "Technical Key",
  "Technical VIN Sticker",
  "Technical Odometer",
  "Technical Window Sticker",
  // ── Dealer ────────────────────────────────────────────────────────────────
  "Dealer Document",
  "Dealer Warranty",
  "Dealer Inspection",
  // ── Fallback ──────────────────────────────────────────────────────────────
  "Miscellaneous",
] as const;

export type PhotoClassification = (typeof PHOTO_CLASSIFICATIONS)[number];

export const CLASSIFICATION_PRIORITY: Record<PhotoClassification, number> = {
  "Exterior Front": 0,
  "Exterior Front 45": 1,
  "Exterior Side": 2,
  "Exterior Rear 45": 3,
  "Exterior Rear": 4,
  "Exterior Wheel": 5,
  "Exterior Engine": 6,
  "Exterior Bed": 7,
  "Exterior Tailgate": 8,
  "Interior Dashboard": 9,
  "Interior Driver Seat": 10,
  "Interior Passenger Seat": 11,
  "Interior Rear Seat": 12,
  "Interior Door Panel": 13,
  "Interior Steering Wheel": 14,
  "Interior Center Console": 15,
  "Interior Infotainment": 16,
  "Interior Roof": 17,
  "Interior Sunroof": 18,
  "Technical Backup Camera": 19,
  "Technical Gauge Cluster": 20,
  "Technical Navigation Screen": 21,
  "Technical Key": 22,
  "Technical VIN Sticker": 23,
  "Technical Odometer": 24,
  "Technical Window Sticker": 25,
  "Dealer Document": 26,
  "Dealer Warranty": 27,
  "Dealer Inspection": 28,
  "Miscellaneous": 29,
};

// Images that receive the studio background composite
export const STUDIO_EXTERIOR_CLASSIFICATIONS = new Set<string>([
  "Exterior Front",
  "Exterior Front 45",
  "Exterior Side",
  "Exterior Rear 45",
  "Exterior Rear",
]);

// All exterior types (isExterior = 1) — broader than studio set
export const EXTERIOR_CLASSIFICATIONS = new Set<string>([
  "Exterior Front",
  "Exterior Front 45",
  "Exterior Side",
  "Exterior Rear 45",
  "Exterior Rear",
  "Exterior Wheel",
  "Exterior Engine",
  "Exterior Bed",
  "Exterior Tailgate",
]);

export interface IBackgroundRemovalProvider {
  readonly name: string;
  readonly model: string;
  removeBackground(imageUrl: string): Promise<BackgroundRemovalResult>;
}

export interface IClassificationProvider {
  readonly name: string;
  readonly model: string;
  classify(imageUrl: string): Promise<ClassificationResult>;
}
