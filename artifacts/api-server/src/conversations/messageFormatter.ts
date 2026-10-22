export type PriceConfirmationInput = {
  language: string;
  price?: number | null;
  listedPrice?: number | null;
  vehicleTitle?: string | null;
};

function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function vehicleName(value?: string | null, language = "en"): string {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  return title || (language === "es" ? "vehículo" : "vehicle");
}

/** Builds the deterministic total-price confirmation and interest CTA. */
export function formatPriceConfirmation(input: PriceConfirmationInput): string {
  const language = input.language === "es" ? "es" : "en";
  const vehicle = vehicleName(input.vehicleTitle, language);

  if (input.price != null && Number.isFinite(input.price)) {
    const amount = money(input.price);
    return language === "es"
      ? `Sí, ${amount} es el precio total del ${vehicle}. ¿Continúas interesado en este vehículo?`
      : `Yes, ${amount} is the total price for the ${vehicle}. Are you still interested in this vehicle?`;
  }

  if (input.listedPrice != null && Number.isFinite(input.listedPrice)) {
    const amount = money(input.listedPrice);
    return language === "es"
      ? `El valor publicado en el anuncio es el precio de lista actual de ${amount} del ${vehicle}. ¿Continúas interesado en este vehículo?`
      : `The value published in the listing is the current list price of ${amount} for the ${vehicle}. Are you still interested in this vehicle?`;
  }

  return language === "es"
    ? `El valor publicado en el anuncio es el precio de lista actual del ${vehicle}. ¿Continúas interesado en este vehículo?`
    : `The value published in the listing is the current list price for the ${vehicle}. Are you still interested in this vehicle?`;
}
