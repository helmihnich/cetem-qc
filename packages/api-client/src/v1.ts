import { apiErrorSchema, authenticationRequestSchema, authenticationResponseSchema, createEmployeeRequestSchema, createTaskRequestSchema, employeeCredentialResponseSchema, employeeListResponseSchema, employeeTaskAuditVersionSchema, employeeTaskListQuerySchema, employeeTaskListResponseSchema, employeeTaskResponseSchema, healthResponseSchema, passwordReplacementRequestSchema, replacementTaskResponseSchema, sessionResponseSchema, syncOperationAcceptedSchema, syncOperationConflictSchema, syncOperationRejectedSchema, syncOperationRequestSchema, taskAssigneeListResponseSchema, taskListResponseSchema, taskResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { AuthenticationRequest, AuthenticationResponse, CreateEmployeeRequest, CreateTaskRequest, EmployeeCredentialResponse, EmployeeListResponse, EmployeeTaskAuditVersion, EmployeeTaskListResponse, EmployeeTaskResponse, HealthResponse, PasswordReplacementRequest, ReplacementTaskResponse, SyncOperationAccepted, SyncOperationConflict, SyncOperationRejected, SyncOperationRequest, TaskListResponse, TaskResponse } from "@cetem-qc/schemas/api/v1";

export { replacementTaskResponseSchema, taskListResponseSchema };
export type { CreateTaskRequest, EmployeeTaskAuditVersion, EmployeeTaskListResponse, EmployeeTaskResponse, ReplacementTaskResponse, SyncOperationAccepted, SyncOperationConflict, SyncOperationRejected, SyncOperationRequest, TaskListResponse };

export type SyncOperationResponse =
  | { status: 200; body: SyncOperationAccepted }
  | { status: 409; body: SyncOperationConflict }
  | { status: 422; body: SyncOperationRejected };

/** The documented outcomes of a replacement request; any other status or body throws `ApiRequestError`. */
export type ReplacementControlResponse =
  | { status: 201; body: ReplacementTaskResponse }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "AUDIT_NOT_ACCEPTED" | "REPLACEMENT_ALREADY_EXISTS"; message: string }
  | { status: 422; code: "TASK_ASSIGNEE_UNAVAILABLE"; message: string };

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
    /** Creates a replacement control linked to the accepted audit of `originalTaskId` (Responsable only). */
    async createReplacementControl(originalTaskId: string, input: CreateTaskRequest): Promise<ReplacementControlResponse> {
      const payload = await request(`/tasks/${encodeURIComponent(originalTaskId)}/replacements`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() }, body: JSON.stringify(createTaskRequestSchema.parse(input)) });
      const status = payload.response.status;
      if (status === 201) {
        const parsed = replacementTaskResponseSchema.safeParse(payload.data);
        if (parsed.success) return { status: 201, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && (code === "AUDIT_NOT_ACCEPTED" || code === "REPLACEMENT_ALREADY_EXISTS")) return { status, code, message };
        if (status === 422 && code === "TASK_ASSIGNEE_UNAVAILABLE") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    async regenerateEmployeeCredential(employeeId: string): Promise<EmployeeCredentialResponse> {
      const payload = await request(`/employees/${encodeURIComponent(employeeId)}/credential`, { method: "POST", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return employeeCredentialResponseSchema.parse(payload.data);
    },
    async resetEmployeePassword(employeeId: string): Promise<EmployeeCredentialResponse> {
      const payload = await request(`/employees/${encodeURIComponent(employeeId)}/password-reset`, { method: "POST", headers: { accept: "application/json", ...sessionHeaders() } });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return employeeCredentialResponseSchema.parse(payload.data);
    },
    async replaceTemporaryPassword(input: PasswordReplacementRequest): Promise<AuthenticationResponse> {
      const session = await post("/authenticate/password", passwordReplacementRequestSchema.parse(input));
      setSessionToken(session.token);
      return session;
    },
    syncEmployeeTaskDraft(taskId: string, body: SyncOperationRequest, options: { signal?: AbortSignal } = {}): Promise<SyncOperationResponse> {
      return sendSyncOperation(`/employee/tasks/${encodeURIComponent(taskId)}/draft-syncs`, body, options.signal);
    },
    submitEmployeeTaskAudit(taskId: string, body: SyncOperationRequest, options: { signal?: AbortSignal } = {}): Promise<SyncOperationResponse> {
      return sendSyncOperation(`/employee/tasks/${encodeURIComponent(taskId)}/submissions`, body, options.signal);
    },
    /** The current server version of the task's audit; any other status or an invalid body throws `ApiRequestError`. */
    async getEmployeeTaskAuditVersion(taskId: string, options: { signal?: AbortSignal } = {}): Promise<EmployeeTaskAuditVersion> {
      const signal = options.signal;
      const response = await fetcher(`${root}/employee/tasks/${encodeURIComponent(taskId)}/audit-version`, {
        method: "GET", headers: { accept: "application/json", ...sessionHeaders() }, ...(signal ? { signal } : {}),
      });
      let data: unknown;
      try {
        data = await response.json();
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new ApiRequestError("The API response could not be read.", response.status, "UNEXPECTED_API_RESPONSE");
      }
      if (response.status === 200) {
        const parsed = employeeTaskAuditVersionSchema.safeParse(data);
        if (parsed.success) return parsed.data;
      }
      throw toRequestError(response.status, data);
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

  /** Only a schema-valid outcome body is returned; everything else throws, and network failures and aborts propagate. */
  async function sendSyncOperation(path: string, body: SyncOperationRequest, signal: AbortSignal | undefined): Promise<SyncOperationResponse> {
    const response = await fetcher(`${root}${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
      body: JSON.stringify(syncOperationRequestSchema.parse(body)),
      ...(signal ? { signal } : {}),
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiRequestError("The API response could not be read.", response.status, "UNEXPECTED_API_RESPONSE");
    }
    if (response.status === 200) {
      const parsed = syncOperationAcceptedSchema.safeParse(data);
      if (parsed.success) return { status: 200, body: parsed.data };
    } else if (response.status === 409) {
      const parsed = syncOperationConflictSchema.safeParse(data);
      if (parsed.success) return { status: 409, body: parsed.data };
    } else if (response.status === 422) {
      const parsed = syncOperationRejectedSchema.safeParse(data);
      if (parsed.success) return { status: 422, body: parsed.data };
    }
    throw toRequestError(response.status, data);
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
