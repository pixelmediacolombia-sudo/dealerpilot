// fal.ai BRIA RMBG 2.0 — background removal provider.
// Uses the DIRECT (non-queue) fal.run endpoint which returns in ~750ms.
// Images are downloaded locally and submitted as base64 data URLs because
// the dealer CDN (cdnimages.dealersgpt.com) is not reachable from fal.ai's
// inference servers; using a raw CDN URL causes every job to time out.
import type { BackgroundRemovalResult, IBackgroundRemovalProvider } from "./types";

const FAL_DIRECT_BASE = "https://fal.run";
const MODEL_PATH = "fal-ai/bria/background/remove";

interface FalDirectResponse {
  image?: { url: string; content_type?: string };
}

function getApiKey(): string | null {
  return process.env["FAL_KEY"] ?? null;
}

/**
 * Download image from any URL and return as a base64 data URL.
 * Required because fal.ai inference servers cannot reach protected dealer CDNs.
 */
async function toDataUrl(imageUrl: string): Promise<string> {
  let fetchUrl = imageUrl;
  if (imageUrl.startsWith("/api/")) {
    fetchUrl = `http://localhost:${process.env["PORT"] ?? 8080}${imageUrl}`;
  }

  const res = await fetch(fetchUrl);
  if (!res.ok) {
    throw new Error(`Failed to download image (${res.status}): ${fetchUrl}`);
  }

  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const buf = await res.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  return `data:${contentType};base64,${b64}`;
}

export class FalAiBackgroundRemoval implements IBackgroundRemovalProvider {
  readonly name = "falai";
  readonly model = "bria-rmbg-2.0";

  static isConfigured(): boolean {
    return !!getApiKey();
  }

  async removeBackground(imageUrl: string): Promise<BackgroundRemovalResult> {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error(
        "FAL_KEY environment variable is not set. Background removal requires a fal.ai API key.",
      );
    }

    const start = Date.now();

    // Convert to base64 data URL so fal.ai can access the image regardless
    // of CDN hotlink protection or regional restrictions.
    const dataUrl = await toDataUrl(imageUrl);

    // Use the direct (non-queue) endpoint — returns the result in ~750ms.
    // No polling required.
    const res = await fetch(`${FAL_DIRECT_BASE}/${MODEL_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image_url: dataUrl }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`fal.ai inference failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as FalDirectResponse;
    const url = data.image?.url;
    if (!url) throw new Error("fal.ai response contained no image URL");

    return {
      url,
      provider: this.name,
      model: this.model,
      timeMs: Date.now() - start,
    };
  }
}
