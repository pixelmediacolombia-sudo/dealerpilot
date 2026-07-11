import { HealthCheckResponse } from "@workspace/api-zod";
import type { HealthStatus } from "../domain/HealthStatus";

export function getHealthStatus(): HealthStatus {
  return HealthCheckResponse.parse({ status: "ok" as const });
}
