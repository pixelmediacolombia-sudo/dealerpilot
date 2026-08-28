/**
 * Alpha Motorsport location scraper.
 *
 * The combined Facebook catalog XML feed does NOT contain a VehicleLocationID
 * or any other field that identifies which physical lot a vehicle is parked at.
 * The split is managed entirely in the DealerCentric DMS and is exposed only
 * through the website's ?VehicleLocationID= filter parameter.
 *
 * This module scrapes Alpha's location-filtered pages to produce a stock
 * number-to-city mapping so that lot_location in our DB reflects the actual
 * physical destination.
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
    const seenStocksForLocation = new Set<string>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      let html: string;
      try {
        html = await fetchPage(locationId, page);
      } catch (err) {
        log.warn(
          { locationId, locationName, page, err },
          "Failed to fetch location page — stopping pagination for this location",
        );
        throw new Error(`Failed to verify Alpha ${locationName} inventory page ${page}`);
      }

      const stocks = new Set<string>();
      let m: RegExpExecArray | null;
      STOCK_RE.lastIndex = 0;
      while ((m = STOCK_RE.exec(html)) !== null) {
        stocks.add(m[1]!);
      }

      if (stocks.size === 0) {
        // Empty page = past end of inventory for this location
        log.info({ locationId, locationName, page }, "Alpha location pagination reached an empty page");
        break;
      }

      const newStocks = [...stocks].filter((stock) => !seenStocksForLocation.has(stock));
      if (newStocks.length === 0) {
        // Some inventory sites repeat the first page after the last page
        // instead of returning an empty page. Treat that as end-of-feed so a
        // production sync cannot loop over duplicate listings.
        log.info(
          { locationId, locationName, page, repeatedStocks: stocks.size },
          "Alpha location pagination reached a repeated page",
        );
        break;
      }

      log.info(
        { locationId, locationName, page, pageStocks: stocks.size, newStocks: newStocks.length },
        "Alpha location page verified",
      );

      for (const s of stocks) {
        const previousLocation = mapping.get(s);
        if (previousLocation && previousLocation !== locationName) {
          throw new Error(`Stock ${s} appears in both ${previousLocation} and ${locationName}`);
        }
        mapping.set(s, locationName);
        seenStocksForLocation.add(s);
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
