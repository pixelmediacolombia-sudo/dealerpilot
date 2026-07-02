// OpenAI GPT-5-mini vision — photo classification provider.
// Uses the existing Replit-managed OpenAI integration (no extra API key needed).
import { openai } from "@workspace/integrations-openai-ai-server";
import type { ClassificationResult, IClassificationProvider } from "./types";
import { PHOTO_CLASSIFICATIONS, EXTERIOR_CLASSIFICATIONS } from "./types";

const MODEL = "gpt-5-mini";
const SYSTEM_PROMPT = `You are an expert automotive photo classifier for a luxury car dealership AI system.
Given a vehicle photo, classify it into exactly ONE of these categories:
${PHOTO_CLASSIFICATIONS.join(", ")}

Classification rules — read carefully:

PRIMARY EXTERIOR (vehicle against open background, entire exterior visible):
- "Exterior Front": Straight-on front view. Hood, grille, headlights, front bumper dominate. Minimal side visible.
- "Exterior Front 45": Front at ~45°. Front + one full side panel visible. Popular 3/4 angle.
- "Exterior Side": Pure side profile — full driver or passenger side. Both axles visible.
- "Exterior Rear 45": Rear at ~45°. Taillights + one full side panel visible.
- "Exterior Rear": Straight-on rear. Trunk/liftgate, taillights, rear bumper dominate. Minimal side visible.

SECONDARY EXTERIOR (close-up or partial exterior detail):
- "Exterior Wheel": Close-up of wheel(s), rim(s), or tire(s). Wheel fills most of frame.
- "Exterior Engine": Under-hood/engine bay. Engine components fill most of frame.
- "Exterior Bed": Truck bed interior. Bed floor/walls dominate.
- "Exterior Tailgate": Tailgate detail or tailgate-down angle.

INTERIOR (inside the cabin):
- "Interior Dashboard": Instrument cluster, gauges, speedometer, dashboard panel. CRITICAL: Any view showing backup camera feed, navigation map, or infotainment screen through a camera or window is NOT this — see Technical.
- "Interior Driver Seat": Driver seat, seatback, bolster. Seat fills frame.
- "Interior Passenger Seat": Front passenger seat. Seat fills frame.
- "Interior Rear Seat": Rear passenger area, back seats.
- "Interior Door Panel": Door card, window controls, door handle interior.
- "Interior Steering Wheel": Steering wheel close-up with controls.
- "Interior Center Console": Center armrest, gear selector, cupholders.
- "Interior Infotainment": Touchscreen / head unit close-up showing the display. Screen dominates.
- "Interior Roof": Headliner, overhead console, moonroof interior glass.
- "Interior Sunroof": Open panoramic sunroof from inside, sky visible.

TECHNICAL (instrument / documentation detail):
- "Technical Backup Camera": Backup/reverse camera VIEW — what the camera sees (lines on pavement, objects behind car). NEVER classify this as an interior or exterior shot.
- "Technical Gauge Cluster": Speedometer, tachometer, fuel gauge cluster viewed from driver position.
- "Technical Navigation Screen": Navigation map screen close-up.
- "Technical Key": Vehicle key fob, physical key, or key card.
- "Technical VIN Sticker": VIN number label/sticker.
- "Technical Odometer": Odometer reading on instrument cluster.
- "Technical Window Sticker": Monroney label / window price sticker.

DEALER:
- "Dealer Document": Title, registration, paperwork documents.
- "Dealer Warranty": Warranty card or documentation.
- "Dealer Inspection": Inspection report or checklist.

- "Miscellaneous": Anything that does not clearly fit the above categories.

CRITICAL RULES:
1. A photo showing what the backup camera sees (pavement, yellow lines, a parking space) MUST be "Technical Backup Camera" — never interior.
2. A full exterior vehicle shot (even if imperfect) MUST be a Primary Exterior category.
3. When in doubt between two close categories, pick the one where the main subject fills more of the frame.
4. Respond ONLY with a JSON object: {"label": "<category>", "confidence": <0.0-1.0>}
5. No extra text, no markdown, no explanation.`;

export class OpenAiClassifier implements IClassificationProvider {
  readonly name = "openai";
  readonly model = MODEL;

  async classify(imageUrl: string): Promise<ClassificationResult> {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 1024,
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

    const raw = response.choices[0]?.message?.content || "";
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
