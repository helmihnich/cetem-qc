import { acceptedEvidenceResponseSchema, apiErrorSchema, conformityDecisionRequestSchema, conformityDecisionSchema, conformityHistoryItemSchema, authenticationRequestSchema, authenticationResponseSchema, confirmedSummarySchema, summaryReopeningRequestSchema, summaryReopeningSchema, summaryHistoryItemSchema, createDeactivatedAssigneeRecoveryRequestSchema, createEmployeeRequestSchema, createTaskRequestSchema, deactivatedAssigneeRecoveryResponseSchema, employeeCredentialResponseSchema, employeeListResponseSchema, employeeTaskAuditVersionSchema, employeeTaskRecoverySeedResponseSchema, employeeTaskListQuerySchema, employeeTaskListResponseSchema, employeeTaskResponseSchema, healthResponseSchema, insightDecisionRequestSchema, insightDecisionResponseSchema, manualInsightRequestSchema, manualInsightResponseSchema, passwordReplacementRequestSchema, reassignUnstartedTaskRequestSchema, reassignUnstartedTaskResponseSchema, replacementTaskResponseSchema, sessionResponseSchema, summaryConfirmationRequestSchema, summaryDraftRequestSchema, summaryDraftResponseSchema, syncOperationAcceptedSchema, syncOperationConflictSchema, syncOperationRejectedSchema, syncOperationRequestSchema, taskAssigneeListResponseSchema, taskListResponseSchema, taskResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { ConformityDecision, ConformityDecisionRequest, ConformityHistoryItem, ConformityOutcome, AcceptedEvidenceResponse, AuthenticationRequest, AuthenticationResponse, ConfirmedSummary, SummaryReopening, SummaryReopeningRequest, SummaryHistoryItem, CreateDeactivatedAssigneeRecoveryRequest, CreateEmployeeRequest, CreateTaskRequest, DeactivatedAssigneeRecoveryResponse, EmployeeCredentialResponse, EmployeeListResponse, EmployeeTaskAuditVersion, EmployeeTaskRecoverySeedResponse, EmployeeTaskListResponse, EmployeeTaskResponse, HealthResponse, InsightDecisionRequest, InsightDecisionResponse, ManualInsightRequest, ManualInsightResponse, PasswordReplacementRequest, ReassignUnstartedTaskRequest, ReassignUnstartedTaskResponse, ReplacementTaskResponse, SummaryConfirmationRequest, SummaryDraftResponse, SyncOperationAccepted, SyncOperationConflict, SyncOperationRejected, SyncOperationRequest, TaskListResponse, TaskResponse } from "@cetem-qc/schemas/api/v1";

import { reportCandidateListSchema, reportCandidateRequestSchema, reportCandidateSchema, reportFromPdfRequestSchema, storedFileListSchema, storedFileSchema } from "@cetem-qc/schemas/api/v1";
import type { ReportCandidate, ReportCandidateList, ReportCandidateRequest, ReportFromPdfRequest, StoredFile, StoredFileList } from "@cetem-qc/schemas/api/v1";

export { reportCandidateListSchema, reportCandidateSchema, storedFileListSchema, storedFileSchema };
export type { ReportCandidate, ReportCandidateList, ReportCandidateRequest, ReportFromPdfRequest, StoredFile, StoredFileList };

export { conformityDecisionSchema, conformityHistoryItemSchema,acceptedEvidenceResponseSchema, confirmedSummarySchema, summaryReopeningSchema, summaryHistoryItemSchema,insightDecisionResponseSchema, manualInsightResponseSchema, replacementTaskResponseSchema, summaryDraftResponseSchema, taskListResponseSchema };
export type { ConformityDecision, ConformityDecisionRequest, ConformityHistoryItem, ConformityOutcome, ConfirmedSummary, SummaryReopening, SummaryHistoryItem,SummaryConfirmationRequest, SummaryDraftResponse, AcceptedEvidenceResponse, InsightDecisionRequest, InsightDecisionResponse, ManualInsightRequest, ManualInsightResponse, CreateDeactivatedAssigneeRecoveryRequest, CreateTaskRequest, DeactivatedAssigneeRecoveryResponse, EmployeeTaskAuditVersion, EmployeeTaskRecoverySeedResponse, EmployeeTaskListResponse, EmployeeTaskResponse, ReassignUnstartedTaskRequest, ReassignUnstartedTaskResponse, ReplacementTaskResponse, SyncOperationAccepted, SyncOperationConflict, SyncOperationRejected, SyncOperationRequest, TaskListResponse };

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

/** The documented outcomes of an accepted-evidence read; any other status or body throws `ApiRequestError`. */
export type AcceptedEvidenceOutcome =
  | { status: 200; body: AcceptedEvidenceResponse }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string };

/** The documented outcomes of an insight decision; any other status or body throws `ApiRequestError`. */
export type InsightDecisionOutcome =
  | { status: 200; body: InsightDecisionResponse }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "SUMMARY_CONFIRMED"; message: string }
  | { status: 422; code: "VALIDATION_FAILED"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string };

/** The documented outcomes of adding a manual insight; any other status or body throws `ApiRequestError`. */
export type AddManualInsightOutcome =
  | { status: 201; body: ManualInsightResponse }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "SUMMARY_CONFIRMED"; message: string }
  | { status: 422; code: "VALIDATION_FAILED"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string };

/** The documented outcomes of an AI summary draft request; any other status or body throws `ApiRequestError`. */
export type RequestSummaryDraftOutcome =
  | { status: 201; body: SummaryDraftResponse }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "SUMMARY_CONFIRMED"; message: string }
  | { status: 422; code: "VALIDATION_FAILED"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string }
  | { status: 502; code: "AI_UNAVAILABLE"; message: string };

/** The documented outcomes of a summary confirmation; any other status or body throws `ApiRequestError`. */
export type ConfirmSummaryOutcome =
  | { status: 201; body: ConfirmedSummary }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "SUMMARY_ALREADY_CONFIRMED"; message: string }
  | { status: 422; code: "VALIDATION_FAILED"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string };

/** The documented outcomes of reopening a confirmed summary; any other status or body throws `ApiRequestError`. */
export type ReopenSummaryOutcome =
  | { status: 201; body: SummaryReopening }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "SUMMARY_NOT_CONFIRMED" | "SUMMARY_DESIGNATED"; message: string }
  | { status: 422; code: "VALIDATION_FAILED"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string };

/** The documented outcomes of recording the conformity decision; any other status or body throws `ApiRequestError`. */
export type RecordConformityDecisionOutcome =
  | { status: 201; body: ConformityDecision }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "SUMMARY_NOT_CONFIRMED" | "CONFORMITY_ALREADY_DECIDED"; message: string }
  | { status: 422; code: "VALIDATION_FAILED"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string };

/** The documented outcomes of a report candidate generation; any other status or body throws `ApiRequestError`. */
export type GenerateReportCandidateOutcome =
  | { status: 200 | 201; body: ReportCandidate }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "SUMMARY_NOT_CONFIRMED" | "CONFORMITY_NOT_DECIDED" | "REPORT_ATTEMPT_CONFLICT" | "REPORT_INPUTS_CHANGED"; message: string }
  | { status: 422; code: "VALIDATION_FAILED"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string }
  | { status: 502; code: "REPORT_GENERATION_FAILED"; message: string };

/** The documented outcomes of attaching a ready PDF as a report candidate; any other status or body throws `ApiRequestError`. */
export type CreateReportCandidateFromPdfOutcome =
  | { status: 200 | 201; body: ReportCandidate }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "SUMMARY_NOT_CONFIRMED" | "CONFORMITY_NOT_DECIDED" | "REPORT_FILE_NOT_READY" | "REPORT_FILE_ALREADY_ATTACHED" | "REPORT_ATTEMPT_CONFLICT"; message: string }
  | { status: 422; code: "VALIDATION_FAILED"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string };

/** The documented outcomes of listing report candidates; any other status or body throws `ApiRequestError`. */
export type ListReportCandidatesOutcome =
  | { status: 200; body: ReportCandidateList }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string };

/** The documented outcomes of a manual PDF upload; any other status or body throws `ApiRequestError`. */
export type UploadManualPdfOutcome =
  | { status: 200 | 201; body: StoredFile }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "SUMMARY_NOT_CONFIRMED" | "CONFORMITY_NOT_DECIDED" | "FILE_ATTEMPT_CONFLICT"; message: string }
  | { status: 413; code: "FILE_TOO_LARGE"; message: string }
  | { status: 415; code: "UNSUPPORTED_FILE_TYPE"; message: string }
  | { status: 422; code: "VALIDATION_FAILED"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string }
  | { status: 502; code: "FILE_STORAGE_FAILED"; message: string };

/** The documented outcomes of listing the uploaded PDF files; any other status or body throws `ApiRequestError`. */
export type ListManualPdfFilesOutcome =
  | { status: 200; body: StoredFileList }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string };

/** The documented outcomes of re-scanning a PDF file; any other status or body throws `ApiRequestError`. */
export type RetryManualPdfScanOutcome =
  | { status: 200; body: StoredFile }
  | { status: 403; code: "FORBIDDEN"; message: string }
  | { status: 404; code: "TASK_NOT_FOUND"; message: string }
  | { status: 409; code: "FILE_NOT_RESCANNABLE"; message: string }
  | { status: 500; code: "INTERNAL_ERROR"; message: string };

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
    /** Reads the accepted evidence of an own-team task and records the access (Responsable only). */
    async getAcceptedEvidence(taskId: string): Promise<AcceptedEvidenceOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/accepted-evidence`, { method: "GET", headers: { accept: "application/json", ...sessionHeaders() }, cache: "no-store" });
      const status = payload.response.status;
      if (status === 200) {
        const parsed = acceptedEvidenceResponseSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Retains or discards one proposed insight of an own-team accepted audit (Responsable only). */
    async recordInsightDecision(taskId: string, input: InsightDecisionRequest): Promise<InsightDecisionOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/insight-decisions`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(insightDecisionRequestSchema.parse(input)), cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 200) {
        const parsed = insightDecisionResponseSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && code === "SUMMARY_CONFIRMED") return { status, code, message };
        if (status === 422 && code === "VALIDATION_FAILED") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Adds one manual insight to an own-team accepted audit (Responsable only). */
    async addManualInsight(taskId: string, input: ManualInsightRequest): Promise<AddManualInsightOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/manual-insights`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(manualInsightRequestSchema.parse(input)), cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 201) {
        const parsed = manualInsightResponseSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && code === "SUMMARY_CONFIRMED") return { status, code, message };
        if (status === 422 && code === "VALIDATION_FAILED") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Requests an AI-assisted summary draft for an own-team accepted audit (Responsable only); the body is always empty. */
    async requestSummaryDraft(taskId: string): Promise<RequestSummaryDraftOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/summary-drafts`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(summaryDraftRequestSchema.parse({})), cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 201) {
        const parsed = summaryDraftResponseSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && code === "SUMMARY_CONFIRMED") return { status, code, message };
        if (status === 422 && code === "VALIDATION_FAILED") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
        if (status === 502 && code === "AI_UNAVAILABLE") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Saves the final text and confirms the summary of an own-team accepted audit (Responsable only). */
    async confirmSummary(taskId: string, input: SummaryConfirmationRequest): Promise<ConfirmSummaryOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/summary-confirmation`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(summaryConfirmationRequestSchema.parse(input)), cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 201) {
        const parsed = confirmedSummarySchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && code === "SUMMARY_ALREADY_CONFIRMED") return { status, code, message };
        if (status === 422 && code === "VALIDATION_FAILED") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Reopens the confirmed summary of an own-team accepted audit before official designation (Responsable only). */
    async reopenSummary(taskId: string, input: SummaryReopeningRequest = {}): Promise<ReopenSummaryOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/summary-reopening`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(summaryReopeningRequestSchema.parse(input)), cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 201) {
        const parsed = summaryReopeningSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && (code === "SUMMARY_NOT_CONFIRMED" || code === "SUMMARY_DESIGNATED")) return { status, code, message };
        if (status === 422 && code === "VALIDATION_FAILED") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Records the explicit machine conformity decision for the current confirmed summary (Responsable only). */
    async recordConformityDecision(taskId: string, input: ConformityDecisionRequest): Promise<RecordConformityDecisionOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/conformity-decision`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(conformityDecisionRequestSchema.parse(input)), cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 201) {
        const parsed = conformityDecisionSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && (code === "SUMMARY_NOT_CONFIRMED" || code === "CONFORMITY_ALREADY_DECIDED")) return { status, code, message };
        if (status === 422 && code === "VALIDATION_FAILED") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Generates a Word report candidate for the task (Responsable only). The candidate is never official. */
    async generateReportCandidate(taskId: string, input: ReportCandidateRequest): Promise<GenerateReportCandidateOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/report-candidates`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(reportCandidateRequestSchema.parse(input)), cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 200 || status === 201) {
        const parsed = reportCandidateSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && (code === "SUMMARY_NOT_CONFIRMED" || code === "CONFORMITY_NOT_DECIDED" || code === "REPORT_ATTEMPT_CONFLICT" || code === "REPORT_INPUTS_CHANGED")) return { status, code, message };
        if (status === 422 && code === "VALIDATION_FAILED") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
        if (status === 502 && code === "REPORT_GENERATION_FAILED") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Attaches a ready PDF of the task as a report candidate (Responsable only). The candidate is never official. */
    async createReportCandidateFromPdf(taskId: string, fileId: string, input: ReportFromPdfRequest): Promise<CreateReportCandidateFromPdfOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/pdf-files/${encodeURIComponent(fileId)}/report-candidate`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(reportFromPdfRequestSchema.parse(input)), cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 200 || status === 201) {
        const parsed = reportCandidateSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && (code === "SUMMARY_NOT_CONFIRMED" || code === "CONFORMITY_NOT_DECIDED" || code === "REPORT_FILE_NOT_READY" || code === "REPORT_FILE_ALREADY_ATTACHED" || code === "REPORT_ATTEMPT_CONFLICT")) return { status, code, message };
        if (status === 422 && code === "VALIDATION_FAILED") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Lists the report candidates of a task, newest first (Responsable only). */
    async listReportCandidates(taskId: string): Promise<ListReportCandidatesOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/report-candidates`, {
        method: "GET", headers: { accept: "application/json", ...sessionHeaders() }, cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 200) {
        const parsed = reportCandidateListSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Uploads a manually prepared PDF (Responsable only). The raw bytes are the body; the file is never official. */
    async uploadManualPdfFile(taskId: string, input: { attemptId: string; fileName?: string; bytes: Uint8Array }): Promise<UploadManualPdfOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/pdf-files`, {
        method: "POST",
        headers: {
          accept: "application/json", "content-type": "application/pdf", "x-attempt-id": input.attemptId,
          ...(input.fileName ? { "x-file-name": encodeURIComponent(input.fileName) } : {}), ...sessionHeaders(),
        },
        body: input.bytes as BodyInit, cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 200 || status === 201) {
        const parsed = storedFileSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && (code === "SUMMARY_NOT_CONFIRMED" || code === "CONFORMITY_NOT_DECIDED" || code === "FILE_ATTEMPT_CONFLICT")) return { status, code, message };
        if (status === 413 && code === "FILE_TOO_LARGE") return { status, code, message };
        if (status === 415 && code === "UNSUPPORTED_FILE_TYPE") return { status, code, message };
        if (status === 422 && code === "VALIDATION_FAILED") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
        if (status === 502 && code === "FILE_STORAGE_FAILED") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Lists the uploaded PDF files of a task, newest first (Responsable only). */
    async listManualPdfFiles(taskId: string): Promise<ListManualPdfFilesOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/pdf-files`, {
        method: "GET", headers: { accept: "application/json", ...sessionHeaders() }, cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 200) {
        const parsed = storedFileListSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    /** Re-scans a scan-failed or scan-pending PDF file (Responsable only). */
    async retryManualPdfScan(taskId: string, fileId: string): Promise<RetryManualPdfScanOutcome> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/pdf-files/${encodeURIComponent(fileId)}/scan-retries`, {
        method: "POST", headers: { accept: "application/json", ...sessionHeaders() }, cache: "no-store",
      });
      const status = payload.response.status;
      if (status === 200) {
        const parsed = storedFileSchema.safeParse(payload.data);
        if (parsed.success) return { status, body: parsed.data };
        throw toRequestError(status, payload.data);
      }
      const error = apiErrorSchema.safeParse(payload.data);
      if (error.success) {
        const { code, message } = error.data.error;
        if (status === 403 && code === "FORBIDDEN") return { status, code, message };
        if (status === 404 && code === "TASK_NOT_FOUND") return { status, code, message };
        if (status === 409 && code === "FILE_NOT_RESCANNABLE") return { status, code, message };
        if (status === 500 && code === "INTERNAL_ERROR") return { status, code, message };
      }
      throw toRequestError(status, payload.data);
    },
    async reassignUnstartedDeactivatedTask(taskId: string, input: ReassignUnstartedTaskRequest): Promise<ReassignUnstartedTaskResponse> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/deactivated-assignee-reassignment`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(reassignUnstartedTaskRequestSchema.parse(input)),
      });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return reassignUnstartedTaskResponseSchema.parse(payload.data);
    },
    async createDeactivatedAssigneeRecovery(taskId: string, input: CreateDeactivatedAssigneeRecoveryRequest): Promise<DeactivatedAssigneeRecoveryResponse> {
      const payload = await request(`/tasks/${encodeURIComponent(taskId)}/deactivated-assignee-recovery`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(createDeactivatedAssigneeRecoveryRequestSchema.parse(input)),
      });
      if (!payload.response.ok) throw toRequestError(payload.response.status, payload.data);
      return deactivatedAssigneeRecoveryResponseSchema.parse(payload.data);
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
    async getEmployeeTaskRecoverySeed(taskId: string, options: { signal?: AbortSignal } = {}): Promise<EmployeeTaskRecoverySeedResponse> {
      const signal = options.signal;
      const response = await fetcher(`${root}/employee/tasks/${encodeURIComponent(taskId)}/recovery-seed`, {
        method: "GET", headers: { accept: "application/json", ...sessionHeaders() }, ...(signal ? { signal } : {}), cache: "no-store",
      });
      let data: unknown;
      try { data = await response.json(); }
      catch (error) { if (signal?.aborted) throw error; throw new ApiRequestError("The API response could not be read.", response.status, "UNEXPECTED_API_RESPONSE"); }
      if (response.status === 200) {
        const parsed = employeeTaskRecoverySeedResponseSchema.safeParse(data);
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
