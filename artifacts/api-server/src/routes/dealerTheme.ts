import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, dealerBrandDnaTable, dealersTable } from "@workspace/db";

const router: IRouter = Router();

function safeColors(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const colors = value
    .map((color) => {
      if (typeof color !== "string") return null;
      const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (!match) return null;
      const hex = match[1]!.toLowerCase();
      return `#${hex.length === 3 ? hex.split("").map((channel) => channel + channel).join("") : hex}`;
    })
    .filter((color): color is string => color !== null);
  return colors.length > 0 ? colors : fallback;
}

function parseDealerId(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Public, non-secret theme payload consumed by the browser extensions. */
router.get("/dealers/:dealerId/theme", async (req, res) => {
  const dealerId = parseDealerId(req.params.dealerId);
  if (dealerId === null) {
    res.status(400).json({ error: "Invalid dealer id" });
    return;
  }

  const [[dealer], [dna]] = await Promise.all([
    db.select({ id: dealersTable.id, name: dealersTable.name }).from(dealersTable).where(eq(dealersTable.id, dealerId)).limit(1),
    db.select().from(dealerBrandDnaTable).where(eq(dealerBrandDnaTable.dealerId, dealerId)).limit(1),
  ]);
  if (!dealer) {
    res.status(404).json({ error: "Dealer not found" });
    return;
  }

  // Theme changes must be visible immediately in the dashboard and extensions.
  // The payload is public brand data, but serving an old palette is worse than
  // a small extra request because it makes a successful save appear broken.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.json({
    dealerId,
    dealerName: dealer.name,
    primaryColors: safeColors(dna?.primaryColors, ["#7658d6"]),
    secondaryColors: safeColors(dna?.secondaryColors, ["#20243b"]),
    accentColors: safeColors(dna?.accentColors, ["#42b883"]),
    logoUrl: dna?.logoUrl ?? null,
    preferredFont: dna?.preferredFont ?? "Inter",
    updatedAt: dna?.updatedAt?.toISOString() ?? null,
  });
});

export default router;
