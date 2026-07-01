import { openai } from "@workspace/integrations-openai-ai-server";
import type { Vehicle } from "@workspace/db";
import { z } from "zod/v4";
import { suggestDownPayment, type DownPaymentSuggestion } from "./rules";

export interface GeneratedListing {
  title: string;
  descriptionEn: string;
  descriptionEs: string;
  callToAction: string;
  buyerProfile: string;
  language: string;
  priority: string;
  downPayment: number;
  askingPrice: number | null;
  category: DownPaymentSuggestion["category"];
}

const ALLOWED_EMOJI_CHARS = "🔥🚗✅💥📩💰⚡⏳";

function sanitizeTitle(raw: string): string {
  const cleaned = raw.replace(/\p{Extended_Pictographic}/gu, (ch) =>
    ALLOWED_EMOJI_CHARS.includes(ch) ? ch : ""
  );
  const collapsed = cleaned.replace(/\s+/g, " ").trim();
  return collapsed.length > 70 ? collapsed.slice(0, 70).trim() : collapsed;
}

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

const ModelOutput = z.object({
  title: z.string().min(1),
  descriptionEn: z.string().min(1),
  descriptionEs: z.string().min(1),
  callToAction: z.string().min(1),
  buyerProfile: z.string().min(1),
  priority: z.string().min(1),
});

const SYSTEM_PROMPT = `You are the top-performing Facebook Marketplace car seller in the United States.

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
- priceMode DOWN_PAYMENT: frame the ENTIRE offer around the down payment. Use "Down payment starting at $X" or "Available with $X down for qualified buyers". DO NOT mention the full vehicle price.
- priceMode FULL_PRICE: mention the full price directly.
- NEVER say "guaranteed approval", "everyone approved", "no credit check guaranteed", or imply unconditional financing.
- NEVER say a buyer is guaranteed to qualify. Use "for qualified buyers" or "financing available".

=== TITLE ===
- Maximum 70 characters (including emojis).
- Lead with ONE emoji: 🔥 or 🚗
- Mention year, make, model once.
- Include the single most compelling hook (low miles, down payment, financing, clean title, etc.)
- Use • as a separator.
- Example: 🔥 2019 Toyota Camry • Clean Title • $2,500 Down
- Example: 🚗 2021 Ford F-150 XLT • Low Miles • Financing Available

=== ENGLISH DESCRIPTION STRUCTURE ===
Maximum 12 lines total. Follow this EXACT 4-section structure:

SECTION 1 — HOOK (max 2 lines)
One or two punchy, high-energy sentences. NO specs.
Examples:
🔥 Looking for a reliable SUV with financing available?
🔥 Drive home today — financing available.

SECTION 2 — WHY BUY THIS CAR (3–5 bullets only)
Use ✅ before each bullet. Only real selling points from the vehicle facts.
Keep each bullet SHORT. Examples:
✅ Clean Title
✅ Financing Available — Low Down
✅ 45K Low Miles
✅ Backup Camera
✅ Apple CarPlay

SECTION 3 — BUYER BENEFIT (1 sentence max)
No specs. No jargon. One simple human sentence.
Example: Perfect for daily driving, commuting, or family trips.

SECTION 4 — CTA (1 emotional line, no period)
Examples:
📩 Send us a message today!
🚗 Come test drive it today.
🔥 This one won't last long — act fast.
⏳ First come, first served.

=== SPANISH DESCRIPTION ===
- Do NOT translate literally. REWRITE naturally for Hispanic buyers.
- Use authentic Hispanic sales language and tone.
- Same 4-section structure.
- Must feel native and local, not translated.
- Examples of Hispanic-style hooks:
  🔥 ¿Buscas una SUV confiable con financiamiento?
  🔥 Maneja a casa hoy mismo.
- Examples of CTA:
  📩 Escríbenos hoy mismo.
  🚗 Ven a manejarla.

=== ALLOWED EMOJIS ===
Only these: 🔥 🚗 ✅ 💥 📩 💰 ⚡ ⏳
Never spam. Use only where they improve readability.

=== JSON OUTPUT ===
Return a single JSON object with these keys:
- title: the optimized Marketplace title (max 70 chars)
- descriptionEn: the full English description (4-section structure, max 12 lines)
- descriptionEs: the full Spanish description (4-section structure, naturally rewritten)
- callToAction: the final CTA line exactly as it appears at the end of the English description
- buyerProfile: one short sentence — who is the ideal buyer for this specific vehicle
- priority: exactly "High", "Medium", or "Low" based on how fast-moving this vehicle is`;

export async function generateListing(vehicle: Vehicle): Promise<GeneratedListing> {
  const suggestion = suggestDownPayment(vehicle);
  const facts = buildVehicleFacts(vehicle);

  const FULL_PRICE_THRESHOLD = 16_000;
  const price = vehicle.price ?? 0;
  const priceMode = price < FULL_PRICE_THRESHOLD ? "FULL_PRICE" : "DOWN_PAYMENT";

  const pricingBlock =
    priceMode === "DOWN_PAYMENT"
      ? `priceMode: DOWN_PAYMENT
- Marketplace display price: $${suggestion.downPayment} down payment
- Actual vehicle price: $${price} — DO NOT mention this in the listing
- Frame everything around the down payment: "Down payment starting at $${suggestion.downPayment}" or "Available with $${suggestion.downPayment} down for qualified buyers"
- Down payment tier: ${suggestion.category} (typical range ${suggestion.rangeLabel})`
      : `priceMode: FULL_PRICE
- Full asking price: $${price}
- You may reference the full price in the copy`;

  const userMessage = `Vehicle facts (only use what is provided below — do not invent anything):
${JSON.stringify(facts, null, 2)}

Pricing:
${pricingBlock}

Generate the listing now.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI returned an empty response");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  const parsed = ModelOutput.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("AI response did not match the expected shape");
  }

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
    language: "en",
    priority,
    downPayment: suggestion.downPayment,
    askingPrice: vehicle.price ?? null,
    category: suggestion.category,
  };
}
