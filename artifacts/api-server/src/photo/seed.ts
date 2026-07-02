// Seed the default AI Studio Pack for Alpha Motorsport (dealer 1).
// Called on server startup after creative seed.
// Idempotent — does nothing if the default pack already exists.
import { db, aiStudioPacksTable, dealersTable } from "@workspace/db";
import { asc, and, eq } from "drizzle-orm";
import type { Logger } from "pino";

export async function seedAiStudio(log: Logger): Promise<void> {
  const [dealer] = await db.select().from(dealersTable).orderBy(asc(dealersTable.id)).limit(1);
  if (!dealer) {
    log.warn("No dealer found; skipping AI Studio seed");
    return;
  }

  const existing = await db
    .select({ id: aiStudioPacksTable.id })
    .from(aiStudioPacksTable)
    .where(
      and(eq(aiStudioPacksTable.dealerId, dealer.id), eq(aiStudioPacksTable.isDefault, true)),
    )
    .limit(1);

  if (existing.length > 0) return;

  // backgroundUrl from env var — null until dealer uploads a studio background.
  const backgroundUrl = process.env["AI_STUDIO_BACKGROUND"] ?? null;

  await db.insert(aiStudioPacksTable).values({
    dealerId: dealer.id,
    name: "Alpha Motorsport Studio",
    slug: "alpha-studio",
    backgroundUrl,
    backgroundVersion: "v1",
    lightingPreset: "studio_white",
    vehicleScale: 1.0,
    vehicleOffsetX: 0,
    vehicleOffsetY: 0,
    isDefault: true,
    isActive: true,
  });

  log.info(
    { dealerId: dealer.id, backgroundUrl: backgroundUrl ?? "(not configured)" },
    "Seeded default AI Studio pack",
  );
}
