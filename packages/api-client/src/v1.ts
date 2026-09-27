import { apiErrorSchema, authenticationRequestSchema, authenticationResponseSchema, healthResponseSchema, passwordReplacementRequestSchema, sessionResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { AuthenticationRequest, AuthenticationResponse, HealthResponse, PasswordReplacementRequest } from "@cetem-qc/schemas/api/v1";

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
  let sessionToken: string | undefined;

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
    async authenticate(input: AuthenticationRequest): Promise<AuthenticationResponse> {
      const session = await post("/authenticate", authenticationRequestSchema.parse(input), false);
      sessionToken = session.token;
      return session;
    },
    async getSession() {
      const payload = await request("/session", { method: "GET", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return sessionResponseSchema.parse(payload.data);
    },
    async replaceTemporaryPassword(input: PasswordReplacementRequest): Promise<AuthenticationResponse> {
      const session = await post("/authenticate/password", passwordReplacementRequestSchema.parse(input));
      sessionToken = session.token;
      return session;
    },
    async logout(): Promise<void> {
      const payload = await request("/session", { method: "DELETE", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      sessionToken = undefined;
    },
  };

  function sessionHeaders(): Record<string, string> {
    return sessionToken ? { authorization: `Bearer ${sessionToken}` } : {};
  }

  async function request(path: string, init: RequestInit) {
    const response = await fetcher(`${root}${path}`, init);
    const data: unknown = response.status === 204 ? undefined : await response.json();
    return { response, data };
  }

  function toRequestError(status: number, payload: unknown): ApiRequestError {
    const parsedError = apiErrorSchema.safeParse(payload);
    return new ApiRequestError(
      parsedError.success ? parsedError.data.error.message : "The API request failed.", status,
      parsedError.success ? parsedError.data.error.code : "UNEXPECTED_API_RESPONSE",
    );
  }

  async function post(path: string, body: unknown, authenticated = true): Promise<AuthenticationResponse> {
    const { response, data } = await request(path, {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...(authenticated ? sessionHeaders() : {}) }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw toRequestError(response.status, data);
    }
    return authenticationResponseSchema.parse(data);
  }
}

export type ApiClient = ReturnType<typeof createApiClient>;
