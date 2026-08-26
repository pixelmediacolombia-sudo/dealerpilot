import { openai } from "@workspace/integrations-openai-ai-server";
import type { Vehicle } from "@workspace/db";
import { z } from "zod/v4";
import { buildDownPaymentInstruction, type DownPaymentPolicy } from "../downPayment/policy";

export interface GeneratedListing {
  title: string;
  descriptionEn: string;
  descriptionEs: string;
  callToAction: string;
  buyerProfile: string;
  copyAngle: string;
  language: string;
  priority: string;
  downPayment: number | null;
  askingPrice: number | null;
  category: VehicleCategory;
}

// ─── Emoji sanitizer ─────────────────────────────────────────────────────────

const ALLOWED_EMOJI_CHARS = "🔥🚗✅💥📩💰⚡⏳";

function sanitizeTitle(raw: string): string {
  const cleaned = raw.replace(/\p{Extended_Pictographic}/gu, (ch) =>
    ALLOWED_EMOJI_CHARS.includes(ch) ? ch : ""
  );
  const collapsed = cleaned.replace(/\s+/g, " ").trim();
  return collapsed.length > 70 ? collapsed.slice(0, 70).trim() : collapsed;
}

// ─── Vehicle category detection ──────────────────────────────────────────────

type VehicleCategory =
  | "truck"
  | "suv"
  | "sedan"
  | "sports"
  | "luxury"
  | "hybrid_electric"
  | "van";

function detectCategory(vehicle: Vehicle): VehicleCategory {
  const body = (vehicle.bodyStyle ?? "").toLowerCase();
  const make = (vehicle.make ?? "").toLowerCase();
  const model = (vehicle.model ?? "").toLowerCase();
  const trim = (vehicle.trim ?? "").toLowerCase();
  const fuel = (vehicle.fuelType ?? "").toLowerCase();
  const price = vehicle.price ?? 0;

  if (fuel === "electric" || fuel === "hybrid" || model.includes("hybrid") || trim.includes("hybrid") || trim.includes("electric")) return "hybrid_electric";
  if (body.includes("truck") || body.includes("pickup") || model.includes("f-150") || model.includes("f150") || model.includes("silverado") || model.includes("ram 1500") || model.includes("tundra") || model.includes("tacoma") || model.includes("ranger") || model.includes("colorado") || model.includes("frontier")) return "truck";
  if (body.includes("van") || body.includes("minivan") || model.includes("transit") || model.includes("sienna") || model.includes("odyssey") || model.includes("caravan") || model.includes("express")) return "van";
  if (body.includes("suv") || body.includes("crossover") || model.includes("tahoe") || model.includes("yukon") || model.includes("suburban") || model.includes("expedition") || model.includes("navigator") || model.includes("pilot") || model.includes("highlander") || model.includes("pathfinder") || model.includes("armada")) return "suv";
  if (price >= 35_000 && (make.includes("bmw") || make.includes("mercedes") || make.includes("audi") || make.includes("lexus") || make.includes("cadillac") || make.includes("acura") || make.includes("infiniti") || make.includes("lincoln") || make.includes("genesis") || make.includes("porsche") || make.includes("volvo") || make.includes("jaguar") || make.includes("land rover"))) return "luxury";
  if (body.includes("coupe") || body.includes("convertible") || model.includes("mustang") || model.includes("camaro") || model.includes("challenger") || model.includes("corvette") || model.includes("charger") || model.includes("86") || model.includes("brz") || model.includes("miata") || trim.includes("sport") || trim.includes("ss") || trim.includes("gt") || trim.includes("turbo")) return "sports";
  return "sedan";
}

// ─── Category strategy blocks ─────────────────────────────────────────────────

const CATEGORY_STRATEGIES: Record<VehicleCategory, string> = {
  truck: `VEHICLE CATEGORY: Pickup / Truck
Copy angle: "contractor truck" or "work-ready truck" or "daily driver truck"
Focus: work capability, reliability, towing, hauling, construction use, contractors, weekend adventures
Hook must reference: work, hauling, reliability, or power
Sample bullets: ✅ Ready for Work & Play • ✅ Towing Capable • ✅ Bed Space for Any Job • ✅ 4WD Available
Sample hooks: 🔥 Need a truck that works as hard as you do? / 🔥 Built for the job site and the weekend.
Sample CTA: 🚗 Come test drive it — it hauls, it tows, it delivers.`,

  suv: `VEHICLE CATEGORY: SUV / Crossover
Copy angle: "family SUV" or "adventure SUV" or "road trip ready"
Focus: family space, comfort, safety, AWD/4WD when available, road trips, cargo room, third row if applicable
Hook must reference: family, space, safety, adventure, or school runs
Sample bullets: ✅ Room for the Whole Family • ✅ AWD / 4WD • ✅ Third Row Seating • ✅ Tons of Cargo Space
Sample hooks: 🔥 Need space for the whole family? / 🔥 Adventure-ready and financing-friendly.
Sample CTA: 📩 Message us — let's get your family into this SUV today.`,

  sedan: `VEHICLE CATEGORY: Sedan
Copy angle: "first-time buyer sedan" or "fuel saver" or "commuter sedan"
Focus: gas savings, commuting efficiency, easy financing, first car, affordability, reliability
Hook must reference: commuting, savings, first car, or affordable reliability
Sample bullets: ✅ Great on Gas • ✅ Easy Financing • ✅ Perfect First Car • ✅ Low Maintenance
Sample hooks: 🔥 Reliable, affordable, and ready to drive home today. / 🔥 Great on gas — even better on your wallet.
Sample CTA: 📩 Message us today — financing is available for all credit types.`,

  sports: `VEHICLE CATEGORY: Sports / Coupe / Performance
Copy angle: "performance buyer" or "weekend driver" or "head-turning style"
Focus: excitement, style, power, head-turning design, weekend driving, sporty feel, driving fun
Hook must reference: performance, style, excitement, or turning heads
Sample bullets: ✅ Heads Will Turn • ✅ Sport Mode • ✅ Performance Engine • ✅ Sleek Interior
Sample hooks: 🔥 Turn heads everywhere you go. / 🔥 Built for the driver who loves the road.
Sample CTA: 🔥 Come feel the power — test drive it today.`,

  luxury: `VEHICLE CATEGORY: Luxury
Copy angle: "luxury comfort" or "premium feel" or "upscale daily driver"
Focus: premium feel, brand prestige, smooth ride, upscale interior, comfort, technology
Hook must reference: premium, comfort, prestige, or upscale feel
Sample bullets: ✅ Premium Interior • ✅ Smooth Ride • ✅ Loaded with Features • ✅ Brand Prestige
Sample hooks: 🔥 Experience luxury without the luxury price tag. / 🚗 Premium ride. Surprisingly accessible.
Sample CTA: 📩 Message us — experience the difference today.`,

  hybrid_electric: `VEHICLE CATEGORY: Hybrid / Electric
Copy angle: "fuel saver" or "tech-forward driver" or "modern commuter"
Focus: fuel savings, efficiency, technology, modern driving, low running costs, environmental benefit
Hook must reference: fuel savings, efficiency, technology, or smart driving
Sample bullets: ✅ Outstanding Fuel Economy • ✅ Save at the Pump • ✅ Modern Technology • ✅ Low Running Costs
Sample hooks: 🔥 Save on gas every single day. / ⚡ Smart, efficient, and ready to drive.
Sample CTA: 📩 Message us — start saving at the pump.`,

  van: `VEHICLE CATEGORY: Van / Work Vehicle
Copy angle: "contractor van" or "family mover" or "cargo workhorse"
Focus: cargo space, business use, delivery, fleet, contractors, family hauling, utility
Hook must reference: business, cargo, utility, or work capacity
Sample bullets: ✅ Massive Cargo Space • ✅ Business Ready • ✅ Easy to Load • ✅ Reliable Work Vehicle
Sample hooks: 🔥 Your business deserves a reliable workhorse. / 🔥 Cargo space. Reliability. Financing available.
Sample CTA: 📩 Message us — perfect for work, delivery, or family.`,
};

// ─── Anti-duplicate variation seeds ──────────────────────────────────────────
// Use the vehicleId mod small prime to pick different hook/CTA variations
// for vehicles with the same make/model so listings never look identical.

function variationIndex(vehicleId: number, poolSize: number): number {
  return vehicleId % poolSize;
}

const HOOK_VARIATIONS = [
  "lead with urgency (won't last long, limited stock)",
  "lead with financing accessibility (easy financing, all credit welcome)",
  "lead with the lifestyle benefit (perfect for [use case])",
  "lead with the price/value angle (priced to move, best deal around)",
  "lead with a question that speaks to the buyer's need",
];

const CTA_VARIATIONS = [
  "📩 Send us a message today!",
  "🚗 Come test drive it today.",
  "🔥 This one won't last long — act fast.",
  "⏳ First come, first served.",
  "📩 Message us now — we'll get you approved.",
];

// ─── Vehicle facts builder ────────────────────────────────────────────────────

function buildVehicleFacts(vehicle: Vehicle): Record<string, string | number> {
  const facts: Record<string, string | number> = {};
  if (vehicle.year) facts.year = vehicle.year;
  if (vehicle.make) facts.make = vehicle.make;
  if (vehicle.model) facts.model = vehicle.model;
  if (vehicle.trim) facts.trim = vehicle.trim;
  if (vehicle.mileage != null) facts.mileage = vehicle.mileage;
  if (vehicle.price != null) facts.price = vehicle.price;
  if (vehicle.exteriorColor) facts.exteriorColor = vehicle.exteriorColor;
  if (vehicle.interiorColor) facts.interiorColor = vehicle.interiorColor;
  if (vehicle.bodyStyle) facts.bodyStyle = vehicle.bodyStyle;
  if (vehicle.transmission) facts.transmission = vehicle.transmission;
  if (vehicle.fuelType) facts.fuelType = vehicle.fuelType;
  if (vehicle.description) facts.sourceDescription = vehicle.description;
  return facts;
}

// ─── Zod output schema ────────────────────────────────────────────────────────

const ModelOutput = z.object({
  title: z.string().min(1),
  descriptionEn: z.string().min(1),
  descriptionEs: z.string().min(1),
  callToAction: z.string().min(1),
  buyerProfile: z.string().min(1),
  copyAngle: z.string().min(1),
  priority: z.string().min(1),
});

// ─── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are the top-performing Facebook Marketplace car seller in the United States.

Your listings maximize: Click Through Rate, Message Rate, Save Rate, Marketplace ranking, Buyer Trust, Lead Conversion.

=== GLOBAL RULES ===
- Use ONLY the vehicle facts provided. NEVER invent specs, features, mileage, options, history, or packages not given.
- NEVER write long paragraphs.
- NEVER write filler or fluff.
- NEVER explain obvious vehicle specs.
- NEVER repeat year/make/model more than once.
- NEVER write like ChatGPT. Write like the best Marketplace seller in America.
- NEVER use: "This vehicle features...", "This is a great option...", "The exterior color...", "Equipped with..."

=== PRICING RULES (strictly enforced) ===
- Always mention the full vehicle price directly.
- Do not make the down payment the public Marketplace price.
- Financing may be mentioned only as "financing available for qualified buyers".
- NEVER say "guaranteed approval", "everyone approved", "no credit check guaranteed", or imply unconditional financing.
- NEVER say a buyer is guaranteed to qualify. Use "for qualified buyers" or "financing available".

=== TITLE ===
- Maximum 70 characters (including emojis).
- Lead with ONE emoji: 🔥 or 🚗
- Mention year, make, model once. Use • as a separator.
- Include the single most compelling hook for THIS vehicle category.
- Example: 🔥 2019 Toyota Camry • Clean Title • Approved Down Payment (when supplied)
- Example: 🚗 2021 Ford F-150 XLT • Low Miles • Tow Ready

=== DESCRIPTION STRUCTURE ===
Maximum 12 lines total. Follow this EXACT 4-section structure:

SECTION 1 — HOOK (max 2 lines)
Short, punchy, high-energy. NO specs. Match the vehicle category strategy below.
Use the hook variation style specified in the vehicle-specific instructions.

SECTION 2 — WHY BUY THIS CAR (3–5 bullets only)
Use ✅ before each bullet. Only real selling points from the vehicle facts.
Lead bullet must vary — do NOT use the same first bullet for similar vehicles.

SECTION 3 — BUYER BENEFIT (1 sentence max)
No specs. No jargon. Match the buyer profile for this vehicle type.

SECTION 4 — CTA (1 emotional line, use the CTA variation specified below)

=== SPANISH DESCRIPTION ===
- Do NOT translate literally. REWRITE naturally for Hispanic buyers.
- Use authentic Hispanic sales language and tone.
- Same 4-section structure. Must feel native and local, not translated.
- Spanish hooks: 🔥 ¿Buscas...? / 🔥 Maneja a casa hoy / 💰 Financiamiento disponible hoy
- Spanish CTAs: 📩 Escríbenos hoy mismo. / 🚗 Ven a manejarla. / ⏳ No dejes pasar esta oportunidad.

=== PUBLIC MARKETPLACE COPY ===
- DealerPilot publishes bilingual Marketplace descriptions: English first, Spanish second.
- Both languages must be friendly, skimmable, and lead with value, trust, and action.
- Use tasteful emojis from the allowed list in both English and Spanish.
- Avoid plain flat blocks with no emoji, no CTA, or no emotional hook.

=== ALLOWED EMOJIS ===
Only these: 🔥 🚗 ✅ 💥 📩 💰 ⚡ ⏳ — use only where they improve readability. Never spam.

=== JSON OUTPUT ===
Return a single JSON object with exactly these keys:
- title: the optimized Marketplace title (max 70 chars, emoji-led)
- descriptionEn: the full English description (4-section structure, max 12 lines)
- descriptionEs: the full Spanish description (4-section structure, naturally rewritten)
- callToAction: the final CTA line exactly as it appears at the end of the English description
- buyerProfile: one short sentence — who is the ideal buyer for this specific vehicle
- copyAngle: a 2–4 word label for the buyer angle (examples: "family SUV", "contractor truck", "first-time buyer sedan", "luxury comfort", "fuel saver", "performance buyer", "work van")
- priority: exactly "High", "Medium", or "Low" based on how fast-moving this vehicle is`;

// ─── Main generator ───────────────────────────────────────────────────────────

export async function generateListing(
  vehicle: Vehicle,
  downPaymentPolicy: DownPaymentPolicy = {
    configId: null,
    planAmounts: [],
    minimumAmount: null,
    vehicleOverride: null,
    source: "none",
  },
): Promise<GeneratedListing> {
  const facts = buildVehicleFacts(vehicle);
  const category = detectCategory(vehicle);
  const strategyBlock = CATEGORY_STRATEGIES[category];

  const price = vehicle.price ?? 0;
  const priceMode = "FULL_PRICE";

  const hookVariation = HOOK_VARIATIONS[variationIndex(vehicle.id, HOOK_VARIATIONS.length)];
  const ctaVariation = CTA_VARIATIONS[variationIndex(vehicle.id, CTA_VARIATIONS.length)];

  const approvedDownPayment = downPaymentPolicy.vehicleOverride ?? downPaymentPolicy.minimumAmount;
  const pricingBlock = `priceMode: FULL_PRICE
- Full asking price: $${price}
- Marketplace display price: $${price}
- Approved down-payment configuration: ${buildDownPaymentInstruction(downPaymentPolicy, "en")}
- Internal down-payment context only: ${approvedDownPayment == null ? "none" : `$${approvedDownPayment}`}
- Mention financing only as available for qualified buyers; never post the down payment as the vehicle price`;

  const userMessage = `Vehicle facts (only use what is provided — never invent anything):
${JSON.stringify(facts, null, 2)}

Pricing:
${pricingBlock}

Vehicle-specific copy strategy:
${strategyBlock}

Anti-duplicate variation for this specific vehicle (vehicleId: ${vehicle.id}):
- Hook variation style: ${hookVariation}
- Required CTA: ${ctaVariation}
  (Use this exact CTA as both the last line of the description AND the callToAction field)

Generate the listing now.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: BASE_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned an empty response");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  const parsed = ModelOutput.safeParse(parsedJson);
  if (!parsed.success) throw new Error("AI response did not match the expected shape");

  const priorityRaw = parsed.data.priority.trim().toLowerCase();
  const priority = priorityRaw.startsWith("high")
    ? "High"
    : priorityRaw.startsWith("low")
      ? "Low"
      : "Medium";

  return {
    title: sanitizeTitle(parsed.data.title),
    descriptionEn: parsed.data.descriptionEn.trim(),
    descriptionEs: parsed.data.descriptionEs.trim(),
    callToAction: parsed.data.callToAction.trim(),
    buyerProfile: parsed.data.buyerProfile.trim(),
    copyAngle: parsed.data.copyAngle.trim(),
    language: "en",
    priority,
    downPayment: approvedDownPayment,
    askingPrice: vehicle.price ?? null,
    category,
  };
}
