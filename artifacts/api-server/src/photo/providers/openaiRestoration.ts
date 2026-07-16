import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { ImageRestorationInput, ImageRestorationResult, IImageRestorationProvider } from "./types";

const MODEL = process.env["PHOTO_RESTORATION_OPENAI_MODEL"] ?? "gpt-image-2";

function getTmpDir(): string {
  const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos/tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function randomSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class OpenAiImageRestorationProvider implements IImageRestorationProvider {
  readonly name = "openai";
  readonly model = MODEL;

  static isConfigured(): boolean {
    const provider = (process.env["PHOTO_RESTORATION_PROVIDER"] ?? "openai").toLowerCase();
    const disabled = process.env["PHOTO_RESTORATION_ALLOW_GENERATIVE"] === "false";
    return (
      provider === "openai" &&
      !disabled &&
      !!process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] &&
      !!process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]
    );
  }

  async restore(input: ImageRestorationInput): Promise<ImageRestorationResult> {
    const start = Date.now();
    const tmpDir = getTmpDir();
    const inputPath = path.join(tmpDir, `restore-input-${randomSuffix()}.png`);

    try {
      await sharp(input.imageBuffer)
        .rotate()
        .png({ compressionLevel: 9 })
        .toFile(inputPath);

      const { editImages } = await import("@workspace/integrations-openai-ai-server/image");
      const prompt = [
        input.prompt,
        "",
        `Negative prompt: ${input.negativePrompt}`,
        `Prompt version: ${input.promptVersion}`,
      ].join("\n");
      const buffer = await editImages([inputPath], prompt);

      return {
        buffer,
        provider: this.name,
        model: this.model,
        timeMs: Date.now() - start,
      };
    } finally {
      fs.rmSync(inputPath, { force: true });
    }
  }
}
