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

const LIGHT_DEALER_DNA = {
  primaryColors: ["#7658D6"],
  secondaryColors: ["#F3F4F8"],
  accentColors: ["#7658D6"],
  preferredFont: "Inter",
  brandStyle: "Modern",
  backgroundStyle: "Light Neutral",
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

  // Ensure every dealer has its own Brand DNA row. Existing rows are never
  // overwritten, so adding a dealer or changing Lucki's palette cannot alter
  // Alpha or any other dealer.
  const dealers = await db.select().from(dealersTable).orderBy(asc(dealersTable.id));
  if (dealers.length === 0) {
    log.warn("No dealer found; skipping Brand DNA seed");
    return;
  }

  const existing = await db.select().from(dealerBrandDnaTable);
  const existingDealerIds = new Set(existing.map((d) => d.dealerId));
  for (const dealer of dealers) {
    if (existingDealerIds.has(dealer.id)) continue;
    const dna = dealer.name === "Lucki Mazda" ? LIGHT_DEALER_DNA : DEFAULT_DNA;
    await db.insert(dealerBrandDnaTable).values({ dealerId: dealer.id, ...dna });
    log.info({ dealerId: dealer.id }, "Seeded default dealer Brand DNA");
  }
}
