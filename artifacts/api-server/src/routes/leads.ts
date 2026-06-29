import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, leadsTable, downPaymentIntelligenceTable } from "@workspace/db";

const router = Router();

const DEALER_ID = 1;

router.get("/leads", async (req, res) => {
  const dealerId = Number(req.query.dealerId) || DEALER_ID;
  const temperature = req.query.temperature as string | undefined;
  const status = req.query.status as string | undefined;

  const conditions = [eq(leadsTable.dealerId, dealerId)];
  if (temperature) conditions.push(eq(leadsTable.temperature, temperature));
  if (status) conditions.push(eq(leadsTable.status, status));

  const leads = await db
    .select()
    .from(leadsTable)
    .where(and(...conditions))
    .orderBy(desc(leadsTable.updatedAt));

  res.json({ leads });
});

router.get("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, id))
    .limit(1);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json({ lead });
});

router.patch("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  const updates = req.body as Partial<typeof leadsTable.$inferInsert>;
  const [updated] = await db
    .update(leadsTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(leadsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json({ lead: updated });
});

router.get("/down-payment-intelligence", async (req, res) => {
  const dealerId = Number(req.query.dealerId) || DEALER_ID;

  const rows = await db
    .select()
    .from(downPaymentIntelligenceTable)
    .where(eq(downPaymentIntelligenceTable.dealerId, dealerId))
    .orderBy(desc(downPaymentIntelligenceTable.createdAt));

  type VehicleTypeGroup = {
    vehicleType: string;
    byDownPayment: Record<
      number,
      {
        publishedDownPayment: number;
        totalConversations: number;
        hotLeads: number;
        appointmentReady: number;
      }
    >;
  };
  const byType: Record<string, VehicleTypeGroup> = {};

  for (const row of rows) {
    const vt = row.vehicleType ?? "unknown";
    const dp = row.publishedDownPayment ?? 0;
    if (!byType[vt]) byType[vt] = { vehicleType: vt, byDownPayment: {} };
    if (!byType[vt].byDownPayment[dp]) {
      byType[vt].byDownPayment[dp] = {
        publishedDownPayment: dp,
        totalConversations: 0,
        hotLeads: 0,
        appointmentReady: 0,
      };
    }
    byType[vt].byDownPayment[dp].totalConversations++;
    if (row.leadTemperature === "Hot") byType[vt].byDownPayment[dp].hotLeads++;
    if (row.appointmentIntent) byType[vt].byDownPayment[dp].appointmentReady++;
  }

  const summary = Object.values(byType).map((g) => ({
    vehicleType: g.vehicleType,
    variants: Object.values(g.byDownPayment).sort(
      (a, b) => b.hotLeads - a.hotLeads,
    ),
  }));

  res.json({ summary, total: rows.length });
});

export default router;
