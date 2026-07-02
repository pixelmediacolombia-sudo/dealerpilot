// fal.ai providers — BRIA RMBG 2.0 (background removal) + BRIA Product Shot (AI studio placement).
//
// BRIA RMBG uses the DIRECT endpoint (fal.run) — returns in ~750ms, no polling.
// BRIA Product Shot uses the QUEUE endpoint (queue.fal.run) — takes 20–60s/image, requires polling.
//
// KEY: never pass large base64 data URLs as ref_image_url or image_url to queued endpoints.
//   The fal.ai queue silently stalls on payloads > ~2 MB.
//   Solution: upload local files to fal.ai storage once (module-level cache), then pass CDN URLs.
import type { BackgroundRemovalResult, IBackgroundRemovalProvider } from "./types";

const FAL_DIRECT_BASE   = "https://fal.run";
const FAL_QUEUE_BASE    = "https://queue.fal.run";
const FAL_STORAGE_BASE  = "https://rest.alpha.fal.ai";
const RMBG_PATH         = "fal-ai/bria/background/remove";
const PRODUCT_SHOT_PATH = "fal-ai/bria/product-shot";

interface FalDirectResponse {
  image?: { url: string; content_type?: string };
}
interface FalQueueSubmitResponse { request_id: string }
interface FalQueueStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  error?: string;
}
interface FalProductShotResult {
  images?: Array<{ url: string; content_type?: string }>;
}
interface FalStorageUploadResult {
  access_url?: string;
  url?: string;
}

function getApiKey(): string | null {
  return process.env["FAL_KEY"] ?? null;
}

/**
 * Download any URL to a Buffer.
 * Rewrites /api/* paths to localhost so the server can fetch its own assets.
 */
async function downloadBuffer(imageUrl: string): Promise<Buffer> {
  let fetchUrl = imageUrl;
  if (imageUrl.startsWith("/api/")) {
    fetchUrl = `http://localhost:${process.env["PORT"] ?? 8080}${imageUrl}`;
  }
  const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${fetchUrl}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Convert any URL to a base64 data URL.
 * Used ONLY for BRIA RMBG (direct endpoint, small images, no queue).
 */
async function toDataUrl(imageUrl: string): Promise<string> {
  let fetchUrl = imageUrl;
  if (imageUrl.startsWith("/api/")) {
    fetchUrl = `http://localhost:${process.env["PORT"] ?? 8080}${imageUrl}`;
  }
  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`Failed to download image (${res.status}): ${fetchUrl}`);
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const buf = await res.arrayBuffer();
  return `data:${contentType};base64,${Buffer.from(buf).toString("base64")}`;
}

// ── Public URL resolution ─────────────────────────────────────────────────────
// fal.ai queued endpoints need publicly-reachable URLs.  Strategy, in order:
//   1. Already an https:// URL → pass as-is.
//   2. A local /api/* path    → build a public URL via REPLIT_DEV_DOMAIN (free,
//                               works in both dev and Replit deployments).
//   3. Fallback               → upload to fal.ai storage via the two-step
//                               initiate-then-PUT flow (cached per process).

const falStorageCache = new Map<string, string>();

interface FalStorageInitiateResult { upload_url: string; file_url: string }

/**
 * Resolve a local /api/* path or an https:// URL to a URL that fal.ai's
 * queue workers can reach.  Results are cached in-process.
 */
async function toPublicFalUrl(imageUrl: string, apiKey: string): Promise<string> {
  // Already public
  if (imageUrl.startsWith("https://") || imageUrl.startsWith("http://")) return imageUrl;

  // In-process cache for local paths
  if (falStorageCache.has(imageUrl)) return falStorageCache.get(imageUrl)!;

  // ── Primary: Replit dev-domain proxy (zero-cost, no API call) ──────────────
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain && imageUrl.startsWith("/")) {
    const publicUrl = `https://${devDomain}${imageUrl}`;
    falStorageCache.set(imageUrl, publicUrl);
    return publicUrl;
  }

  // ── Fallback: fal.ai storage (two-step initiate + PUT) ────────────────────
  // 1. Initiate: get a signed GCS upload URL + the final CDN file_url.
  const buf      = await downloadBuffer(imageUrl);
  const filename = imageUrl.split("/").pop() ?? "file.png";
  const mimeType = filename.endsWith(".png") ? "image/png" : "image/jpeg";

  const initRes = await fetch(`${FAL_STORAGE_BASE}/storage/upload/initiate`, {
    method: "POST",
    headers: {
      Authorization:   `Key ${apiKey}`,
      "Content-Type":  mimeType,
      "X-Fal-File-Name": filename,
    },
  });
  if (!initRes.ok) {
    const body = await initRes.text();
    throw new Error(`fal.ai storage initiate failed (${initRes.status}): ${body}`);
  }
  const { upload_url, file_url } = (await initRes.json()) as FalStorageInitiateResult;

  // 2. Upload: PUT raw bytes to the signed GCS URL.
  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: new Uint8Array(buf),
  });
  if (!putRes.ok) throw new Error(`fal.ai storage PUT failed (${putRes.status})`);

  falStorageCache.set(imageUrl, file_url);
  return file_url;
}

// ── Queue helpers ─────────────────────────────────────────────────────────────

interface FalQueueSubmitResponse {
  request_id: string;
  /** Canonical URL to poll for status. May differ from the model path used to submit. */
  status_url:   string;
  /** URL to fetch the final result once status === COMPLETED. */
  response_url: string;
}

/**
 * Submit a job to the fal.ai queue and return the canonical polling URLs.
 * IMPORTANT: fal.ai status/result URLs do NOT always match the model path.
 * e.g. fal-ai/bria/product-shot submits via that path but returns
 * status_url = .../fal-ai/bria/requests/{id}/status (note: no /product-shot).
 * Always use the status_url/response_url from the submit response.
 */
async function submitFalQueue(
  modelPath: string,
  input: Record<string, unknown>,
  apiKey: string,
): Promise<{ requestId: string; statusUrl: string; responseUrl: string }> {
  const res = await fetch(`${FAL_QUEUE_BASE}/${modelPath}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fal.ai queue submit failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as FalQueueSubmitResponse;
  if (!data.request_id) throw new Error("fal.ai queue response missing request_id");
  return {
    requestId:   data.request_id,
    statusUrl:   data.status_url,
    responseUrl: data.response_url,
  };
}

/**
 * Poll the fal.ai queue using canonical URLs from the submit response.
 * Uses statusUrl/responseUrl directly — never reconstructs URLs from modelPath.
 */
async function pollFalQueue(
  statusUrl: string,
  responseUrl: string,
  apiKey: string,
  timeoutMs = 120_000,
): Promise<unknown> {
  const deadline      = Date.now() + timeoutMs;
  const POLL_INTERVAL = 3_000;

  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL));

    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
      signal:  AbortSignal.timeout(10_000),
    });
    if (!statusRes.ok) continue;

    const body = await statusRes.text();
    if (!body || body.trim() === "") continue; // guard against empty responses

    let status: FalQueueStatusResponse;
    try { status = JSON.parse(body) as FalQueueStatusResponse; }
    catch { continue; } // malformed — keep polling

    if (status.status === "COMPLETED") {
      const resultRes = await fetch(responseUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        signal:  AbortSignal.timeout(15_000),
      });
      if (!resultRes.ok) throw new Error(`fal.ai result fetch failed (${resultRes.status})`);
      return await resultRes.json();
    }

    if (status.status === "FAILED") {
      throw new Error(`fal.ai queue job FAILED: ${status.error ?? "unknown error"}`);
    }
    // IN_QUEUE or IN_PROGRESS — keep polling
  }
  throw new Error(`fal.ai queue job timed out after ${Math.round(timeoutMs / 1000)}s`);
}

// ── BRIA RMBG 2.0 — background removal (direct endpoint) ─────────────────────

export class FalAiBackgroundRemoval implements IBackgroundRemovalProvider {
  readonly name = "falai";
  readonly model = "bria-rmbg-2.0";

  static isConfigured(): boolean { return !!getApiKey(); }

  async removeBackground(imageUrl: string): Promise<BackgroundRemovalResult> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("FAL_KEY not set — background removal requires a fal.ai API key.");

    const start = Date.now();
    const dataUrl = await toDataUrl(imageUrl);

    const res = await fetch(`${FAL_DIRECT_BASE}/${RMBG_PATH}`, {
      method: "POST",
      headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: dataUrl }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`fal.ai inference failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as FalDirectResponse;
    const url = data.image?.url;
    if (!url) throw new Error("fal.ai RMBG response contained no image URL");

    return { url, provider: this.name, model: this.model, timeMs: Date.now() - start };
  }
}

// ── BRIA Product Shot — AI studio placement (queued endpoint) ─────────────────

export interface ProductShotResult {
  imageUrl: string;
  provider: string;
  model: string;
  timeMs: number;
}

/**
 * Place a background-removed vehicle image into a studio scene.
 *
 * IMPORTANT: both vehicleImageUrl and backgroundImageUrl are uploaded to fal.ai
 * storage (or passed directly if already a public CDN URL) so the queue worker
 * can access them.  Never pass base64 data URLs to queued endpoints.
 *
 * @param vehicleImageUrl   fal.ai CDN URL from BRIA RMBG — already publicly accessible.
 * @param backgroundImageUrl Local /api/static path or HTTPS URL for the studio background.
 *                           Uploaded to fal.ai storage on first call, then cached.
 * @param sceneDescription  Natural-language description of the desired scene.
 * @param outputSize        [width, height] — should match studio background dimensions.
 */
export async function briaProductShot(
  vehicleImageUrl: string,
  backgroundImageUrl: string,
  sceneDescription: string,
  outputSize: [number, number],
): Promise<ProductShotResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("FAL_KEY not set — cannot call BRIA Product Shot");

  const start = Date.now();

  // Resolve both URLs to publicly-accessible HTTPS URLs.
  // The background is a local /api/* path → served via REPLIT_DEV_DOMAIN (free).
  // The vehicle URL is already an https:// URL from BRIA RMBG → passes through.
  const [vehiclePublicUrl, refCdnUrl] = await Promise.all([
    toPublicFalUrl(vehicleImageUrl, apiKey),
    toPublicFalUrl(backgroundImageUrl, apiKey),
  ]);

  const input: Record<string, unknown> = {
    image_url:          vehiclePublicUrl, // public HTTPS URL
    ref_image_url:      refCdnUrl,        // public HTTPS URL (Replit dev domain or fal.ai storage)
    scene_description:  sceneDescription,
    placement_type:     "automatic",
    shot_size:          outputSize,
    num_results:        1,
    optimize_description: false,
    fast:               false,
  };

  const { requestId, statusUrl, responseUrl } = await submitFalQueue(PRODUCT_SHOT_PATH, input, apiKey);

  const result = (await pollFalQueue(
    statusUrl,
    responseUrl,
    apiKey,
    120_000,          // 2-minute timeout per image
  )) as FalProductShotResult;

  const imageUrl = result.images?.[0]?.url;
  if (!imageUrl) throw new Error("BRIA product-shot returned no image URL");

  return { imageUrl, provider: "falai", model: "bria-product-shot", timeMs: Date.now() - start };
}
