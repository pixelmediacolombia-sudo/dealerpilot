// Change detection for AI Photo Studio.
// Computes a stable hash from all inputs that, when changed, should trigger re-processing:
//   - vehicle photo URLs (sorted for stability)
//   - studio pack background version
//   - AI model version
//   - preset version
// If the computed hash matches the vehicle's aiPhotoHash, skip re-processing.
import { createHash } from "crypto";

export interface ChangeDetectionInputs {
  photoUrls: string[];
  backgroundVersion: string;
  modelVersion: string;
  presetVersion: string;
}

export function computePhotoHash(inputs: ChangeDetectionInputs): string {
  const sorted = [...inputs.photoUrls].sort().join("|");
  const raw = [sorted, inputs.backgroundVersion, inputs.modelVersion, inputs.presetVersion].join(
    "::",
  );
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function hasChanged(
  currentHash: string | null | undefined,
  inputs: ChangeDetectionInputs,
): boolean {
  if (!currentHash) return true;
  return currentHash !== computePhotoHash(inputs);
}
