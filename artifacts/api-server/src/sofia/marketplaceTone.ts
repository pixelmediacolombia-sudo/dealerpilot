export type MarketplaceVehicleFacts = {
  title?: string | null;
  vin?: string | null;
  mileage?: number | null;
  price?: number | null;
  exteriorColor?: string | null;
  vdpUrl?: string | null;
  photoCount?: number | null;
  carfaxUrl?: string | null;
  dealerPhone?: string | null;
  dealerAddress?: string | null;
};

export type VehicleRequestKind = "photos" | "carfax" | null;

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function hasVisitDaySignal(value: unknown): boolean {
  const text = normalized(value);
  return /\b(?:this|next|coming|on|over|during)\s+(?:the\s+)?(?:weekend|weekday|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text) ||
    (/\b(?:weekend|entre semana|fin de semana|sabado|domingo|lunes|martes|miercoles|jueves|viernes|hoy|manana)\b/.test(text) &&
      /\b(?:come|visit|stop|go|drive|see|venir|visitar|pasar|ir|ver|llego|llegar|need to come|would need to come|vengo|voy)\b/.test(text));
}

export function hasDownPaymentAmount(value: unknown): boolean {
  const text = normalized(value);
  if (!text) return false;
  const withoutPhone = text.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, " ");
  return /(?:\$\s*)\d{1,3}(?:[,.]\d{3})?(?:\s*(?:k|thousand|mil))?\b/.test(withoutPhone) ||
    /\b\d{1,3}(?:[,.]\d{3})?\s*(?:k|thousand|mil)\b/.test(withoutPhone) ||
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|one thousand|two thousand|three thousand|mil|dos mil|tres mil)\b/.test(withoutPhone) &&
      /\b(?:down|down payment|enganche|inicial|cash|contado|efectivo|have|tengo|cuento|put|dar|poner)\b/.test(withoutPhone);
}

export function hasConcreteCashOffer(value: unknown): boolean {
  const text = normalized(value);
  return /\b(?:cash|cash buyer|pay(?:ing)? cash|contado|efectivo)\b/.test(text) && hasDownPaymentAmount(text);
}

export function detectVehicleRequestKind(value: unknown): VehicleRequestKind {
  const text = normalized(value);
  if (!text) return null;
  if (/\b(?:carfax|vehicle history|history report|accident|accidents|any issues|issues with it|issue with it|problem with it|problems with it|reporte del carro|reporte del vehiculo|historial del carro|historial del vehiculo|accidente|accidentes|problemas con el|alg[uú]n problema)\b/.test(text)) return "carfax";
  if (/\b(?:photo|photos|picture|pictures|images|fotos|fotografias|imagenes|mas fotos|more photos|more information|more info|additional information|additional info|more details|more detail|mas informacion|más información|mas info|más info|ficha|informacion|información)\b/.test(text)) return "photos";
  return null;
}

export function extractCarfaxUrlFromSourceRaw(sourceRaw: unknown): string | null {
  const text = String(sourceRaw ?? "");
  const match = text.match(/https?:\/\/[^\s"']*carfax[^\s"']*/i);
  return match?.[0]?.replace(/[),.;]+$/, "") || null;
}

export function vehicleValueFact(
  facts: MarketplaceVehicleFacts | null | undefined,
  language: "en" | "es" = "en",
): string | null {
  if (!facts) return null;
  if (Number.isFinite(facts.mileage)) {
    const miles = Number(facts.mileage).toLocaleString("en-US");
    return language === "es" ? `${miles} millas` : `${miles} miles`;
  }
  if (facts.exteriorColor?.trim()) {
    return language === "es" ? `color ${facts.exteriorColor.trim()}` : `${facts.exteriorColor.trim()} exterior`;
  }
  return null;
}

export function hasVehicleValueFact(
  reply: unknown,
  facts: MarketplaceVehicleFacts | null | undefined,
): boolean {
  const text = normalized(reply);
  if (!text || !facts) return false;
  if (Number.isFinite(facts.mileage)) {
    const digits = String(Math.round(Number(facts.mileage)));
    if (text.replace(/\D/g, "").includes(digits)) return true;
  }
  if (facts.price != null && text.replace(/\D/g, "").includes(String(Math.round(Number(facts.price))))) return true;
  if (facts.vin?.trim() && text.includes(normalized(facts.vin))) return true;
  return !!facts.exteriorColor?.trim() && text.includes(normalized(facts.exteriorColor));
}

export function isConciseMarketplaceReply(reply: unknown): boolean {
  const text = String(reply ?? "").trim();
  if (!text || text.length > 420) return false;
  const sentenceCount = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
  const questionCount = (text.match(/[?¿]/g) || []).length;
  return sentenceCount <= 3 && questionCount <= 1;
}
