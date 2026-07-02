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

// Canonical photo classifications for Marketplace + Meta catalog.
// Order here defines the default sort priority (lower index = higher priority).
export const PHOTO_CLASSIFICATIONS = [
  "Exterior Front",
  "Exterior Front 45",
  "Exterior Side",
  "Exterior Rear 45",
  "Exterior Rear",
  "Wheels",
  "Engine",
  "Interior Front",
  "Interior Dashboard",
  "Interior Rear Seats",
  "Trunk",
  "Miscellaneous",
] as const;

export type PhotoClassification = (typeof PHOTO_CLASSIFICATIONS)[number];

export const CLASSIFICATION_PRIORITY: Record<PhotoClassification, number> = {
  "Exterior Front": 0,
  "Exterior Front 45": 1,
  "Exterior Side": 2,
  "Exterior Rear 45": 3,
  "Exterior Rear": 4,
  Wheels: 5,
  Engine: 6,
  "Interior Front": 7,
  "Interior Dashboard": 8,
  "Interior Rear Seats": 9,
  Trunk: 10,
  Miscellaneous: 11,
};

export const EXTERIOR_CLASSIFICATIONS = new Set<string>([
  "Exterior Front",
  "Exterior Front 45",
  "Exterior Side",
  "Exterior Rear 45",
  "Exterior Rear",
  "Wheels",
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
