// OpenAI GPT-5-mini vision — photo classification provider.
// Uses the configured OpenAI integration.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { ClassificationResult, IClassificationProvider } from "./types";
import { PHOTO_CLASSIFICATIONS, EXTERIOR_CLASSIFICATIONS } from "./types";

const MODEL = "gpt-5-mini";
const SYSTEM_PROMPT = `You are an expert automotive photo classifier for a luxury car dealership AI system.
Given a vehicle photo, classify it into exactly ONE of these categories:
${PHOTO_CLASSIFICATIONS.join(", ")}

Classification rules — read carefully:

PRIMARY EXTERIOR (full vehicle body visible against open background — studio background will be applied):
- "Exterior Front": Straight-on front view. Hood, grille, headlights, front bumper dominate. Minimal side visible.
- "Exterior Front 45": Front at ~45°. Front + one full side panel visible. Popular 3/4 angle.
- "Exterior Side": Pure side profile — full driver or passenger side. Both axles visible.
- "Exterior Rear 45": Rear at ~45°. Taillights + one full side panel visible.
- "Exterior Rear": Straight-on rear. Trunk/liftgate, taillights, rear bumper dominate. Minimal side visible.
IMPORTANT: Primary Exterior requires the ENTIRE vehicle body to be visible. If the shot is a close-up of one part only, use Secondary Exterior instead.

SECONDARY EXTERIOR (close-up or partial exterior detail — enhancement only, no background replacement):
- "Exterior Wheel": Close-up of wheel(s), rim(s), or tire(s). Wheel fills most of frame.
- "Exterior Engine": Under-hood/engine bay. Engine components fill most of frame.
- "Exterior Bed": Truck bed interior. Bed floor/walls dominate.
- "Exterior Tailgate": Tailgate detail or tailgate-down angle.
- "Exterior Headlights": Close-up of headlight assembly, DRL strip, or front lighting unit. Headlight fills most of frame.
- "Exterior Taillights": Close-up of taillight assembly, brake light cluster, or rear lighting unit. Taillight fills most of frame.
- "Exterior Badge": Close-up of brand emblem, model name badge, trim badge, or logo on the vehicle exterior.
- "Exterior Detail": Any other close-up exterior detail — door handle, mirror, grille mesh, body panel, chrome trim, exhaust tip, etc.

INTERIOR (inside the cabin — never apply studio background):
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

TECHNICAL (instrument / documentation detail — never apply studio background):
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
1. A photo showing what the backup camera sees (pavement, yellow lines, a parking space) MUST be "Technical Backup Camera" — never interior or exterior.
2. A navigation map, GPS screen, or infotainment display is "Technical Navigation Screen" or "Interior Infotainment" — NEVER exterior.
3. A dashboard, steering wheel, or seat is always INTERIOR — never exterior, even if the door is open.
4. A full exterior vehicle shot (entire body visible) MUST be a Primary Exterior category.
5. A close-up of only one exterior part (headlight, wheel, badge) MUST be a Secondary Exterior category.
6. When in doubt between two close categories, pick the one where the main subject fills more of the frame.
7. Respond ONLY with a JSON object: {"label": "<category>", "confidence": <0.0-1.0>}
8. No extra text, no markdown, no explanation.`;

async function readImageBuffer(urlOrPath: string): Promise<Buffer> {
  if (urlOrPath.startsWith("/api/static/ai-photos/")) {
    const filename = urlOrPath.replace("/api/static/ai-photos/", "");
    return fs.readFileSync(path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos", filename));
  }

  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    const response = await fetch(urlOrPath, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Image fetch failed ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  return fs.readFileSync(urlOrPath);
}

async function toOpenAiDataUrl(urlOrPath: string): Promise<string> {
  const source = await readImageBuffer(urlOrPath);
  const normalized = await sharp(source)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${normalized.toString("base64")}`;
}

export class OpenAiClassifier implements IClassificationProvider {
  readonly name = "openai";
  readonly model = MODEL;

  async classify(imageUrl: string): Promise<ClassificationResult> {
    const imageDataUrl = await toOpenAiDataUrl(imageUrl);
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageDataUrl, detail: "low" },
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
