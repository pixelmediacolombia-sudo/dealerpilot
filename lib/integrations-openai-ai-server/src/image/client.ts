import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });
  const base64 = response.data?.[0]?.b64_json ?? "";
  return Buffer.from(base64, "base64");
}

export interface EditImagesOptions {
  model?: string;
  quality?: "low" | "medium" | "high" | "auto";
  size?: "auto" | "1024x1024" | "1536x1024" | "1024x1536";
  outputFormat?: "png" | "jpeg" | "webp";
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string,
  options: EditImagesOptions = {},
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      })
    )
  );

  const rawQuality = options.quality ?? process.env["PHOTO_RESTORATION_OPENAI_QUALITY"] ?? "medium";
  const quality = rawQuality === "high" || rawQuality === "low" || rawQuality === "auto" ? rawQuality : "medium";

  const response = await openai.images.edit({
    model: options.model ?? process.env["PHOTO_RESTORATION_OPENAI_MODEL"] ?? "gpt-image-2",
    image: images.length === 1 ? images[0]! : images,
    prompt,
    quality,
    size: options.size ?? "auto",
    n: 1,
    output_format: options.outputFormat ?? "jpeg",
  } as any);

  const imageBase64 = response.data?.[0]?.b64_json ?? "";
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}
