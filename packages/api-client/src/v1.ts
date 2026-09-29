import { apiErrorSchema, authenticationRequestSchema, authenticationResponseSchema, createEmployeeRequestSchema, createTaskRequestSchema, employeeCredentialResponseSchema, employeeListResponseSchema, employeeTaskListQuerySchema, employeeTaskListResponseSchema, employeeTaskResponseSchema, healthResponseSchema, passwordReplacementRequestSchema, sessionResponseSchema, taskAssigneeListResponseSchema, taskListResponseSchema, taskResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { AuthenticationRequest, AuthenticationResponse, CreateEmployeeRequest, CreateTaskRequest, EmployeeCredentialResponse, EmployeeListResponse, EmployeeTaskListResponse, EmployeeTaskResponse, HealthResponse, PasswordReplacementRequest, TaskListResponse, TaskResponse } from "@cetem-qc/schemas/api/v1";

export { taskListResponseSchema };
export type { EmployeeTaskListResponse, EmployeeTaskResponse, TaskListResponse };

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
  sessionToken?: string;
  onSessionToken?: (token: string | undefined) => void;
}

export function createApiClient({ baseUrl, fetch: fetcher = fetch, sessionToken: initialSessionToken, onSessionToken }: ApiClientOptions) {
  const root = `${baseUrl.replace(/\/$/, "")}/api/v1`;
  let sessionToken: string | undefined = initialSessionToken;

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
      setSessionToken(session.token);
      return session;
    },
    async getSession() {
      const payload = await request("/session", { method: "GET", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return sessionResponseSchema.parse(payload.data);
    },
    async listOwnTeamEmployees(): Promise<EmployeeListResponse> {
      const payload = await request("/employees", { method: "GET", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return employeeListResponseSchema.parse(payload.data);
    },
    async createOwnTeamEmployee(input: CreateEmployeeRequest): Promise<EmployeeCredentialResponse> {
      const payload = await request("/employees", { method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() }, body: JSON.stringify(createEmployeeRequestSchema.parse(input)) });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return employeeCredentialResponseSchema.parse(payload.data);
    },
    async listTaskAssignees() {
      const payload = await request("/task-assignees", { method: "GET", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return taskAssigneeListResponseSchema.parse(payload.data);
    },
    async listOwnTeamTasks(): Promise<TaskListResponse> {
      const payload = await request("/tasks", { method: "GET", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return taskListResponseSchema.parse(payload.data);
    },
    async listAssignedEmployeeTasks(): Promise<EmployeeTaskListResponse> {
      employeeTaskListQuerySchema.parse({});
      const payload = await request("/employee/tasks", { method: "GET", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return employeeTaskListResponseSchema.parse(payload.data);
    },
    async getAssignedEmployeeTask(taskId: string): Promise<EmployeeTaskResponse> {
      const payload = await request(`/employee/tasks/${encodeURIComponent(taskId)}`, { method: "GET", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return employeeTaskResponseSchema.parse(payload.data);
    },
    async createAssignedTask(input: CreateTaskRequest): Promise<TaskResponse> {
      const payload = await request("/tasks", { method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() }, body: JSON.stringify(createTaskRequestSchema.parse(input)) });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return taskResponseSchema.parse(payload.data);
    },
    async regenerateEmployeeCredential(employeeId: string): Promise<EmployeeCredentialResponse> {
      const payload = await request(`/employees/${encodeURIComponent(employeeId)}/credential`, { method: "POST", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return employeeCredentialResponseSchema.parse(payload.data);
    },
    async replaceTemporaryPassword(input: PasswordReplacementRequest): Promise<AuthenticationResponse> {
      const session = await post("/authenticate/password", passwordReplacementRequestSchema.parse(input));
      setSessionToken(session.token);
      return session;
    },
    async logout(): Promise<void> {
      const payload = await request("/session", { method: "DELETE", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      setSessionToken(undefined);
    },
  };

  function sessionHeaders(): Record<string, string> {
    return sessionToken ? { authorization: `Bearer ${sessionToken}` } : {};
  }

  function setSessionToken(token: string | undefined) {
    sessionToken = token;
    onSessionToken?.(token);
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
