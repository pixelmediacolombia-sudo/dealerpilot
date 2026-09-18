export const LUCKI_MAZDA_DEALER_ID = 2;
export const LUCKI_MAZDA_PROVIDER_NAME = "Vincue";

export type DealerFeedRuntimeConfig = {
  providerName: string;
  providerDealerId: string | null;
  xmlFeedUrl: string | null;
  feedAuthMode: "x-api-key" | "none";
  headers: Record<string, string>;
};

/**
 * Resolve Lucki's non-secret feed settings and secret-backed request headers
 * at call time. The API key is deliberately never returned in a serializable
 * dealer object, persisted field, or error message.
 */
export function getLuckiMazdaFeedConfig(
  env: NodeJS.ProcessEnv = process.env,
): DealerFeedRuntimeConfig {
  const apiKey = env.VINCUE_API_KEY_LUCKI_MAZDA?.trim() ?? "";
  const providerDealerId = env.VINCUE_LUCKI_MAZDA_DEALER_ID?.trim() || null;
  const xmlFeedUrl = env.VINCUE_LUCKI_MAZDA_XML_URL?.trim() || null;

  return {
    providerName: LUCKI_MAZDA_PROVIDER_NAME,
    providerDealerId,
    xmlFeedUrl,
    feedAuthMode: apiKey ? "x-api-key" : "none",
    headers: apiKey ? { "x-api-key": apiKey } : {},
  };
}

export function assertLuckiMazdaFeedConfig(
  config = getLuckiMazdaFeedConfig(),
): DealerFeedRuntimeConfig {
  if (!config.providerDealerId) {
    throw new Error("Lucki Mazda feed is missing VINCUE_LUCKI_MAZDA_DEALER_ID");
  }
  if (!config.xmlFeedUrl) {
    throw new Error("Lucki Mazda feed is missing VINCUE_LUCKI_MAZDA_XML_URL");
  }
  if (config.feedAuthMode !== "x-api-key") {
    throw new Error("Lucki Mazda feed is missing its runtime Vincue API key");
  }
  return config;
}
