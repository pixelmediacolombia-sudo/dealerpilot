import { CURRENT_SAMPLE_FEED } from "./sampleFeed.ts";

export type FetchFeedOptions = {
  headers?: Readonly<Record<string, string>>;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

// Hosts that must never be fetched: a dealer-supplied feed URL is attacker-
// controllable input, so we block loopback/link-local/metadata targets to
// avoid SSRF against internal services.
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  // Cloud metadata endpoint.
  if (host === "169.254.169.254" || host === "metadata.google.internal") {
    return true;
  }
  // IPv6 loopback / unspecified.
  if (host === "::1" || host === "::" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  // IPv4 private / loopback / link-local / unspecified ranges.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

// Resolve a dealer's feed URL to XML text. The built-in sample feed is served
// locally (no network round-trip) so the spike works offline; any other URL is
// fetched over HTTP after SSRF validation.
export async function fetchFeedXml(
  url: string | null | undefined,
  options: FetchFeedOptions = {},
): Promise<string> {
  const trimmed = (url ?? "").trim();
  if (
    trimmed === "" ||
    trimmed.toLowerCase() === "sample" ||
    trimmed.includes("sample-feed")
  ) {
    return CURRENT_SAMPLE_FEED();
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid feed URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported feed URL scheme: ${parsed.protocol}`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Feed URL host is not allowed: ${parsed.hostname}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      redirect: "error",
      headers: options.headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Feed request timed out");
    if (error instanceof TypeError) throw new Error("Feed request failed before receiving a response");
    throw new Error("Feed request failed before receiving a response");
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`Feed request failed: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("xml") && !contentType.includes("rss") && !contentType.includes("atom")) {
    throw new Error("Feed response was not XML");
  }
  const body = await res.text();
  if (!body.trim()) throw new Error("Feed response was empty");
  return body;
}
