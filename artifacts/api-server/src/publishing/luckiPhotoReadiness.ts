const PHOTO_PROBE_TIMEOUT_MS = 4_000;
const PHOTO_PROBE_SUCCESS_CACHE_MS = 10 * 60_000;
const PHOTO_PROBE_FAILURE_CACHE_MS = 2 * 60_000;
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;

type PhotoFetcher = (input: string, init?: RequestInit) => Promise<Response>;

type ProbeCacheEntry = {
  ok: boolean;
  reason: string | null;
  expiresAt: number;
};

export type LuckiPhotoReadiness = {
  ready: boolean;
  totalPhotos: number;
  downloadablePhotos: number;
  failedUrls: string[];
  reason: string | null;
};

const photoProbeCache = new Map<string, ProbeCacheEntry>();

function uniquePhotoUrls(images: Array<{ url: string }>): string[] {
  return [...new Set(images.map((image) => image.url.trim()).filter(Boolean))];
}

async function probePhotoUrl(
  url: string,
  fetcher: PhotoFetcher,
  timeoutMs: number,
): Promise<ProbeCacheEntry> {
  const cached = photoProbeCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached;

  if (!/^https?:\/\//i.test(url)) {
    const result = { ok: false, reason: "photo URL is not absolute HTTP(S)", expiresAt: Date.now() + PHOTO_PROBE_FAILURE_CACHE_MS };
    photoProbeCache.set(url, result);
    return result;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      const result = {
        ok: false,
        reason: `photo returned HTTP ${response.status}`,
        expiresAt: Date.now() + PHOTO_PROBE_FAILURE_CACHE_MS,
      };
      photoProbeCache.set(url, result);
      return result;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.startsWith("image/")) {
      const result = {
        ok: false,
        reason: `photo returned invalid content type ${contentType}`,
        expiresAt: Date.now() + PHOTO_PROBE_FAILURE_CACHE_MS,
      };
      photoProbeCache.set(url, result);
      return result;
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) {
      const result = { ok: false, reason: "photo response was empty", expiresAt: Date.now() + PHOTO_PROBE_FAILURE_CACHE_MS };
      photoProbeCache.set(url, result);
      return result;
    }
    if (bytes.byteLength > MAX_PHOTO_BYTES) {
      const result = {
        ok: false,
        reason: `photo exceeds ${MAX_PHOTO_BYTES / (1024 * 1024)} MB download limit`,
        expiresAt: Date.now() + PHOTO_PROBE_FAILURE_CACHE_MS,
      };
      photoProbeCache.set(url, result);
      return result;
    }

    const result = { ok: true, reason: null, expiresAt: Date.now() + PHOTO_PROBE_SUCCESS_CACHE_MS };
    photoProbeCache.set(url, result);
    return result;
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError"
      ? `photo download timed out after ${timeoutMs}ms`
      : `photo download failed: ${error instanceof Error ? error.message : String(error)}`;
    const result = { ok: false, reason, expiresAt: Date.now() + PHOTO_PROBE_FAILURE_CACHE_MS };
    photoProbeCache.set(url, result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const run = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await worker(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return results;
}

/**
 * Lucki-only preflight for the exact failure observed in Marketplace:
 * inventory can contain ten rows while one or more source URLs cannot be
 * downloaded by the publisher. This deliberately does not run for Alpha.
 */
export async function checkLuckiPhotoSetDownloadable(
  images: Array<{ url: string }>,
  options: {
    fetcher?: PhotoFetcher;
    timeoutMs?: number;
    concurrency?: number;
  } = {},
): Promise<LuckiPhotoReadiness> {
  const totalPhotos = images.length;
  const urls = uniquePhotoUrls(images);
  if (totalPhotos < 10) {
    return {
      ready: false,
      totalPhotos,
      downloadablePhotos: 0,
      failedUrls: urls,
      reason: `Lucki requires all source photos and at least 10 photos; only ${totalPhotos} photo(s) are present`,
    };
  }

  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const probeResults = await mapWithConcurrency(
    urls,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    (url) => probePhotoUrl(url, fetcher, options.timeoutMs ?? PHOTO_PROBE_TIMEOUT_MS),
  );
  const failedUrls = urls.filter((_, index) => !probeResults[index]?.ok);
  const downloadablePhotos = images.filter((image) => {
    const index = urls.indexOf(image.url.trim());
    return index >= 0 && probeResults[index]?.ok;
  }).length;

  if (downloadablePhotos !== totalPhotos) {
    return {
      ready: false,
      totalPhotos,
      downloadablePhotos,
      failedUrls,
      reason: `Lucki photo preflight failed: ${downloadablePhotos} of ${totalPhotos} source photos are downloadable`,
    };
  }

  return { ready: true, totalPhotos, downloadablePhotos, failedUrls: [], reason: null };
}

export function clearLuckiPhotoProbeCache(): void {
  photoProbeCache.clear();
}
