import { z } from "zod";
import type { apiV1Components, apiV1Operations } from "@cetem-qc/types";

const healthQuerySchemaBase = z.object({
  verbose: z.enum(["true", "false"]).optional(),
});

type HealthQueryContract = apiV1Operations["getHealth"]["parameters"]["query"];
type HealthResponseContract = apiV1Components["schemas"]["HealthResponse"];
type ApiErrorContract = apiV1Components["schemas"]["ApiError"];
type AuthenticationRequestContract = apiV1Operations["authenticateWithPassword"]["requestBody"]["content"]["application/json"];
type PasswordReplacementRequestContract = apiV1Operations["replaceTemporaryPassword"]["requestBody"]["content"]["application/json"];
type AuthenticationResponseContract = apiV1Operations["authenticateWithPassword"]["responses"][200]["content"]["application/json"];
type SessionResponseContract = apiV1Operations["getCurrentSession"]["responses"][200]["content"]["application/json"];
type EmployeeListResponseContract = apiV1Operations["listOwnTeamEmployees"]["responses"][200]["content"]["application/json"];
type CreateEmployeeRequestContract = apiV1Operations["createOwnTeamEmployee"]["requestBody"]["content"]["application/json"];
type EmployeeCredentialResponseContract = apiV1Operations["createOwnTeamEmployee"]["responses"][201]["content"]["application/json"];
type UpdateEmployeeStatusRequestContract = apiV1Operations["updateOwnTeamEmployeeStatus"]["requestBody"]["content"]["application/json"];
type UpdateEmployeeStatusResponseContract = apiV1Operations["updateOwnTeamEmployeeStatus"]["responses"][200]["content"]["application/json"];
type TaskAssigneeListResponseContract = apiV1Operations["listTaskAssignees"]["responses"][200]["content"]["application/json"];
type TaskListResponseContract = apiV1Operations["listOwnTeamTasks"]["responses"][200]["content"]["application/json"];
type CreateTaskRequestContract = apiV1Operations["createAssignedTask"]["requestBody"]["content"]["application/json"];
type TaskResponseContract = apiV1Operations["createAssignedTask"]["responses"][201]["content"]["application/json"];
type ReplacementTaskResponseContract = apiV1Operations["createReplacementControl"]["responses"][201]["content"]["application/json"];
type ReassignUnstartedTaskRequestContract = apiV1Operations["reassignUnstartedDeactivatedTask"]["requestBody"]["content"]["application/json"];
type ReassignUnstartedTaskResponseContract = apiV1Operations["reassignUnstartedDeactivatedTask"]["responses"][200]["content"]["application/json"];
type CreateDeactivatedAssigneeRecoveryRequestContract = apiV1Operations["createDeactivatedAssigneeRecovery"]["requestBody"]["content"]["application/json"];
type DeactivatedAssigneeRecoveryResponseContract = apiV1Operations["createDeactivatedAssigneeRecovery"]["responses"][201]["content"]["application/json"];
type AcceptedEvidenceResponseContract = apiV1Operations["getAcceptedEvidence"]["responses"][200]["content"]["application/json"];
type InsightDecisionRequestContract = apiV1Operations["recordInsightDecision"]["requestBody"]["content"]["application/json"];
type InsightDecisionResponseContract = apiV1Operations["recordInsightDecision"]["responses"][200]["content"]["application/json"];
type ManualInsightRequestContract = apiV1Operations["addManualInsight"]["requestBody"]["content"]["application/json"];
type ManualInsightContract = apiV1Operations["addManualInsight"]["responses"][201]["content"]["application/json"];
type SummaryDraftRequestContract = apiV1Operations["requestSummaryDraft"]["requestBody"]["content"]["application/json"];
type SummaryDraftResponseContract = apiV1Operations["requestSummaryDraft"]["responses"][201]["content"]["application/json"];
type SummaryConfirmationRequestContract = apiV1Operations["confirmSummary"]["requestBody"]["content"]["application/json"];
type ConfirmedSummaryContract = apiV1Operations["confirmSummary"]["responses"][201]["content"]["application/json"];
type SummaryReopeningRequestContract = apiV1Operations["reopenSummary"]["requestBody"]["content"]["application/json"];
type SummaryReopeningContract = apiV1Operations["reopenSummary"]["responses"][201]["content"]["application/json"];
type SummaryHistoryItemContract = apiV1Components["schemas"]["SummaryHistoryItem"];
type ConformityDecisionRequestContract = apiV1Operations["recordConformityDecision"]["requestBody"]["content"]["application/json"];
type ConformityDecisionContract = apiV1Operations["recordConformityDecision"]["responses"][201]["content"]["application/json"];
type ConformityHistoryItemContract = apiV1Components["schemas"]["ConformityHistoryItem"];
type ReportCandidateRequestContract = apiV1Operations["generateReportCandidate"]["requestBody"]["content"]["application/json"];
type ReportCandidateContract = apiV1Operations["generateReportCandidate"]["responses"][201]["content"]["application/json"];
type ReportFromPdfRequestContract = apiV1Operations["createReportCandidateFromPdf"]["requestBody"]["content"]["application/json"];
type ReportCandidateListContract = apiV1Operations["listReportCandidates"]["responses"][200]["content"]["application/json"];
type StoredFileContract = apiV1Operations["uploadManualPdfFile"]["responses"][201]["content"]["application/json"];
type StoredFileListContract = apiV1Operations["listManualPdfFiles"]["responses"][200]["content"]["application/json"];
type EmployeeTaskListResponseContract =apiV1Operations["listAssignedEmployeeTasks"]["responses"][200]["content"]["application/json"];
type EmployeeTaskResponseContract = apiV1Operations["getAssignedEmployeeTask"]["responses"][200]["content"]["application/json"];

// Keep the runtime parser tied to the generated wire representation.
export const healthQuerySchema: z.ZodType<HealthQueryContract> = healthQuerySchemaBase;

export const healthResponseSchema: z.ZodType<HealthResponseContract> = z.object({
  status: z.literal("ok"),
  version: z.literal("v1"),
});

export const apiErrorSchema: z.ZodType<ApiErrorContract> = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export const authenticationRequestSchema: z.ZodType<AuthenticationRequestContract> = z.object({ email: z.string().min(1), password: z.string().min(1) });
export const passwordReplacementRequestSchema: z.ZodType<PasswordReplacementRequestContract> = z.object({
  currentPassword: z.string().min(1), newPassword: z.string().min(1),
});
const authenticatedUserSchema = z.object({
  id: z.string(), email: z.string(), displayName: z.string(), role: z.enum(["responsable", "employe"]),
  mustChangePassword: z.boolean(),
});
const sessionTokenSchema = z.string().min(1);
export const authenticationResponseSchema: z.ZodType<AuthenticationResponseContract> = z.object({
  token: sessionTokenSchema,
  sessionExpiresAt: z.string().datetime(),
  user: authenticatedUserSchema,
});
export const sessionResponseSchema: z.ZodType<SessionResponseContract> = z.object({
  sessionExpiresAt: z.string().datetime(),
  user: authenticatedUserSchema,
});
const teamEmployeeSchema = z.object({
  id: z.string().uuid(), firstName: z.string(), surname: z.string(), email: z.string().email(), active: z.boolean(),
}).strict();
export const employeeListResponseSchema: z.ZodType<EmployeeListResponseContract> = z.object({
  employees: z.array(teamEmployeeSchema),
}).strict();
export const createEmployeeRequestSchema: z.ZodType<CreateEmployeeRequestContract> = z.object({
  firstName: z.string().trim().min(1).max(100), surname: z.string().trim().min(1).max(100), email: z.string().trim().email().max(254),
}).strict();
export const employeeCredentialResponseSchema: z.ZodType<EmployeeCredentialResponseContract> = z.object({
  employee: teamEmployeeSchema,
  temporaryCredential: z.string().min(1),
}).strict();
export const updateEmployeeStatusRequestSchema: z.ZodType<UpdateEmployeeStatusRequestContract> = z.object({ active: z.boolean() }).strict();
export const updateEmployeeStatusResponseSchema: z.ZodType<UpdateEmployeeStatusResponseContract> = z.object({ employee: teamEmployeeSchema }).strict();
export const taskAssigneeListResponseSchema: z.ZodType<TaskAssigneeListResponseContract> = z.object({
  assignees: z.array(z.object({ id: z.string().uuid(), firstName: z.string(), surname: z.string() }).strict()),
}).strict();
export const taskListQuerySchema = z.object({}).strict();
const taskListItemSchema = z.object({
  id: z.string().uuid(), type: z.literal("graphie_mobile"), establishment: z.string(), assignee: z.string(),
  assigneeActive: z.boolean(), assignmentVersion: z.number().int().positive(),
  assignmentHistory: z.array(z.object({ previousEmployee: z.string().nullable(), newEmployee: z.string(), actor: z.string(), reason: z.string(), createdAt: z.string().datetime() }).strict()),
  recoveryState: z.enum(["unstarted", "synchronized-draft", "correction-draft", "resolution-required", "accepted", "recovered"]).nullable(),
  recoveryRevision: z.number().int().positive().nullable(),
  recoverySource: z.object({ taskId: z.string().uuid(), auditId: z.string().uuid(), revision: z.number().int().positive() }).strict().nullable(),
  recoverySuccessorTaskId: z.string().uuid().nullable(),
  state: z.enum(["draft", "submitted"]), lastUpdatedAt: z.string().datetime(),
  replacementOf: z.string().uuid().nullable(), replacedBy: z.string().uuid().nullable(),
}).strict();
export const taskListResponseSchema: z.ZodType<TaskListResponseContract> = z.object({ tasks: z.array(taskListItemSchema) }).strict();
// PostgreSQL text cannot store NUL; reject it as a validation error instead of a database failure.
const withoutNul = /^[^\u0000]*$/;
export const createTaskRequestSchema: z.ZodType<CreateTaskRequestContract> = z.object({
  establishment: z.string().trim().min(1).max(200).regex(withoutNul), service: z.string().max(200).regex(withoutNul), type: z.literal("graphie_mobile"), assigneeId: z.string().uuid(),
}).strict();
const taskSchema = z.object({
  id: z.string().uuid(), establishment: z.string(), service: z.string(), type: z.literal("graphie_mobile"),
  assigneeId: z.string().uuid(), creatorId: z.string().uuid(), createdAt: z.string().datetime(), state: z.literal("draft"),
}).strict();
export const taskResponseSchema: z.ZodType<TaskResponseContract> = z.object({ task: taskSchema }).strict();
export const replacementTaskResponseSchema: z.ZodType<ReplacementTaskResponseContract> = z.object({
  task: taskSchema,
  replacementOf: z.object({ taskId: z.string().uuid(), auditId: z.string().uuid() }).strict(),
}).strict();
export const reassignUnstartedTaskRequestSchema: z.ZodType<ReassignUnstartedTaskRequestContract> = z.object({
  successorId: z.string().uuid(), expectedAssignmentVersion: z.number().int().positive(),
}).strict();
export const reassignUnstartedTaskResponseSchema: z.ZodType<ReassignUnstartedTaskResponseContract> = z.object({
  taskId: z.string().uuid(), assigneeId: z.string().uuid(), assignmentVersion: z.number().int().positive(),
}).strict();
export const createDeactivatedAssigneeRecoveryRequestSchema: z.ZodType<CreateDeactivatedAssigneeRecoveryRequestContract> = z.object({
  successorId: z.string().uuid(), expectedAssignmentVersion: z.number().int().positive(), sourceRevision: z.number().int().positive(),
}).strict();
export const deactivatedAssigneeRecoveryResponseSchema: z.ZodType<DeactivatedAssigneeRecoveryResponseContract> = z.object({
  task: taskSchema,
  recoveryId: z.string().uuid(), recoveryKind: z.enum(["synchronized-draft", "correction-draft"]),
  source: z.object({ taskId: z.string().uuid(), auditId: z.string().uuid(), revision: z.number().int().positive() }).strict(),
}).strict();
// The calculation snapshot is stored and returned as is; its shape belongs to packages/domain, so each test result stays open here.
const storedTestResultSchema = z.object({}).passthrough();
const nonEmpty = z.string().min(1);
const insightSourceKeySchema = z.object({ kind: z.enum(["field", "result"]), key: nonEmpty }).strict();
const insightProposalSchema = z.object({
  proposalId: nonEmpty, ruleId: nonEmpty, ruleVersion: z.number().int().positive(), approvalReference: nonEmpty,
  registryVersion: nonEmpty, submissionId: z.string().uuid(), sourceKeys: z.array(insightSourceKeySchema).min(1),
  statement: nonEmpty, origin: z.literal("deterministic"),
}).strict();
export const insightProposalSetSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), reason: z.literal("no-approved-rules"), registryVersion: nonEmpty, proposals: z.tuple([]) }).strict(),
  z.object({ status: z.literal("available"), registryVersion: nonEmpty, proposals: z.array(insightProposalSchema) }).strict(),
]);
const insightDecisionValueSchema = z.enum(["retained", "discarded"]);
const insightDecisionFields = {
  proposalId: nonEmpty, decision: insightDecisionValueSchema, decidedAt: z.string().datetime(),
  decidedBy: z.object({ id: z.string(), displayName: z.string() }).strict(),
};
export const insightDecisionRequestSchema: z.ZodType<InsightDecisionRequestContract> = z.object({ proposalId: nonEmpty, decision: insightDecisionValueSchema }).strict();
export const insightDecisionResponseSchema: z.ZodType<InsightDecisionResponseContract> = z.object(insightDecisionFields).strict();
const evidenceInsightDecisionSchema = z.object({
  ...insightDecisionFields, registryVersion: nonEmpty, ruleId: nonEmpty, ruleVersion: z.number().int().positive(),
}).strict();
// Same bounds as MANUAL_INSIGHT_*_MAX in packages/domain (a test keeps them equal) and the migration checks.
const manualInsightTextMax = 1000;
const manualInsightJustificationMax = 1000;
export const manualInsightRequestSchema: z.ZodType<ManualInsightRequestContract> = z.object({
  // A NUL character cannot be stored by PostgreSQL: refuse it as invalid input instead of failing at insert.
  text: z.string().trim().min(1).max(manualInsightTextMax).refine((value) => !value.includes("\u0000")),
  justification: z.string().trim().max(manualInsightJustificationMax).refine((value) => !value.includes("\u0000")).nullish(),
}).strict().transform((body) => (body.justification ? { text: body.text, justification: body.justification } : { text: body.text }));
export const manualInsightSchema: z.ZodType<ManualInsightContract> = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(manualInsightTextMax),
  justification: z.string().min(1).max(manualInsightJustificationMax).nullable(),
  sourceType: z.literal("manual"),
  createdAt: z.string().datetime(),
  author: z.object({ id: z.string(), displayName: z.string() }).strict(),
}).strict();
export const manualInsightResponseSchema = manualInsightSchema;
/** Story 10.1: the request carries nothing; the server supplies every input of the summary draft. */
export const summaryDraftRequestSchema: z.ZodType<SummaryDraftRequestContract> = z.object({}).strict();
export const summaryDraftResponseSchema: z.ZodType<SummaryDraftResponseContract> = z.object({
  id: z.string().uuid(),
  status: z.literal("generated"),
  text: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  requestedAt: z.string().datetime(),
  requestedBy: z.object({ id: z.string(), displayName: z.string() }).strict(),
  summaryInputSetId: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
/** Technical bound shared with the migration check; not a CETEM rule. */
export const SUMMARY_TEXT_MAX = 5000;
export const summaryConfirmationRequestSchema: z.ZodType<SummaryConfirmationRequestContract> = z.object({
  // A NUL character cannot be stored by PostgreSQL: refuse it as invalid input instead of failing at insert.
  text: z.string().trim().min(1).max(SUMMARY_TEXT_MAX).refine((value) => !value.includes(" ")),
  draftId: z.string().uuid().optional(),
}).strict();
const summaryInitialDraftSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  requestedAt: z.string().datetime(),
  summaryInputSetId: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().nullable();
export const confirmedSummarySchema: z.ZodType<ConfirmedSummaryContract> = z.object({
  id: z.string().uuid(),
  version: z.number().int().min(1),
  text: z.string().min(1).max(SUMMARY_TEXT_MAX),
  confirmedAt: z.string().datetime(),
  confirmedBy: z.object({ id: z.string(), displayName: z.string() }).strict(),
  summaryInputSetId: z.string().regex(/^[0-9a-f]{64}$/),
  initialDraft: summaryInitialDraftSchema,
}).strict();
const summaryActorSchema = z.object({ id: z.string(), displayName: z.string() }).strict();
/** Story 10.3: reopening carries nothing; the server supplies actor and date. */
export const summaryReopeningRequestSchema: z.ZodType<SummaryReopeningRequestContract> = z.object({}).strict();
export const summaryReopeningSchema: z.ZodType<SummaryReopeningContract> = z.object({
  version: z.number().int().min(2),
  reopenedAt: z.string().datetime(),
  reopenedBy: summaryActorSchema,
  previous: confirmedSummarySchema,
}).strict();
export const summaryHistoryItemSchema: z.ZodType<SummaryHistoryItemContract> = z.object({
  version: z.number().int().min(1),
  text: z.string().min(1).max(SUMMARY_TEXT_MAX),
  confirmedAt: z.string().datetime(),
  confirmedBy: summaryActorSchema,
  reopenedAt: z.string().datetime(),
  reopenedBy: summaryActorSchema,
  initialDraft: summaryInitialDraftSchema,
}).strict();
/** Story 10.4: the outcome is the only caller-supplied value and has no default. */
export const conformityOutcomeSchema = z.enum(["machine-conforme", "machine-non-conforme"]);
export const conformityDecisionRequestSchema: z.ZodType<ConformityDecisionRequestContract> = z.object({
  outcome: conformityOutcomeSchema,
}).strict();
export const conformityDecisionSchema: z.ZodType<ConformityDecisionContract> = z.object({
  id: z.string().uuid(),
  outcome: conformityOutcomeSchema,
  decidedAt: z.string().datetime(),
  decidedBy: summaryActorSchema,
  summaryId: z.string().uuid(),
  summaryVersion: z.number().int().min(1),
}).strict();
export const conformityHistoryItemSchema: z.ZodType<ConformityHistoryItemContract> = z.object({
  id: z.string().uuid(),
  outcome: conformityOutcomeSchema,
  decidedAt: z.string().datetime(),
  decidedBy: summaryActorSchema,
  summaryId: z.string().uuid(),
  summaryVersion: z.number().int().min(1),
  invalidatedAt: z.string().datetime().nullable(),
}).strict();
/** Story 11.1: a Word report candidate. It is never official: no official property exists. */
export const reportCandidateRequestSchema: z.ZodType<ReportCandidateRequestContract> = z.object({
  attemptId: z.string().uuid(),
}).strict();
export const reportFromPdfRequestSchema: z.ZodType<ReportFromPdfRequestContract> = z.object({
  attemptId: z.string().uuid(),
}).strict();
export const reportCandidateStatusSchema = z.enum(["generating", "ready", "failed", "outdated"]);
export const reportCandidateSchema: z.ZodType<ReportCandidateContract> = z.object({
  id: z.string().uuid(),
  attemptId: z.string().uuid(),
  origin: z.enum(["generated-word", "uploaded-pdf"]),
  status: reportCandidateStatusSchema,
  requestedAt: z.string().datetime(),
  requestedBy: summaryActorSchema,
  bindings: z.object({
    auditRevision: z.number().int().min(1),
    summaryId: z.string().uuid(),
    summaryVersion: z.number().int().min(1),
    conformityDecisionId: z.string().uuid(),
    conformityOutcome: conformityOutcomeSchema,
  }).strict(),
  template: z.object({ id: z.string(), version: z.string() }).strict().nullable(),
  source: z.object({ fileId: z.string().uuid(), scanResult: z.enum(["clean", "not-performed"]) }).strict().nullable(),
  file: z.object({ name: z.string(), byteSize: z.number().int().min(0), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict().nullable(),
  failureClass: z.enum(["generation-failed", "storage-failed"]).nullable(),
}).strict();
export const reportCandidateListSchema: z.ZodType<ReportCandidateListContract> = z.object({
  candidates: z.array(reportCandidateSchema),
}).strict();
/** Story 11.2: a manually prepared PDF with its derived status. It is never official: no storage key or report property exists. */
export const storedFileStatusSchema = z.enum(["rejected", "quarantined", "scan-pending", "scan-failed", "storage-failed", "ready"]);
export const storedFileSchema: z.ZodType<StoredFileContract> = z.object({
  id: z.string().uuid(),
  attemptId: z.string().uuid(),
  status: storedFileStatusSchema,
  fileName: z.string(),
  byteSize: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uploadedAt: z.string().datetime(),
  uploadedBy: summaryActorSchema,
  validation: z.object({ result: z.enum(["passed", "rejected", "quarantined"]), class: z.string().nullable() }).strict(),
  scan: z.object({
    result: z.enum(["clean", "threat", "unavailable", "not-performed", "pending"]),
    scanner: z.enum(["none", "clamav"]).nullable(),
    checkedAt: z.string().datetime().nullable(),
  }).strict(),
}).strict();
export const storedFileListSchema: z.ZodType<StoredFileListContract> = z.object({
  files: z.array(storedFileSchema),
}).strict();
export const acceptedEvidenceResponseSchema: z.ZodType<AcceptedEvidenceResponseContract> = z.object({
  conformityDecision: conformityDecisionSchema.nullable(),
  conformityHistory: z.array(conformityHistoryItemSchema),
  summaryHistory: z.array(summaryHistoryItemSchema),
  summaryVersion: z.object({ number: z.number().int().min(1), state: z.enum(["confirmed", "open"]) }).strict(),
  manualInsights: z.array(manualInsightSchema),
  summary: confirmedSummarySchema.nullable(),
  insights: insightProposalSetSchema,
  insightDecisions: z.array(evidenceInsightDecisionSchema),
  task: z.object({ id: z.string().uuid(), establishment: z.string(), service: z.string(), assignee: z.string() }).strict(),
  submission: z.object({
    submissionId: z.string().uuid(), auditId: z.string().uuid(), revision: z.number().int().positive(),
    submittedBy: z.object({ id: z.string().uuid(), displayName: z.string() }).strict(),
    acceptedAt: z.string().datetime(),
  }).strict(),
  identity: z.object({
    catalogueId: z.string(), catalogueVersion: z.string(), schemaVersion: z.number().int(), ruleId: z.string(), ruleVersion: z.string(),
  }).strict(),
  values: z.record(z.string(), z.string()),
  results: z.object({
    voltageAccuracy: storedTestResultSchema, voltageRepeatability: storedTestResultSchema, outputRepeatability: storedTestResultSchema,
    outputLinearity: storedTestResultSchema, lightFieldCorrespondence: storedTestResultSchema,
  }).strict(),
  lineage: z.object({
    replacementOf: z.string().uuid().nullable(), replacedBy: z.string().uuid().nullable(),
    recoverySource: z.object({ taskId: z.string().uuid(), auditId: z.string().uuid(), revision: z.number().int().positive() }).strict().nullable(),
    recoverySuccessorTaskId: z.string().uuid().nullable(),
  }).strict(),
}).strict();
const employeeTaskSchema = z.object({
  id: z.string().uuid(), type: z.literal("graphie_mobile"), establishment: z.string(), service: z.string(),
  state: z.literal("draft"), createdAt: z.string().datetime(),
}).strict();
export const employeeTaskListQuerySchema = z.object({}).strict();
export const employeeTaskListResponseSchema: z.ZodType<EmployeeTaskListResponseContract> = z.object({ tasks: z.array(employeeTaskSchema) }).strict();
export const employeeTaskResponseSchema: z.ZodType<EmployeeTaskResponseContract> = z.object({ task: employeeTaskSchema }).strict();
export const sessionTokenResponseSchema = z.object({ token: sessionTokenSchema });

type GraphieDraftPayloadContract = apiV1Components["schemas"]["GraphieDraftPayload"];
type SyncOperationRequestContract = apiV1Components["schemas"]["SyncOperationRequest"];
type SyncOperationAcceptedContract = apiV1Components["schemas"]["SyncOperationAccepted"];
type SyncOperationConflictContract = apiV1Components["schemas"]["SyncOperationConflict"];
type SyncOperationRejectedContract = apiV1Components["schemas"]["SyncOperationRejected"];
type EmployeeTaskAuditVersionContract = apiV1Components["schemas"]["EmployeeTaskAuditVersion"];

export const graphieDraftPayloadSchema: z.ZodType<GraphieDraftPayloadContract> = z.object({
  catalogueId: z.literal("graphie-mobile-pov"), catalogueVersion: z.literal("2.0.0"), schemaVersion: z.literal(3),
  ruleId: z.literal("cetem-paper-form"), ruleVersion: z.literal("2.0.0"),
  values: z.record(z.string(), z.string()), legacyContent: z.string().optional(),
}).strict();
const plainObject = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value);
/** The payload is any JSON object here; its content is validated by the domain and refused with a stored 422. */
export const syncOperationRequestSchema: z.ZodType<SyncOperationRequestContract> = z.object({
  operationId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  localDraftRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  clientSavedAt: z.string().datetime({ offset: true }),
  payload: z.custom<Record<string, unknown>>(plainObject),
  conflictOperationId: z.string().uuid().optional(),
  correctionOfOperationId: z.string().uuid().optional(),
}).strict();
const syncOperationKindSchema = z.enum(["sync-draft", "submit"]);
const syncActorSchema = z.object({ id: z.string().uuid(), displayName: z.string() }).strict();
export const syncOperationAcceptedSchema: z.ZodType<SyncOperationAcceptedContract> = z.object({
  outcome: z.literal("accepted"), operationId: z.string().uuid(), kind: syncOperationKindSchema,
  serverRevision: z.number().int().min(1), acceptedAt: z.string().datetime({ offset: true }),
  acceptedBy: syncActorSchema, submissionId: z.string().uuid().optional(),
}).strict();
export const syncOperationConflictSchema: z.ZodType<SyncOperationConflictContract> = z.object({
  outcome: z.literal("conflict"), operationId: z.string().uuid(), kind: syncOperationKindSchema,
  serverRevision: z.number().int().min(0),
  current: z.object({
    revision: z.number().int().min(0), state: z.enum(["draft", "submitted"]),
    lastChangedAt: z.string().datetime({ offset: true }).nullable(), lastChangedBy: syncActorSchema.nullable(),
  }).strict(),
}).strict();
export const syncOperationRejectedSchema: z.ZodType<SyncOperationRejectedContract> = z.object({
  outcome: z.literal("rejected"), operationId: z.string().uuid(), kind: syncOperationKindSchema,
  code: z.enum(["UNSUPPORTED_PAYLOAD", "UNSUPPORTED_PAYLOAD_VERSION", "INVALID_PAYLOAD", "AUDIT_ALREADY_SUBMITTED", "INVALID_CONFLICT_REFERENCE", "INVALID_CORRECTION_REFERENCE"]),
  message: z.string(), issues: z.array(z.object({ path: z.string(), code: z.string() }).strict()),
}).strict();
export const employeeTaskAuditVersionSchema: z.ZodType<EmployeeTaskAuditVersionContract> = z.object({
  revision: z.number().int().min(0), state: z.enum(["draft", "submitted"]),
  lastChangedAt: z.string().datetime({ offset: true }).nullable(), lastChangedBy: syncActorSchema.nullable(),
  payload: graphieDraftPayloadSchema.nullable(),
}).strict();
export const employeeTaskRecoverySeedSchema = z.object({
  recoveryId: z.string().uuid(),
  source: z.object({ taskId: z.string().uuid(), auditId: z.string().uuid(), revision: z.number().int().positive(), employee: syncActorSchema }).strict(),
  seed: z.object({ revision: z.number().int().positive(), payload: graphieDraftPayloadSchema }).strict(),
  provenance: z.array(z.object({ destinationField: z.string(), sourceField: z.string(), sourceTaskId: z.string().uuid(), sourceAuditId: z.string().uuid(), sourceRevision: z.number().int().positive(), origin: z.literal("copied-from-recovery-source") }).strict()),
}).strict();
export const employeeTaskRecoverySeedResponseSchema = z.object({ recovery: employeeTaskRecoverySeedSchema.nullable() }).strict();
export type GraphieDraftPayload = z.infer<typeof graphieDraftPayloadSchema>;
export type SyncOperationRequest = z.infer<typeof syncOperationRequestSchema>;
export type SyncOperationAccepted = z.infer<typeof syncOperationAcceptedSchema>;
export type SyncOperationConflict = z.infer<typeof syncOperationConflictSchema>;
export type SyncOperationRejected = z.infer<typeof syncOperationRejectedSchema>;
export type EmployeeTaskAuditVersion = z.infer<typeof employeeTaskAuditVersionSchema>;
export type EmployeeTaskRecoverySeed = z.infer<typeof employeeTaskRecoverySeedSchema>;
export type EmployeeTaskRecoverySeedResponse = z.infer<typeof employeeTaskRecoverySeedResponseSchema>;
export type HealthQuery = z.infer<typeof healthQuerySchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type AuthenticationRequest = z.infer<typeof authenticationRequestSchema>;
export type PasswordReplacementRequest = z.infer<typeof passwordReplacementRequestSchema>;
export type AuthenticationResponse = z.infer<typeof authenticationResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type EmployeeListResponse = z.infer<typeof employeeListResponseSchema>;
export type CreateEmployeeRequest = z.infer<typeof createEmployeeRequestSchema>;
export type EmployeeCredentialResponse = z.infer<typeof employeeCredentialResponseSchema>;
export type UpdateEmployeeStatusRequest = z.infer<typeof updateEmployeeStatusRequestSchema>;
export type UpdateEmployeeStatusResponse = z.infer<typeof updateEmployeeStatusResponseSchema>;
export type TaskAssigneeListResponse = z.infer<typeof taskAssigneeListResponseSchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type ReplacementTaskResponse = z.infer<typeof replacementTaskResponseSchema>;
export type ReassignUnstartedTaskRequest = z.infer<typeof reassignUnstartedTaskRequestSchema>;
export type ReassignUnstartedTaskResponse = z.infer<typeof reassignUnstartedTaskResponseSchema>;
export type CreateDeactivatedAssigneeRecoveryRequest = z.infer<typeof createDeactivatedAssigneeRecoveryRequestSchema>;
export type DeactivatedAssigneeRecoveryResponse = z.infer<typeof deactivatedAssigneeRecoveryResponseSchema>;
export type AcceptedEvidenceResponse = z.infer<typeof acceptedEvidenceResponseSchema>;
export type InsightDecisionRequest = z.infer<typeof insightDecisionRequestSchema>;
export type InsightDecisionResponse = z.infer<typeof insightDecisionResponseSchema>;
export type ManualInsightRequest = z.infer<typeof manualInsightRequestSchema>;
export type ManualInsightResponse = z.infer<typeof manualInsightResponseSchema>;
export type SummaryConfirmationRequest = z.infer<typeof summaryConfirmationRequestSchema>;
export type ConfirmedSummary = z.infer<typeof confirmedSummarySchema>;
export type SummaryReopeningRequest = z.infer<typeof summaryReopeningRequestSchema>;
export type SummaryReopening = z.infer<typeof summaryReopeningSchema>;
export type SummaryHistoryItem = z.infer<typeof summaryHistoryItemSchema>;
export type ConformityOutcome = z.infer<typeof conformityOutcomeSchema>;
export type ConformityDecisionRequest = z.infer<typeof conformityDecisionRequestSchema>;
export type ConformityDecision = z.infer<typeof conformityDecisionSchema>;
export type ConformityHistoryItem = z.infer<typeof conformityHistoryItemSchema>;
export type ReportCandidateRequest = z.infer<typeof reportCandidateRequestSchema>;
export type ReportFromPdfRequest = z.infer<typeof reportFromPdfRequestSchema>;
export type ReportCandidateStatus = z.infer<typeof reportCandidateStatusSchema>;
export type ReportCandidate = z.infer<typeof reportCandidateSchema>;
export type ReportCandidateList = z.infer<typeof reportCandidateListSchema>;
export type StoredFileStatus = z.infer<typeof storedFileStatusSchema>;
export type StoredFile = z.infer<typeof storedFileSchema>;
export type StoredFileList = z.infer<typeof storedFileListSchema>;
export type SummaryDraftRequest = z.infer<typeof summaryDraftRequestSchema>;
export type SummaryDraftResponse = z.infer<typeof summaryDraftResponseSchema>;
export type EmployeeTaskListResponse = z.infer<typeof employeeTaskListResponseSchema>;
export type EmployeeTaskResponse = z.infer<typeof employeeTaskResponseSchema>;
export type SessionTokenResponse = z.infer<typeof sessionTokenResponseSchema>;
