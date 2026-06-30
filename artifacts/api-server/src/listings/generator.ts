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

// Strip emojis / pictographs and collapse whitespace so titles obey the
// Marketplace "no emojis" rule even if the model slips one in.
function sanitizeTitle(raw: string): string {
  const noEmoji = raw.replace(/\p{Extended_Pictographic}/gu, "");
  const collapsed = noEmoji.replace(/\s+/g, " ").trim();
  return collapsed.length > 100 ? collapsed.slice(0, 100).trim() : collapsed;
}

// Only the fields that actually exist on the vehicle are sent to the model.
// Nothing is invented; absent fields are simply omitted from the prompt so the
// model cannot "fill in" specs it was never given.
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

const SYSTEM_PROMPT = `You are an expert automotive marketing copywriter for a US car dealership that sells on Facebook Marketplace and offers in-house financing ("buy here, pay here").

ABSOLUTE RULES:
- Use ONLY the vehicle facts provided in the user message. NEVER invent or assume specs, features, packages, trims, mileage, history, or options that are not given. If a detail is missing, simply do not mention it.
- The Marketplace title must be at most 100 characters, contain NO emojis, read naturally, be high click-through, and be SEO friendly (include year, make, and model when available).
- Write TWO full descriptions: one in natural English and one in natural Latin-American Spanish. They should convey the same information; the Spanish one is a localization, not a literal word-for-word translation.
- Descriptions should highlight the provided facts, the financing/down-payment offer, and a clear next step. No emojis in the title; descriptions may use light, professional formatting but no excessive emojis.
- The call to action should reference the financing / low down payment offer.
- buyerProfile: one or two sentences describing the most likely buyer for this specific vehicle.
- priority: exactly one of "High", "Medium", or "Low" based on how desirable/fast-moving this vehicle likely is.

PRICING COPY RULES (strictly enforced):
- If priceMode is DOWN_PAYMENT: frame the entire offer around the down payment. Use phrasing like "Down payment starting at $X" or "Available with $X down for qualified buyers". DO NOT use the full vehicle price as the Marketplace price in the copy.
- If priceMode is FULL_PRICE: the listing copy may mention the full price directly.
- NEVER use the phrases "guaranteed approval", "everyone approved", "no credit check guaranteed", or any variant implying unconditional financing.
- NEVER say a buyer is guaranteed to qualify. Use "for qualified buyers" or "financing available" instead.

Respond with a single JSON object and nothing else, with keys: title, descriptionEn, descriptionEs, callToAction, buyerProfile, priority.`;

/**
 * Generate listing copy with the LLM, grounded strictly in XML-sourced vehicle
 * facts. Down payment and asking price come from the deterministic rule engine
 * / source data, never from the model.
 */
export async function generateListing(vehicle: Vehicle): Promise<GeneratedListing> {
  const suggestion = suggestDownPayment(vehicle);
  const facts = buildVehicleFacts(vehicle);

  const FULL_PRICE_THRESHOLD = 16_000;
  const price = vehicle.price ?? 0;
  const priceMode = price < FULL_PRICE_THRESHOLD ? "FULL_PRICE" : "DOWN_PAYMENT";

  const userMessage = `Vehicle facts (the ONLY information you may use):
${JSON.stringify(facts, null, 2)}

Pricing mode: ${priceMode}
${priceMode === "DOWN_PAYMENT"
  ? `- Marketplace display price: $${suggestion.downPayment} down payment
- Actual vehicle price: $${price} (DO NOT use this as the Marketplace price)
- Frame the listing around the down payment offer: "Down payment starting at $${suggestion.downPayment}" or "Available with $${suggestion.downPayment} down for qualified buyers"
- Down payment category: ${suggestion.category} (typical range ${suggestion.rangeLabel})`
  : `- Full asking price: $${price}
- Listing copy may reference the full price directly`}

Generate the JSON listing now.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
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
  const priority =
    priorityRaw.startsWith("high")
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
