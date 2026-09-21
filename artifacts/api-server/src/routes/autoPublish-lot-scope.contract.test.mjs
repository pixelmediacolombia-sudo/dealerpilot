import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routeSource = await readFile(new URL("./autoPublish.ts", import.meta.url), "utf8");
const forecastSource = await readFile(new URL("../publishing/autoPublishForecast.ts", import.meta.url), "utf8");

test("auto-publish batch selection keeps Alpha Manassas-only without excluding other dealers", () => {
  assert.match(
    routeSource,
    /dealerId === ALPHA_DEALER_ID \? eq\(vehiclesTable\.lotLocation, ALPHA_LOT_MANASSAS\) : undefined/,
  );
  assert.doesNotMatch(
    routeSource,
    /eq\(vehiclesTable\.lotLocation, ALPHA_LOT_MANASSAS\),\s*lotLocation \?/s,
  );
});

test("auto-publish forecast applies the Alpha lot guard only to Alpha", () => {
  assert.match(
    forecastSource,
    /dealerId === ALPHA_DEALER_ID \? eq\(vehiclesTable\.lotLocation, ALPHA_LOT_MANASSAS\) : undefined/,
  );
  assert.match(
    forecastSource,
    /if \(dealerId === ALPHA_DEALER_ID && \(!LOT_CITY_MAP\[vehicle\.lotLocation \?\? ""\] \|\| !isAlphaManassasVehicle\(vehicle\)\)\)/,
  );
});
