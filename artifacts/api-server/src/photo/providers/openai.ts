// OpenAI GPT-5-mini vision — photo classification provider.
// Uses the existing Replit-managed OpenAI integration (no extra API key needed).
import { openai } from "@workspace/integrations-openai-ai-server";
import type { ClassificationResult, IClassificationProvider } from "./types";
import { PHOTO_CLASSIFICATIONS, EXTERIOR_CLASSIFICATIONS } from "./types";

const MODEL = "gpt-5-mini";
const SYSTEM_PROMPT = `You are an automotive photo classifier for a car dealership inventory system.
Given a vehicle photo, classify it into exactly ONE of these categories:
${PHOTO_CLASSIFICATIONS.join(", ")}

Rules:
- "Exterior Front": Front-facing, slight or no angle. Hood, grille, headlights dominant.
- "Exterior Front 45": Front taken at ~45-degree angle. Shows front + driver or passenger side.
- "Exterior Side": Pure side profile — driver or passenger side.
- "Exterior Rear 45": Rear taken at ~45-degree angle.
- "Exterior Rear": Directly behind the car. Trunk, taillights, rear bumper dominant.
- "Wheels": Close-up of wheel(s) or tire(s).
- "Engine": Under-hood shot showing the engine bay.
- "Interior Front": View of the entire front interior — seats, console, steering wheel visible.
- "Interior Dashboard": Close-up of dashboard, gauges, or infotainment.
- "Interior Rear Seats": Rear passenger seat area.
- "Trunk": Cargo area / trunk interior.
- "Miscellaneous": Anything that doesn't fit the above (VIN sticker, badge, window sticker, etc).

Respond ONLY with a JSON object: {"label": "<category>", "confidence": <0.0-1.0>}
No extra text, no markdown, no explanation.`;

export class OpenAiClassifier implements IClassificationProvider {
  readonly name = "openai";
  readonly model = MODEL;

  async classify(imageUrl: string): Promise<ClassificationResult> {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 64,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageUrl, detail: "low" },
            },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "";
    let label = "Miscellaneous";
    let confidence = 0.5;

    try {
      const parsed = JSON.parse(raw) as { label?: string; confidence?: number };
      const candidate = parsed.label ?? "";
      if ((PHOTO_CLASSIFICATIONS as readonly string[]).includes(candidate)) {
        label = candidate;
      }
      if (typeof parsed.confidence === "number") {
        confidence = Math.max(0, Math.min(1, parsed.confidence));
      }
    } catch {
      // non-JSON response → default to Miscellaneous
    }

    return {
      label,
      confidence,
      isExterior: EXTERIOR_CLASSIFICATIONS.has(label),
      provider: this.name,
      model: this.model,
    };
  }
}
