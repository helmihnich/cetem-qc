import type { HealthQuery } from "@cetem-qc/schemas/api/v1";
import type { HealthResponse } from "@cetem-qc/schemas/api/v1";

/** Public query contract for the health module. Callers depend on this function, never its storage. */
export async function getHealth(_query: HealthQuery): Promise<HealthResponse> {
  return { status: "ok", version: "v1" };
}
