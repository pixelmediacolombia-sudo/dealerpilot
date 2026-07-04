import { Router } from "express";
import { eq, and, ne, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  vehiclesTable,
  vehicleImagesTable,
  vehicleIntelligenceTable,
  listingsTable,
  gmDecisionLogTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { z } from "zod/v4";

const router = Router();
const DEALER_ID = 1;

// ─── In-memory cache: vehicleId → { result, expiresAt } ──────────────────────
const analysisCache = new Map<number, { result: GmAnalysisResult; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Read-only accessor for other route modules (e.g. batch creation guardrail).
 * Returns the cached GM decision if still valid, or null if absent/expired.
 */
export function getCachedGmDecision(vehicleId: number): GmAnalysisResult | null {
  const entry = analysisCache.get(vehicleId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.result;
}

interface GmAnalysisResult {
  vehicleId: number;
  recommendation: "PUBLISH" | "HOLD" | "RECONSIDER";
  whyPublish: string;
  riskWarning: string | null;
  betterAlternative: string | null;
  hasBetterAlternative: boolean;
  adAngle: string;
  suggestedLanguage: string;
  expectedImpact: string;
  timingRecommendation: string | null;
  audienceOverlapWarning: string | null;
  duplicateConflictWarning: string | null;
  confidence: number;
  cachedAt: string;
}

// ─── Build structured prompt from real DB data ────────────────────────────────
async function buildVehicleContext(vehicleId: number) {
  // 1. Vehicle base data
  const vehicle = await db.query.vehiclesTable.findFirst({
    where: and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.dealerId, DEALER_ID)),
  });
  if (!vehicle) return null;

  // 2. Opportunity intelligence
  const intel = await db.query.vehicleIntelligenceTable.findFirst({
    where: eq(vehicleIntelligenceTable.vehicleId, vehicleId),
  });

  // 3. Photo count
  const photos = await db.select().from(vehicleImagesTable).where(eq(vehicleImagesTable.vehicleId, vehicleId));

  // 4. Active listing status
  const listing = await db.query.listingsTable.findFirst({
    where: eq(listingsTable.vehicleId, vehicleId),
  });

  // 5. Same-model siblings with intelligence (for duplicate/alternative context)
  const siblings = await db
    .select({
      id: vehiclesTable.id,
      year: vehiclesTable.year,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      trim: vehiclesTable.trim,
      price: vehiclesTable.price,
      mileage: vehiclesTable.mileage,
      opportunityScore: vehicleIntelligenceTable.opportunityScore,
      primarySegment: vehicleIntelligenceTable.primarySegment,
    })
    .from(vehiclesTable)
    .leftJoin(vehicleIntelligenceTable, eq(vehicleIntelligenceTable.vehicleId, vehiclesTable.id))
    .where(
      and(
        eq(vehiclesTable.dealerId, DEALER_ID),
        eq(vehiclesTable.make, vehicle.make),
        eq(vehiclesTable.model, vehicle.model),
        ne(vehiclesTable.id, vehicleId),
        eq(vehiclesTable.status, "active"),
      ),
    )
    .limit(5);

  return { vehicle, intel, photoCount: photos.length, listing, siblings };
}

// ─── POST /gm/analyze ─────────────────────────────────────────────────────────
router.post("/gm/analyze", async (req, res) => {
  const body = z.object({
    vehicleId: z.number().int().positive(),
    priceDeltaPercent: z.number().nullish(),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { vehicleId, priceDeltaPercent } = body.data;

  // Cache hit (skip for what-if variants)
  if (!priceDeltaPercent) {
    const cached = analysisCache.get(vehicleId);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.result);
      return;
    }
  }

  const ctx = await buildVehicleContext(vehicleId);
  if (!ctx) {
    res.status(422).json({ error: "Vehicle not found or does not belong to this dealer" });
    return;
  }

  const { vehicle, intel, photoCount, listing, siblings } = ctx;
  const priceDisplay = priceDeltaPercent
    ? Math.round((vehicle.price ?? 0) * (1 + priceDeltaPercent / 100))
    : (vehicle.price ?? 0);

  // Build the data brief for OpenAI — no invented data, only DB values
  const dataBrief = `
VEHICLE DATA (Alpha Motorsport inventory — do NOT invent any data beyond what is listed here):

Vehicle: ${vehicle.year ?? "Unknown"} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}
Stock #: ${vehicle.stockNumber ?? "N/A"}
Mileage: ${vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} miles` : "Unknown"}
Current Price: $${(vehicle.price ?? 0).toLocaleString()}${priceDeltaPercent ? ` → Hypothetical price: $${priceDisplay.toLocaleString()} (${priceDeltaPercent > 0 ? "+" : ""}${priceDeltaPercent}%)` : ""}
Body Style: ${vehicle.bodyStyle ?? "Unknown"}
Fuel Type: ${vehicle.fuelType ?? "Unknown"}
Color: ${vehicle.exteriorColor ?? "Unknown"}
Lot Location: ${vehicle.lotLocation ?? "Unknown"}
Photos: ${photoCount} available
Current Listing Status: ${listing?.status ?? "Not yet listed"}

OPPORTUNITY ENGINE DATA:
Opportunity Score: ${intel?.opportunityScore ?? "N/A"} / 100
Primary Buyer Segment: ${intel?.primarySegment ?? "General"}
Secondary Segment: ${intel?.secondarySegment ?? "None"}
Why This Audience: ${intel?.whyThisAudience ?? "Not analyzed yet"}
Suggested Ad Angle: ${intel?.adAngle ?? "Not generated"}
Suggested Language: ${intel?.suggestedLanguage ?? "English"}
Confidence Score: ${intel?.confidenceScore ?? "N/A"}
Price Strategy: ${intel?.recommendedPriceStrategy ?? "Unknown"}

COMPETING SAME-MODEL VEHICLES IN INVENTORY:
${siblings.length === 0
  ? "No other units of this model in active inventory."
  : siblings.map(s =>
      `- ${s.year ?? "?"} ${s.make} ${s.model}${s.trim ? ` ${s.trim}` : ""}: $${(s.price ?? 0).toLocaleString()}, ${s.mileage?.toLocaleString() ?? "?"} mi, Score: ${s.opportunityScore ?? "?"}, Segment: ${s.primarySegment ?? "General"}`
    ).join("\n")}
`.trim();

  const systemPrompt = `You are DealerPilot, the AI General Manager for Alpha Motorsport, a used car dealership.

Your job is to review a vehicle before an operator publishes it to Facebook Marketplace and provide an honest, data-grounded executive recommendation.

RULES:
1. NEVER invent data. Only reason over the data provided. If something is unknown, say so.
2. Write like a seasoned dealership GM — direct, confident, concise. No bullet-point lists in the narrative fields.
3. Be honest about risk. If photos are low or mileage is high, say so.
4. If another unit in inventory would outperform this one, recommend it specifically.
5. Every field must be based on the actual data provided.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "recommendation": "PUBLISH" | "HOLD" | "RECONSIDER",
  "whyPublish": "string — 2-3 sentences, GM voice, why this vehicle NOW",
  "riskWarning": "string | null — main risk if any (1 sentence). null if LOW risk",
  "betterAlternative": "string | null — e.g. '2023 Tesla Model Y — higher score, lower mileage'. null if no better option exists",
  "hasBetterAlternative": true | false,
  "adAngle": "string — the single best hook line for the Facebook ad",
  "suggestedLanguage": "string — English | Spanish | Bilingual",
  "expectedImpact": "string — 1 sentence on expected reach/conversations",
  "timingRecommendation": "string | null — publish now, or wait for what reason. null if now is fine",
  "audienceOverlapWarning": "string | null — if another live listing targets the same audience. null if none",
  "duplicateConflictWarning": "string | null — if publishing this would create self-competition. null if none",
  "confidence": integer 40-99
}`;

  let raw: string;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: dataBrief },
      ],
    });
    const choice = response.choices[0];
    raw = choice?.message?.content || "";
    req.log.info({ finishReason: choice?.finish_reason, rawLen: raw.length }, "GM OpenAI response");
  } catch (err) {
    req.log.error({ err }, "OpenAI GM analysis failed");
    res.status(503).json({ error: "AI analysis temporarily unavailable" });
    return;
  }

  if (!raw) {
    req.log.error({ raw }, "GM analysis: empty content from OpenAI");
    res.status(503).json({ error: "AI analysis returned empty response" });
    return;
  }

  // Parse JSON — strip markdown fences if present, find JSON object if wrapped in prose
  let parsed: Omit<GmAnalysisResult, "vehicleId" | "cachedAt">;
  try {
    // Try to extract JSON object from anywhere in the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    req.log.error({ raw: raw.slice(0, 500) }, "GM analysis JSON parse failed");
    res.status(503).json({ error: "AI analysis returned unexpected format" });
    return;
  }

  const result: GmAnalysisResult = {
    vehicleId,
    recommendation: parsed.recommendation ?? "RECONSIDER",
    whyPublish: parsed.whyPublish ?? "",
    riskWarning: parsed.riskWarning ?? null,
    betterAlternative: parsed.betterAlternative ?? null,
    hasBetterAlternative: parsed.hasBetterAlternative ?? false,
    adAngle: parsed.adAngle ?? "",
    suggestedLanguage: parsed.suggestedLanguage ?? "English",
    expectedImpact: parsed.expectedImpact ?? "",
    timingRecommendation: parsed.timingRecommendation ?? null,
    audienceOverlapWarning: parsed.audienceOverlapWarning ?? null,
    duplicateConflictWarning: parsed.duplicateConflictWarning ?? null,
    confidence: typeof parsed.confidence === "number" ? Math.min(99, Math.max(40, parsed.confidence)) : 70,
    cachedAt: new Date().toISOString(),
  };

  // Cache only non-what-if analyses
  if (!priceDeltaPercent) {
    analysisCache.set(vehicleId, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  res.json(result);
});

// ─── POST /gm/whatif — deterministic, no AI call ─────────────────────────────
router.post("/gm/whatif", async (req, res) => {
  const body = z.object({
    vehicleId: z.number().int().positive(),
    priceDeltaPercent: z.number(),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { vehicleId, priceDeltaPercent } = body.data;

  const vehicle = await db.query.vehiclesTable.findFirst({
    where: and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.dealerId, DEALER_ID)),
  });
  if (!vehicle) {
    res.status(422).json({ error: "Vehicle not found" });
    return;
  }

  const intel = await db.query.vehicleIntelligenceTable.findFirst({
    where: eq(vehicleIntelligenceTable.vehicleId, vehicleId),
  });

  const currentPrice = vehicle.price ?? 18_000;
  const hypotheticalPrice = Math.round(currentPrice * (1 + priceDeltaPercent / 100));
  const score = intel?.opportunityScore ?? 60;

  // Price elasticity model: each -5% = +12% conversations (diminishing returns on positive delta)
  const elasticityFactor = priceDeltaPercent < 0
    ? Math.abs(priceDeltaPercent) * 2.4   // price cut boosts conversations
    : -priceDeltaPercent * 1.8;            // price hike reduces them

  const conversationsDeltaPct = Math.round(Math.max(-60, Math.min(60, elasticityFactor)));
  const appointmentsDeltaPct = Math.round(conversationsDeltaPct * 0.72);
  const saleProbabilityDelta = Math.round(conversationsDeltaPct * 0.22);

  // Confidence: high when we have good opportunity score and reasonable delta
  const confidence = Math.min(92, Math.max(45,
    score * 0.6 + (Math.abs(priceDeltaPercent) < 10 ? 20 : 10),
  ));

  let explanation: string;
  if (priceDeltaPercent === 0) {
    explanation = "No price change. Projections are unchanged from the base scenario.";
  } else if (priceDeltaPercent < 0) {
    explanation = `Lowering the price by ${Math.abs(priceDeltaPercent)}% (to $${hypotheticalPrice.toLocaleString()}) is expected to increase buyer inquiries by approximately ${conversationsDeltaPct}%. Facebook Marketplace buyers are highly price-sensitive, and a sub-$${Math.round(hypotheticalPrice / 1000) * 1000 + (hypotheticalPrice % 1000 < 500 ? 0 : 1000)} price point typically triggers a measurable spike in messages.`;
  } else {
    explanation = `Raising the price by ${priceDeltaPercent}% (to $${hypotheticalPrice.toLocaleString()}) is expected to reduce buyer inquiries by approximately ${Math.abs(conversationsDeltaPct)}%. Marketplace buyers are highly price-sensitive and compare multiple listings instantly. This change may push the vehicle outside the target buyer's budget threshold.`;
  }

  res.json({
    vehicleId,
    currentPrice,
    hypotheticalPrice,
    priceDeltaPercent,
    conversationsDeltaPct,
    appointmentsDeltaPct,
    saleProbabilityDelta,
    confidence: Math.round(confidence),
    explanation,
  });
});

// ─── Shared helper: persist a GM decision to the DB ──────────────────────────
// Fire-and-forget safe: callers do not need to await this; errors are swallowed
// so a log write never blocks the primary publish flow.
export async function recordGmDecision(entry: {
  vehicleId: number;
  vehicleLabel: string;
  gmRecommendation: string;
  gmConfidence?: number | null;
  operatorAction: "confirmed_publish" | "held" | "overridden" | "batch_blocked" | "batch_published";
  overridden: boolean;
  finalPublishStatus: "published" | "held" | "batch_blocked";
  notes?: string;
}): Promise<void> {
  try {
    await db.insert(gmDecisionLogTable).values({
      vehicleId: entry.vehicleId,
      vehicleLabel: entry.vehicleLabel,
      gmRecommendation: entry.gmRecommendation,
      gmConfidence: entry.gmConfidence ?? null,
      operatorAction: entry.operatorAction,
      overridden: entry.overridden,
      finalPublishStatus: entry.finalPublishStatus,
      notes: entry.notes ?? null,
    });
  } catch {
    // Non-fatal: decision log writes must never break the publish flow
  }
}

// ─── POST /gm/decisions — record an operator decision ────────────────────────
const RecordDecisionBody = z.object({
  vehicleId: z.number().int().positive(),
  vehicleLabel: z.string().min(1),
  gmRecommendation: z.enum(["PUBLISH", "HOLD", "RECONSIDER"]),
  gmConfidence: z.number().int().optional(),
  operatorAction: z.enum(["confirmed_publish", "held", "overridden", "batch_blocked", "batch_published"]),
  overridden: z.boolean(),
  finalPublishStatus: z.enum(["published", "held", "batch_blocked"]),
  notes: z.string().optional(),
});

router.post("/gm/decisions", async (req, res) => {
  const parsed = RecordDecisionBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const [row] = await db
    .insert(gmDecisionLogTable)
    .values({
      ...parsed.data,
      gmConfidence: parsed.data.gmConfidence ?? null,
      notes: parsed.data.notes ?? null,
    })
    .returning();
  req.log.info(
    { vehicleId: parsed.data.vehicleId, operatorAction: parsed.data.operatorAction },
    "GM decision recorded",
  );
  res.status(201).json(row);
});

// ─── GET /gm/decisions — list recent decisions ───────────────────────────────
router.get("/gm/decisions", async (req, res) => {
  const vehicleIdParam = req.query.vehicleId ? Number(req.query.vehicleId) : null;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));

  const rows = await db
    .select()
    .from(gmDecisionLogTable)
    .where(vehicleIdParam ? eq(gmDecisionLogTable.vehicleId, vehicleIdParam) : undefined)
    .orderBy(desc(gmDecisionLogTable.createdAt))
    .limit(limit);

  res.json({ decisions: rows });
});

export default router;
