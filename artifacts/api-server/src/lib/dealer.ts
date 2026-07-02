/**
 * Canonical dealer constants for DealerPilot AI.
 *
 * IMPORTANT — lot_location is NOT a city field for dealer_id = 1.
 * The Alpha Motorsport XML feed writes the dealer name ("Alpha Motorsports")
 * into lot_location, not a city like "Manassas".
 *
 * Scope rules:
 *   - Active dealer scope → eq(vehiclesTable.dealerId, ALPHA_DEALER_ID)
 *   - Do NOT filter by lot_location or ilike('%manassas%') for dealer_id = 1.
 *     That filter matches zero rows (or only NULLs) and corrupts queries.
 *
 * If a future feed starts populating lot_location with real city values,
 * revisit these constants before adding city-based filtering.
 */

export const ALPHA_DEALER_ID = 1;
export const ALPHA_DEALER_LABEL = "Alpha Motorsport";
