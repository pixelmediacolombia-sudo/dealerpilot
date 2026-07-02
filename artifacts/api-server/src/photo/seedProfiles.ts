// Seed the two built-in photo quality profiles.
// Idempotent — skips if either profile already exists.
// Called on server startup after seedAiStudio.
import { db, photoQualityProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";

const BUILT_IN_PROFILES = [
  {
    name: "Dealer Lot Photography",
    description:
      "Realistic thresholds for outdoor dealership inventory — smartphone photos, varying light, no controlled studio setup. Default profile.",
    marketplaceReadyThreshold: 78,
    naturalnessThreshold:      70,
    artifactThreshold:         65,
    improvementDelta:          5,
    isActive: true,
  },
  {
    name: "Professional Studio",
    description:
      "Strict thresholds for future controlled-light studio shoots, premium dealer photo packages, and background-replacement workflows.",
    marketplaceReadyThreshold: 85,
    naturalnessThreshold:      85,
    artifactThreshold:         85,
    improvementDelta:          5,
    isActive: false,
  },
] as const;

export async function seedPhotoQualityProfiles(log: Logger): Promise<void> {
  for (const profile of BUILT_IN_PROFILES) {
    const existing = await db
      .select({ id: photoQualityProfilesTable.id })
      .from(photoQualityProfilesTable)
      .where(eq(photoQualityProfilesTable.name, profile.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(photoQualityProfilesTable).values(profile);
      log.info({ profile: profile.name }, "Seeded photo quality profile");
    }
  }
}
