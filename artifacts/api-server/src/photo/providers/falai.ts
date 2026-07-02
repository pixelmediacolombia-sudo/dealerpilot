// fal.ai BRIA RMBG 2.0 — background removal provider.
// Calls the fal.ai queue REST API directly using FAL_KEY env var.
// Gracefully skips (returns null) if FAL_KEY is not set.
import type { BackgroundRemovalResult, IBackgroundRemovalProvider } from "./types";

const FAL_QUEUE_BASE = "https://queue.fal.run";
const MODEL_PATH = "fal-ai/bria/background/remove";
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 40; // ~60 seconds max

interface FalSubmitResponse {
  request_id: string;
  status?: string;
}

interface FalStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
}

interface FalResultResponse {
  image?: { url: string; content_type?: string };
}

function getApiKey(): string | null {
  return process.env["FAL_KEY"] ?? null;
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

    const headers = {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    };

    const start = Date.now();

    // 1. Submit to queue
    const submitRes = await fetch(`${FAL_QUEUE_BASE}/${MODEL_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ image_url: imageUrl }),
    });

    if (!submitRes.ok) {
      const body = await submitRes.text();
      throw new Error(`fal.ai submit failed (${submitRes.status}): ${body}`);
    }

    const submitData = (await submitRes.json()) as FalSubmitResponse;
    const requestId = submitData.request_id;
    if (!requestId) throw new Error("fal.ai submit returned no request_id");

    // 2. Poll for completion
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const statusRes = await fetch(
        `${FAL_QUEUE_BASE}/${MODEL_PATH}/requests/${requestId}/status`,
        { headers },
      );

      if (!statusRes.ok) continue;
      const statusData = (await statusRes.json()) as FalStatusResponse;

      if (statusData.status === "FAILED") {
        throw new Error(`fal.ai job ${requestId} failed`);
      }

      if (statusData.status === "COMPLETED") {
        // 3. Fetch result
        const resultRes = await fetch(
          `${FAL_QUEUE_BASE}/${MODEL_PATH}/requests/${requestId}`,
          { headers },
        );

        if (!resultRes.ok) {
          throw new Error(`fal.ai result fetch failed (${resultRes.status})`);
        }

        const resultData = (await resultRes.json()) as FalResultResponse;
        const url = resultData.image?.url;
        if (!url) throw new Error("fal.ai result contained no image URL");

        return {
          url,
          provider: this.name,
          model: this.model,
          timeMs: Date.now() - start,
        };
      }
    }

    throw new Error(`fal.ai job ${requestId} timed out after ${MAX_POLL_ATTEMPTS} polls`);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
