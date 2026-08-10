/**
 * Alpha Motorsport location scraper.
 *
 * The combined Facebook catalog XML feed does NOT contain a VehicleLocationID
 * or any other field that identifies which physical lot a vehicle is parked at.
 * The split is managed entirely in the DealerCentric DMS and is exposed only
 * through the website's ?VehicleLocationID= filter parameter.
 *
 * This module scrapes the active Manassas page to produce a stock number to
 * city mapping so that lot_location in our DB reflects the active destination.
 */

import type { Logger } from "pino";
import { ALPHA_VEHICLE_LOCATION_IDS } from "../lib/dealer";

const BASE_URL = "https://www.alphamotorsport.net/used-cars";

// Matches Alpha Motorsport stock number formats: SGF018252, CGF22223, BB34989, S011467, C008276, WESS316006, SAL131935, etc.
const STOCK_RE = /\b((?:SGF|CGF|BBGF|BB|WESS|SAL|S|C)\d{4,8})\b/g;

const UA = "Mozilla/5.0 (compatible; DealerPilot/1.0)";

async function fetchPage(locationId: string, page: number): Promise<string> {
  const url = `${BASE_URL}?VehicleLocationID=${locationId}&Page=${page}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

/**
 * Scrape the active Alpha Motorsport location page and return a
 * Map<stockNumber, locationName> (e.g. "SGF018252" → "Manassas").
 *
 * Paginates up to MAX_PAGES per location; stops when a page returns no stock
 * numbers (empty page = past the end of inventory).
 */
export async function scrapeAlphaLocationMapping(
  log: Pick<Logger, "info" | "warn">,
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  const MAX_PAGES = 8;

  for (const [locationId, locationName] of Object.entries(ALPHA_VEHICLE_LOCATION_IDS)) {
    let locationCount = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
      let html: string;
      try {
        html = await fetchPage(locationId, page);
      } catch (err) {
        log.warn(
          { locationId, locationName, page, err },
          "Failed to fetch location page — stopping pagination for this location",
        );
        break;
      }

      const stocks = new Set<string>();
      let m: RegExpExecArray | null;
      STOCK_RE.lastIndex = 0;
      while ((m = STOCK_RE.exec(html)) !== null) {
        stocks.add(m[1]!);
      }

      if (stocks.size === 0) {
        // Empty page = past end of inventory for this location
        break;
      }

      for (const s of stocks) {
        mapping.set(s, locationName);
        locationCount++;
      }
    }

    log.info(
      { locationId, locationName, count: locationCount },
      "Scraped Alpha Motorsport location mapping",
    );
  }

  return mapping;
}
