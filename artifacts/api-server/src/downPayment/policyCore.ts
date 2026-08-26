import type { DealerDownPaymentConfig, Vehicle } from "@workspace/db";

export type DownPaymentPolicy = {
  configId: number | null;
  planAmounts: number[];
  minimumAmount: number | null;
  vehicleOverride: number | null;
  source: "dealer_config" | "vehicle_override" | "none";
};

export function normalizePlanAmounts(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)]
    .filter((amount): amount is number => typeof amount === "number" && Number.isInteger(amount) && amount > 0)
    .sort((a, b) => a - b);
}

function isEffective(config: Pick<DealerDownPaymentConfig, "effectiveFrom" | "effectiveTo">, now: Date): boolean {
  return config.effectiveFrom.getTime() <= now.getTime() &&
    (config.effectiveTo == null || config.effectiveTo.getTime() > now.getTime());
}

function activeVehicleOverride(vehicle: Pick<Vehicle, "downPaymentOverride" | "downPaymentOverrideEffectiveFrom" | "downPaymentOverrideEffectiveTo"> | null, now: Date): number | null {
  if (!vehicle?.downPaymentOverride || vehicle.downPaymentOverride <= 0) return null;
  if (vehicle.downPaymentOverrideEffectiveFrom && vehicle.downPaymentOverrideEffectiveFrom.getTime() > now.getTime()) return null;
  if (vehicle.downPaymentOverrideEffectiveTo && vehicle.downPaymentOverrideEffectiveTo.getTime() <= now.getTime()) return null;
  return vehicle.downPaymentOverride;
}

export function resolveDownPaymentPolicy(
  configs: DealerDownPaymentConfig[],
  vehicle: Pick<Vehicle, "downPaymentOverride" | "downPaymentOverrideEffectiveFrom" | "downPaymentOverrideEffectiveTo"> | null = null,
  now = new Date(),
): DownPaymentPolicy {
  const config = configs
    .filter((candidate) => isEffective(candidate, now))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
  const planAmounts = normalizePlanAmounts(config?.planAmounts);
  const override = activeVehicleOverride(vehicle, now);
  if (override != null) {
    return { configId: config?.id ?? null, planAmounts, minimumAmount: override, vehicleOverride: override, source: "vehicle_override" };
  }
  if (planAmounts.length > 0) {
    return { configId: config?.id ?? null, planAmounts, minimumAmount: planAmounts[0] ?? null, vehicleOverride: null, source: "dealer_config" };
  }
  return { configId: null, planAmounts: [], minimumAmount: null, vehicleOverride: null, source: "none" };
}

export function formatDownPaymentAmounts(amounts: number[], language: "en" | "es"): string {
  const formatted = amounts.map((amount) => `$${amount.toLocaleString("en-US")}`);
  if (formatted.length === 0) return "";
  if (formatted.length === 1) return formatted[0]!;
  const last = formatted.at(-1)!;
  const head = formatted.slice(0, -1).join(", ");
  return language === "es" ? `${head} y ${last}` : `${head}, and ${last}`;
}

export function buildDownPaymentInstruction(policy: DownPaymentPolicy, language: "en" | "es"): string {
  if (policy.planAmounts.length === 0 && policy.vehicleOverride == null) {
    return language === "es"
      ? "No hay una configuración vigente de enganches. No menciones ningún monto; pregunta únicamente con cuánto cuenta el comprador."
      : "There is no current approved down-payment configuration. Do not mention any amount; only ask how much the buyer has available.";
  }
  const amounts = policy.vehicleOverride != null
    ? `$${policy.vehicleOverride.toLocaleString("en-US")}`
    : formatDownPaymentAmounts(policy.planAmounts, language);
  return language === "es"
    ? `Los únicos montos aprobados de enganche son ${amounts}. Usa únicamente esos montos y nunca tomes cifras de mensajes anteriores.`
    : `The only approved down-payment amounts are ${amounts}. Use only those amounts and never take figures from previous messages.`;
}
