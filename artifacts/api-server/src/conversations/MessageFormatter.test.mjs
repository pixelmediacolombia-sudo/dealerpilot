import assert from "node:assert/strict";
import test from "node:test";
import { formatPriceConfirmation } from "./messageFormatter.ts";

test("formats the exact inventory amount and keeps the interest CTA open", () => {
  const reply = formatPriceConfirmation({
    language: "es",
    price: 32500,
    vehicleTitle: "2022 Toyota Camry",
  });
  assert.equal(reply, "Sí, $32,500 es el precio total del 2022 Toyota Camry. ¿Continúas interesado en este vehículo?");
});

test("uses the published list price when inventory price is unavailable", () => {
  const reply = formatPriceConfirmation({
    language: "es",
    price: null,
    listedPrice: 18200,
    vehicleTitle: "2021 Mazda CX-5",
  });
  assert.match(reply, /precio de lista actual de \$18,200/);
  assert.match(reply, /¿Continúas interesado en este vehículo\?/);
});

test("does not close the flow in the confirmation reply", () => {
  const reply = formatPriceConfirmation({ language: "en", price: 32500, vehicleTitle: "2022 Toyota Camry" });
  assert.match(reply, /Are you still interested in this vehicle\?/);
  assert.doesNotMatch(reply, /goodbye|close|contact you shortly/i);
});
