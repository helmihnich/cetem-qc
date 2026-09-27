import { apiErrorSchema, healthResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { HealthResponse } from "@cetem-qc/schemas/api/v1";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export function createApiClient({ baseUrl, fetch: fetcher = fetch }: ApiClientOptions) {
  const root = `${baseUrl.replace(/\/$/, "")}/api/v1`;

  return {
    async getHealth(): Promise<HealthResponse> {
      const response = await fetcher(`${root}/health`, { headers: { accept: "application/json" } });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(payload);
        throw new ApiRequestError(
          parsedError.success ? parsedError.data.error.message : "The API request failed.",
          response.status,
          parsedError.success ? parsedError.data.error.code : "UNEXPECTED_API_RESPONSE",
        );
      }

      return healthResponseSchema.parse(payload);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
