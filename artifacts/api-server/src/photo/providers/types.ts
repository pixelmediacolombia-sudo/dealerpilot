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
  // ── Primary exterior — full vehicle shot, studio background applied ────────
  "Exterior Front",
  "Exterior Front 45",
  "Exterior Side",
  "Exterior Rear 45",
  "Exterior Rear",
  // ── Secondary exterior — close-up/partial, enhancement only ───────────────
  "Exterior Wheel",
  "Exterior Engine",
  "Exterior Bed",
  "Exterior Tailgate",
  "Exterior Headlights",
  "Exterior Taillights",
  "Exterior Badge",
  "Exterior Detail",
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
  "Exterior Headlights": 9,
  "Exterior Taillights": 10,
  "Exterior Badge": 11,
  "Exterior Detail": 12,
  "Interior Dashboard": 13,
  "Interior Driver Seat": 14,
  "Interior Passenger Seat": 15,
  "Interior Rear Seat": 16,
  "Interior Door Panel": 17,
  "Interior Steering Wheel": 18,
  "Interior Center Console": 19,
  "Interior Infotainment": 20,
  "Interior Roof": 21,
  "Interior Sunroof": 22,
  "Technical Backup Camera": 23,
  "Technical Gauge Cluster": 24,
  "Technical Navigation Screen": 25,
  "Technical Key": 26,
  "Technical VIN Sticker": 27,
  "Technical Odometer": 28,
  "Technical Window Sticker": 29,
  "Dealer Document": 30,
  "Dealer Warranty": 31,
  "Dealer Inspection": 32,
  "Miscellaneous": 33,
};

// Images that receive the studio background composite (BRIA Product Shot).
// ONLY full-vehicle exterior shots where the complete vehicle silhouette is visible.
// Close-up detail shots (headlights, badges, wheels, etc.) are EXCLUDED — enhancement only.
export const STUDIO_EXTERIOR_CLASSIFICATIONS = new Set<string>([
  "Exterior Front",
  "Exterior Front 45",
  "Exterior Side",
  "Exterior Rear 45",
  "Exterior Rear",
]);

// All exterior types (isExterior = 1) — includes both studio and close-up secondary.
// Secondary exterior types (Wheel, Headlights, Badge, etc.) are exterior but
// receive enhancement only — no background removal, no studio placement.
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
  "Exterior Headlights",
  "Exterior Taillights",
  "Exterior Badge",
  "Exterior Detail",
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
