import {
  db,
  creativeTemplatesTable,
  dealerBrandDnaTable,
  dealersTable,
} from "@workspace/db";
import { asc } from "drizzle-orm";
import type { Logger } from "pino";
import { CREATIVE_TEMPLATES } from "./templates";

// Brand-red defaults matched to the dashboard theme.
const DEFAULT_DNA = {
  primaryColors: ["#E11D2A"],
  secondaryColors: ["#0B0B0F"],
  accentColors: ["#F5F5F5"],
  preferredFont: "Inter",
  brandStyle: "Sport",
  backgroundStyle: "Dark Studio",
  defaultTemplateKey: "marketplace-premium",
};

export async function seedCreative(log: Logger): Promise<void> {
  // Upsert the template catalog so new/edited templates are reflected on boot.
  for (const t of CREATIVE_TEMPLATES) {
    await db
      .insert(creativeTemplatesTable)
      .values({
        key: t.key,
        name: t.name,
        description: t.description,
        category: t.category,
        recommendedBrandStyle: t.recommendedBrandStyle,
        sortOrder: t.sortOrder,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: creativeTemplatesTable.key,
        set: {
          name: t.name,
          description: t.description,
          category: t.category,
          recommendedBrandStyle: t.recommendedBrandStyle,
          sortOrder: t.sortOrder,
          isActive: true,
        },
      });
  }
  log.info({ count: CREATIVE_TEMPLATES.length }, "Seeded creative templates");

  // Ensure the launch dealer has a Brand DNA row so creatives are on-brand.
  const [dealer] = await db.select().from(dealersTable).orderBy(asc(dealersTable.id)).limit(1);
  if (!dealer) {
    log.warn("No dealer found; skipping Brand DNA seed");
    return;
  }

  const existing = await db.select().from(dealerBrandDnaTable);
  if (existing.some((d) => d.dealerId === dealer.id)) return;

  await db.insert(dealerBrandDnaTable).values({ dealerId: dealer.id, ...DEFAULT_DNA });
  log.info({ dealerId: dealer.id }, "Seeded default dealer Brand DNA");
}
