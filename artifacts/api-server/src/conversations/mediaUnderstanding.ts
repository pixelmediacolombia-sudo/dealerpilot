import sharp from "sharp";
import { ensureCompatibleFormat, speechToText } from "@workspace/integrations-openai-ai-server/audio";
import { openai } from "@workspace/integrations-openai-ai-server";

export type ConversationImage = {
  src?: string;
  dataUrl?: string;
  alt?: string;
  mimeType?: string;
};

export type ConversationAudio = {
  src?: string;
  dataUrl?: string;
  mimeType?: string;
};

export type ConversationMediaUnderstanding = {
  context: string;
  transcript: string | null;
  imageDescription: string | null;
};

const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function dataUrlBuffer(value: string): { buffer: Buffer; mimeType: string } | null {
  const match = value.match(/^data:([^;,]+)?;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  return { buffer, mimeType: match[1] || "application/octet-stream" };
}

async function fetchBuffer(source: string, maxBytes: number): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const data = dataUrlBuffer(source);
  if (data) return data.buffer.length <= maxBytes ? data : null;
  if (!/^https?:\/\//i.test(source)) return null;
  const response = await fetch(source, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) return null;
  const mimeType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length <= maxBytes ? { buffer, mimeType } : null;
}

async function imageDataUrl(image: ConversationImage): Promise<string | null> {
  const source = String(image.dataUrl || image.src || "").trim();
  if (!source) return null;
  const fetched = await fetchBuffer(source, MAX_IMAGE_BYTES);
  if (!fetched) return /^https?:\/\//i.test(source) ? source : null;
  const normalized = await sharp(fetched.buffer)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${normalized.toString("base64")}`;
}

async function transcribeAudio(audio: ConversationAudio): Promise<string | null> {
  const source = String(audio.dataUrl || audio.src || "").trim();
  if (!source) return null;
  const fetched = await fetchBuffer(source, MAX_AUDIO_BYTES);
  if (!fetched) return null;
  const compatible = await ensureCompatibleFormat(fetched.buffer);
  return (await speechToText(compatible.buffer, compatible.format)).trim() || null;
}

async function describeImages(images: ConversationImage[], language: string): Promise<string | null> {
  const imageUrls = (await Promise.all(images.slice(-4).map((image) => imageDataUrl(image)))).filter(Boolean) as string[];
  if (!imageUrls.length) return null;
  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 500,
    messages: [
      {
        role: "system",
        content: "You are the visual assistant for an automotive dealership Messenger agent. Describe only visible, useful facts from buyer-attached photos. Do not invent make, model, price, damage, financing, or vehicle condition. Keep it concise and factual.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Describe these buyer-attached photos in ${language === "es" ? "Spanish" : "English"}. If a photo is not useful or unclear, say so briefly.` },
          ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "low" as const } })),
        ],
      },
    ],
  });
  return response.choices[0]?.message?.content?.trim() || null;
}

export async function understandConversationMedia(params: {
  images?: ConversationImage[];
  audios?: ConversationAudio[];
  language?: string;
}): Promise<ConversationMediaUnderstanding> {
  const images = Array.isArray(params.images) ? params.images : [];
  const audios = Array.isArray(params.audios) ? params.audios : [];
  if (!images.length && !audios.length) {
    return { context: "", transcript: null, imageDescription: null };
  }

  const [audioResult, imageResult] = await Promise.allSettled([
    audios.length ? transcribeAudio(audios[audios.length - 1]) : Promise.resolve(null),
    images.length ? describeImages(images, params.language || "en") : Promise.resolve(null),
  ]);
  const transcript = audioResult.status === "fulfilled" ? audioResult.value : null;
  const imageDescription = imageResult.status === "fulfilled" ? imageResult.value : null;
  const context = [
    transcript ? `[Buyer voice-message transcription: ${transcript}]` : audios.length ? "[Buyer sent a voice message, but it could not be transcribed]" : "",
    imageDescription ? `[Buyer photo understanding: ${imageDescription}]` : images.length ? "[Buyer attached a photo; visual details were not readable]" : "",
  ].filter(Boolean).join("\n");
  return { context, transcript, imageDescription };
}
