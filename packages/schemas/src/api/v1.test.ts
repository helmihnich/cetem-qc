import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { apiV1Components, apiV1Operations } from "@cetem-qc/types";
import { acceptedEvidenceResponseSchema, insightDecisionRequestSchema, insightDecisionResponseSchema, manualInsightRequestSchema, manualInsightResponseSchema, apiErrorSchema, createEmployeeRequestSchema, createTaskRequestSchema, employeeCredentialResponseSchema, employeeListResponseSchema, employeeTaskListQuerySchema, employeeTaskListResponseSchema, employeeTaskAuditVersionSchema, employeeTaskResponseSchema, graphieDraftPayloadSchema, healthQuerySchema, healthResponseSchema, replacementTaskResponseSchema, syncOperationAcceptedSchema, syncOperationConflictSchema, syncOperationRejectedSchema, syncOperationRequestSchema, taskListQuerySchema, taskListResponseSchema, updateEmployeeStatusRequestSchema, updateEmployeeStatusResponseSchema } from "./v1.js";

const contractPath = fileURLToPath(new URL("../../../types/openapi/cetem-qc-v1.yaml", import.meta.url));

test("generated OpenAPI health types and runtime schemas share the wire semantics", async () => {
  type Query = apiV1Operations["getHealth"]["parameters"]["query"];
  type Response = apiV1Components["schemas"]["HealthResponse"];
  type ApiError = apiV1Components["schemas"]["ApiError"];
  const query: Query = { verbose: "true" };
  const response: Response = { status: "ok", version: "v1" };
  const apiError: ApiError = { error: { code: "VALIDATION_ERROR", message: "Invalid request", details: [{ path: "verbose", message: "Invalid value" }] } };

  assert.deepEqual(healthQuerySchema.parse(query), query);
  assert.deepEqual(healthResponseSchema.parse(response), response);
  assert.deepEqual(apiErrorSchema.parse(apiError), apiError);
  assert.equal(healthQuerySchema.safeParse({ verbose: true }).success, false);
  assert.equal(healthResponseSchema.safeParse({ status: "ok" }).success, false);
  assert.equal(apiErrorSchema.safeParse({ error: { code: "E", message: "M" } }).success, true);
  assert.equal(apiErrorSchema.safeParse({ error: { code: "E" } }).success, false);
  assert.equal(apiErrorSchema.safeParse({ error: { code: "E", message: "M", details: [{ path: "x" }] } }).success, false);
});

test("employee response schema is data-minimized and accepts the empty state", () => {
  assert.deepEqual(employeeListResponseSchema.parse({ employees: [{ id: "00000000-0000-4000-8000-000000000001", firstName: "Amel", surname: "Ben Ali", email: "amel@example.com", active: true }] }), {
    employees: [{ id: "00000000-0000-4000-8000-000000000001", firstName: "Amel", surname: "Ben Ali", email: "amel@example.com", active: true }],
  });
  assert.deepEqual(employeeListResponseSchema.parse({ employees: [] }), { employees: [] });
  assert.equal(employeeListResponseSchema.safeParse({ employees: [{ id: "00000000-0000-4000-8000-000000000001", firstName: "Amel", surname: "Ben Ali", email: "amel@example.com", active: true, passwordHash: "secret" }] }).success, false);
});

test("employee creation and one-time credential schemas enforce the OpenAPI contract", () => {
  assert.deepEqual(createEmployeeRequestSchema.parse({ firstName: "Nour", surname: "Ali", email: "nour@example.com" }), { firstName: "Nour", surname: "Ali", email: "nour@example.com" });
  assert.equal(createEmployeeRequestSchema.safeParse({ firstName: "", surname: "Ali", email: "nope" }).success, false);
  assert.equal(createEmployeeRequestSchema.safeParse({ firstName: "Nour", surname: "Ali", email: "nour@example.com", teamId: "other" }).success, false);
  assert.equal(employeeCredentialResponseSchema.safeParse({ employee: { id: "00000000-0000-4000-8000-000000000001", firstName: "Nour", surname: "Ali", email: "nour@example.com", active: true }, temporaryCredential: "one-time" }).success, true);
  assert.equal(employeeCredentialResponseSchema.safeParse({ employee: { id: "00000000-0000-4000-8000-000000000001", firstName: "Nour", surname: "Ali", email: "nour@example.com", active: true }, temporaryCredential: "one-time", passwordHash: "persisted-secret" }).success, false);
});

test("employee status schemas enforce the OpenAPI contract and reject extra ownership fields", () => {
  const employee = { id: "00000000-0000-4000-8000-000000000001", firstName: "Nour", surname: "Ali", email: "nour@example.com", active: false };
  const request: apiV1Operations["updateOwnTeamEmployeeStatus"]["requestBody"]["content"]["application/json"] = { active: false };
  const response: apiV1Operations["updateOwnTeamEmployeeStatus"]["responses"][200]["content"]["application/json"] = { employee };
  assert.deepEqual(updateEmployeeStatusRequestSchema.parse(request), request);
  assert.deepEqual(updateEmployeeStatusResponseSchema.parse(response), response);
  assert.equal(updateEmployeeStatusRequestSchema.safeParse({ active: false, teamId: "another-team" }).success, false);
  assert.equal(updateEmployeeStatusRequestSchema.safeParse({ active: "false" }).success, false);
});

test("task list schema exposes only the authorized fields and rejects scope parameters", async () => {
  const item: apiV1Components["schemas"]["TaskListItem"] = {
    id: "00000000-0000-4000-8000-000000000010",
    type: "graphie_mobile",
    establishment: "Centre de contrôle",
    assignee: "Amel Ben Ali",
    assigneeActive: true,
    assignmentVersion: 1,
    assignmentHistory: [],
    recoveryState: null,
    recoveryRevision: null,
    recoverySource: null,
    recoverySuccessorTaskId: null,
    state: "draft",
    lastUpdatedAt: "2026-09-28T10:00:00.000Z",
    replacementOf: null,
    replacedBy: null,
  };
  const response: apiV1Operations["listOwnTeamTasks"]["responses"][200]["content"]["application/json"] = { tasks: [item] };
  assert.deepEqual(taskListQuerySchema.parse({}), {});
  assert.equal(taskListQuerySchema.safeParse({ teamId: "other-team" }).success, false);
  assert.deepEqual(taskListResponseSchema.parse(response), response);
  assert.deepEqual(taskListResponseSchema.parse({ tasks: [] }), { tasks: [] });
  assert.equal(taskListResponseSchema.safeParse({ tasks: [{ ...item, service: "unrequested" }] }).success, false);

  const openapi = await readFile(path.resolve(contractPath), "utf8");
  assert.match(openapi, /listOwnTeamTasks[\s\S]*?TaskListResponse/);
  assert.match(openapi, /TaskListItem:[\s\S]*?required: \[id, type, establishment, assignee, assigneeActive, assignmentVersion, assignmentHistory, recoveryState, recoveryRevision, recoverySource, recoverySuccessorTaskId, state, lastUpdatedAt, replacementOf, replacedBy\]/);
});

test("K5 the task list carries the accepted state and both lineage fields; the replacement 201 body is strict", async () => {
  const original = "00000000-0000-4000-8000-000000000010";
  const replacement = "00000000-0000-4000-8000-000000000011";
  const item: apiV1Components["schemas"]["TaskListItem"] = {
    id: original, type: "graphie_mobile", establishment: "Centre de contrôle", assignee: "Employé Test",
    assigneeActive: false, assignmentVersion: 1, assignmentHistory: [], recoveryState: "accepted", recoveryRevision: 1,
    recoverySource: null, recoverySuccessorTaskId: null,
    state: "submitted", lastUpdatedAt: "2026-09-28T10:00:00.000Z", replacementOf: null, replacedBy: replacement,
  };
  const replacementItem: apiV1Components["schemas"]["TaskListItem"] = { ...item, id: replacement, state: "draft", replacementOf: original, replacedBy: null };
  assert.deepEqual(taskListResponseSchema.parse({ tasks: [item, replacementItem] }), { tasks: [item, replacementItem] });
  for (const state of ["accepted", "rejected", "", null]) {
    assert.equal(taskListResponseSchema.safeParse({ tasks: [{ ...item, state }] }).success, false, String(state));
  }
  for (const field of ["replacementOf", "replacedBy"] as const) {
    const missing: Record<string, unknown> = { ...item };
    delete missing[field];
    assert.equal(taskListResponseSchema.safeParse({ tasks: [missing] }).success, false, `${field} is required`);
    for (const value of ["tache-1", 3, ""]) {
      assert.equal(taskListResponseSchema.safeParse({ tasks: [{ ...item, [field]: value }] }).success, false, `${field} ${String(value)}`);
    }
  }
  assert.equal(taskListResponseSchema.safeParse({ tasks: [{ ...item, replacementAuditId: original }] }).success, false);

  const body: apiV1Operations["createReplacementControl"]["responses"][201]["content"]["application/json"] = {
    task: {
      id: replacement, establishment: "Centre de contrôle", service: "Radiologie", type: "graphie_mobile",
      assigneeId: "00000000-0000-4000-8000-000000000002", creatorId: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-10-05T10:00:00.000Z", state: "draft",
    },
    replacementOf: { taskId: original, auditId: "00000000-0000-4000-8000-000000000020" },
  };
  assert.deepEqual(replacementTaskResponseSchema.parse(body), body);
  assert.equal(replacementTaskResponseSchema.safeParse({ ...body, extra: true }).success, false);
  assert.equal(replacementTaskResponseSchema.safeParse({ ...body, replacementOf: { taskId: original } }).success, false);
  assert.equal(replacementTaskResponseSchema.safeParse({ ...body, replacementOf: { ...body.replacementOf, revision: 2 } }).success, false);
  assert.equal(replacementTaskResponseSchema.safeParse({ ...body, task: { ...body.task, state: "submitted" } }).success, false);

  const openapi = await readFile(path.resolve(contractPath), "utf8");
  assert.match(openapi, /\/tasks\/\{taskId\}\/replacements:[\s\S]*?operationId: createReplacementControl[\s\S]*?CreateTaskRequest[\s\S]*?ReplacementTaskResponse/);
});

test("employee task contracts are strict and reject unsupported list scope", async () => {
  const task: apiV1Components["schemas"]["EmployeeTaskListItem"] = {
    id: "00000000-0000-4000-8000-000000000010",
    type: "graphie_mobile",
    establishment: "Centre attribué",
    service: "Radiologie",
    state: "draft",
    createdAt: "2026-09-28T10:00:00.000Z",
  };
  const response: apiV1Operations["listAssignedEmployeeTasks"]["responses"][200]["content"]["application/json"] = { tasks: [task] };
  const detail: apiV1Operations["getAssignedEmployeeTask"]["responses"][200]["content"]["application/json"] = { task };
  assert.deepEqual(employeeTaskListQuerySchema.parse({}), {});
  assert.equal(employeeTaskListQuerySchema.safeParse({ teamId: "other-team" }).success, false);
  assert.deepEqual(employeeTaskListResponseSchema.parse(response), response);
  assert.deepEqual(employeeTaskResponseSchema.parse(detail), detail);
  assert.deepEqual(employeeTaskListResponseSchema.parse({ tasks: [] }), { tasks: [] });
  assert.equal(employeeTaskResponseSchema.safeParse({ task: { ...task, employeeId: "another-employee" } }).success, false);

  const openapi = await readFile(path.resolve(contractPath), "utf8");
  assert.match(openapi, /listAssignedEmployeeTasks[\s\S]*?EmployeeTaskListResponse/);
  assert.match(openapi, /getAssignedEmployeeTask[\s\S]*?EmployeeTaskResponse/);
});

test("OpenAPI declares string query enum and required response fields", async () => {
  const openapi = await readFile(path.resolve(contractPath), "utf8");
  assert.match(openapi, /type: string\s+enum: \["true", "false"\]/);
  assert.match(openapi, /required: \[status, version\]/);
  assert.match(openapi, /required: \[error\][\s\S]*required: \[code, message\][\s\S]*details:[\s\S]*required: \[path, message\]/);
});

test("session 500 responses reference the shared API error schema", async () => {
  type GetError = apiV1Operations["getCurrentSession"]["responses"][500];
  type DeleteError = apiV1Operations["logoutCurrentSession"]["responses"][500];
  const apiError: apiV1Components["schemas"]["ApiError"] = {
    error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." },
  };
  const getError: GetError["content"]["application/json"] = apiError;
  const deleteError: DeleteError["content"]["application/json"] = apiError;
  assert.deepEqual(apiErrorSchema.parse(getError), apiError);
  assert.deepEqual(apiErrorSchema.parse(deleteError), apiError);

  const openapi = await readFile(path.resolve(contractPath), "utf8");
  assert.match(openapi, /getCurrentSession[\s\S]*?'500':[\s\S]*?\$ref: '#\/components\/schemas\/ApiError'/);
  assert.match(openapi, /logoutCurrentSession[\s\S]*?'500':[\s\S]*?\$ref: '#\/components\/schemas\/ApiError'/);
});

test("task creation rejects NUL characters and blank establishments, and trims the establishment", () => {
  const request = { establishment: "Centre", service: "Radiologie", type: "graphie_mobile", assigneeId: "00000000-0000-4000-8000-000000000010" } as const;
  assert.equal(createTaskRequestSchema.safeParse({ ...request, establishment: "Cen\u0000tre" }).success, false);
  assert.equal(createTaskRequestSchema.safeParse({ ...request, service: "Radio\u0000logie" }).success, false);
  assert.equal(createTaskRequestSchema.safeParse({ ...request, establishment: " 	 " }).success, false);
  assert.equal(createTaskRequestSchema.parse({ ...request, establishment: " Centre " }).establishment, "Centre");
  assert.equal(createTaskRequestSchema.safeParse({ ...request, service: "" }).success, true);
});

test("OpenAPI task creation patterns match the runtime NUL and blank-establishment rules", async () => {
  const openapi = await readFile(path.resolve(contractPath), "utf8");
  const block = openapi.match(/CreateTaskRequest:[\s\S]*?assigneeId:/)?.[0] ?? "";
  const establishmentPattern = block.match(/establishment:[\s\S]*?pattern: '([^']+)'/)?.[1];
  const servicePattern = block.match(/service:[\s\S]*?pattern: '([^']+)'/)?.[1];
  assert.ok(establishmentPattern && servicePattern, "CreateTaskRequest declares establishment and service patterns");
  const establishment = new RegExp(establishmentPattern);
  const service = new RegExp(servicePattern);
  assert.equal(establishment.test(" Centre "), true);
  assert.equal(establishment.test("   "), false);
  assert.equal(establishment.test("Cen\u0000tre"), false);
  assert.equal(service.test(""), true);
  assert.equal(service.test("Radio\u0000logie"), false);
});

test("C1 the sync operation envelope is strict about keys, identifiers and revisions", () => {
  const valid = {
    operationId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "00000000-0000-4000-8000-000000000002",
    baseRevision: 0,
    localDraftRevision: 1,
    clientSavedAt: "2026-10-04T10:00:00.000Z",
    payload: { content: "any object reaches the domain validator" },
  };
  assert.deepEqual(syncOperationRequestSchema.parse(valid), valid);
  const { payload: _payload, ...withoutPayload } = valid;
  for (const invalid of [
    withoutPayload,
    { ...valid, employeeId: "00000000-0000-4000-8000-000000000003" },
    { ...valid, operationId: "op-1" },
    { ...valid, idempotencyKey: "key-1" },
    { ...valid, baseRevision: -1 },
    { ...valid, baseRevision: 1.5 },
    { ...valid, localDraftRevision: 0 },
    { ...valid, clientSavedAt: "hier" },
    { ...valid, payload: [] },
    { ...valid, payload: null },
    { ...valid, payload: "text" },
  ]) assert.equal(syncOperationRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("C2 the three outcome schemas parse the documented bodies and reject extra keys", () => {
  const operationId = "00000000-0000-4000-8000-000000000001";
  const actor = { id: "00000000-0000-4000-8000-000000000009", displayName: "Employé Test" };
  const accepted = { outcome: "accepted", operationId, kind: "submit", serverRevision: 1, acceptedAt: "2026-10-04T10:00:00.000Z", acceptedBy: actor, submissionId: "00000000-0000-4000-8000-000000000005" } as const;
  const { submissionId: _submissionId, ...acceptedDraft } = { ...accepted, kind: "sync-draft" as const };
  const conflict = { outcome: "conflict", operationId, kind: "sync-draft", serverRevision: 2, current: { revision: 2, state: "draft", lastChangedAt: "2026-10-04T10:00:00.000Z", lastChangedBy: actor } } as const;
  const conflictWithoutAudit = { ...conflict, serverRevision: 0, current: { revision: 0, state: "draft", lastChangedAt: null, lastChangedBy: null } } as const;
  const rejected = { outcome: "rejected", operationId, kind: "submit", code: "INVALID_PAYLOAD", message: "Les données du contrôle sont invalides.", issues: [{ path: "values.visual.integrity", code: "unknown-option" }] } as const;
  assert.deepEqual(syncOperationAcceptedSchema.parse(accepted), accepted);
  assert.deepEqual(syncOperationAcceptedSchema.parse(acceptedDraft), acceptedDraft);
  assert.deepEqual(syncOperationConflictSchema.parse(conflict), conflict);
  assert.deepEqual(syncOperationConflictSchema.parse(conflictWithoutAudit), conflictWithoutAudit);
  assert.deepEqual(syncOperationRejectedSchema.parse(rejected), rejected);
  assert.equal(syncOperationAcceptedSchema.safeParse({ ...accepted, results: [] }).success, false);
  assert.equal(syncOperationAcceptedSchema.safeParse({ ...accepted, outcome: "rejected" }).success, false);
  assert.equal(syncOperationAcceptedSchema.safeParse({ ...accepted, serverRevision: 0 }).success, false);
  assert.equal(syncOperationConflictSchema.safeParse({ ...conflict, current: { ...conflict.current, payload: {} } }).success, false);
  assert.equal(syncOperationRejectedSchema.safeParse({ ...rejected, values: {} }).success, false);
  assert.equal(syncOperationRejectedSchema.safeParse({ ...rejected, code: "SOMETHING_ELSE" }).success, false);
});

test("the documented Graphie payload schema matches the catalogue 2.0.0 identity", () => {
  const payload = { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0", values: { "header.reportNumber": "" } } as const;
  assert.deepEqual(graphieDraftPayloadSchema.parse(payload), payload);
  assert.equal(graphieDraftPayloadSchema.safeParse({ ...payload, ruleVersion: "1.0.0" }).success, false);
  assert.equal(graphieDraftPayloadSchema.safeParse({ ...payload, values: { a: 1 } }).success, false);
});

test("K3 the envelope accepts an optional UUID correction reference and the rejection accepts INVALID_CORRECTION_REFERENCE", () => {
  const valid = {
    operationId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "00000000-0000-4000-8000-000000000002",
    baseRevision: 1,
    localDraftRevision: 2,
    clientSavedAt: "2026-10-04T10:00:00.000Z",
    payload: {},
  };
  const withReference = { ...valid, correctionOfOperationId: "00000000-0000-4000-8000-000000000004" };
  assert.deepEqual(syncOperationRequestSchema.parse(withReference), withReference);
  const both = { ...withReference, conflictOperationId: "00000000-0000-4000-8000-000000000003" };
  assert.deepEqual(syncOperationRequestSchema.parse(both), both);
  assert.equal("correctionOfOperationId" in syncOperationRequestSchema.parse(valid), false);
  for (const correctionOfOperationId of ["correction-1", null, 3, ""]) {
    assert.equal(syncOperationRequestSchema.safeParse({ ...valid, correctionOfOperationId }).success, false, String(correctionOfOperationId));
  }
  const rejected = { outcome: "rejected", operationId: valid.operationId, kind: "submit", code: "INVALID_CORRECTION_REFERENCE", message: "La référence de la soumission corrigée est invalide.", issues: [{ path: "correctionOfOperationId", code: "invalid-reference" }] } as const;
  assert.deepEqual(syncOperationRejectedSchema.parse(rejected), rejected);
  assert.equal(syncOperationRejectedSchema.safeParse({ ...rejected, code: "INVALID_REFERENCE" }).success, false);
});

test("K1 the envelope accepts an optional UUID conflict reference and the audit version body is strict", () => {
  const valid = {
    operationId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "00000000-0000-4000-8000-000000000002",
    baseRevision: 1,
    localDraftRevision: 2,
    clientSavedAt: "2026-10-04T10:00:00.000Z",
    payload: {},
  };
  const withReference = { ...valid, conflictOperationId: "00000000-0000-4000-8000-000000000003" };
  assert.deepEqual(syncOperationRequestSchema.parse(withReference), withReference);
  assert.equal("conflictOperationId" in syncOperationRequestSchema.parse(valid), false);
  for (const conflictOperationId of ["conflit-1", null, 3, ""]) {
    assert.equal(syncOperationRequestSchema.safeParse({ ...valid, conflictOperationId }).success, false, String(conflictOperationId));
  }
  const rejected = { outcome: "rejected", operationId: valid.operationId, kind: "sync-draft", code: "INVALID_CONFLICT_REFERENCE", message: "La référence du conflit de synchronisation est invalide.", issues: [{ path: "conflictOperationId", code: "invalid-reference" }] } as const;
  assert.deepEqual(syncOperationRejectedSchema.parse(rejected), rejected);

  const noAudit = { revision: 0, state: "draft", lastChangedAt: null, lastChangedBy: null, payload: null } as const;
  assert.deepEqual(employeeTaskAuditVersionSchema.parse(noAudit), noAudit);
  const full = {
    revision: 2, state: "submitted", lastChangedAt: "2026-10-04T10:00:00.000Z",
    lastChangedBy: { id: "00000000-0000-4000-8000-000000000009", displayName: "Employé Test" },
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0", values: { "header.reportNumber": "R-001" } },
  } as const;
  assert.deepEqual(employeeTaskAuditVersionSchema.parse(full), full);
  for (const invalid of [
    { ...full, extra: true },
    { ...full, lastChangedBy: { ...full.lastChangedBy, email: "employe@example.test" } },
    { ...full, payload: { ...full.payload, extra: 1 } },
    { ...full, state: "rejected" },
    { ...full, revision: -1 },
    { revision: 0, state: "draft", lastChangedAt: null, lastChangedBy: null },
  ]) assert.equal(employeeTaskAuditVersionSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("K7 accepted evidence response schema parses a full body and refuses extras, a missing lineage and a non-ISO date", () => {
  const id = "00000000-0000-4000-8000-000000000040";
  const result = { test: "voltage-accuracy", status: "x" };
  const body = {
    task: { id, establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test" },
    submission: { submissionId: id, auditId: id, revision: 2, submittedBy: { id, displayName: "Employé Test" }, acceptedAt: "2026-10-07T08:00:00.000Z" },
    identity: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" },
    values: { "header.reportNumber": " R-001\n" },
    results: { voltageAccuracy: result, voltageRepeatability: result, outputRepeatability: result, outputLinearity: result, lightFieldCorrespondence: result },
    lineage: { replacementOf: null, replacedBy: null, recoverySource: null, recoverySuccessorTaskId: null },
    insights: { status: "unavailable", reason: "no-approved-rules", registryVersion: "insight-registry-1", proposals: [] },
    insightDecisions: [],
    manualInsights: [],
  };
  assert.deepEqual(acceptedEvidenceResponseSchema.parse(body), body);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, extra: true }).success, false);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, task: { ...body.task, extra: 1 } }).success, false);
  const { lineage: _lineage, ...withoutLineage } = body;
  assert.equal(acceptedEvidenceResponseSchema.safeParse(withoutLineage).success, false);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, submission: { ...body.submission, acceptedAt: "07/10/2026" } }).success, false);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, results: { voltageAccuracy: result } }).success, false);
});

test("K9 accepted evidence insights are required, parse both statuses and refuse extras, missing provenance and inconsistent unavailable sets", () => {
  const id = "00000000-0000-4000-8000-000000000040";
  const result = { test: "voltage-accuracy", status: "x" };
  const proposal = {
    proposalId: `rule-a:v1:${id}:field=header.reportNumber`, ruleId: "rule-a", ruleVersion: 1, approvalReference: "Document synthétique 2026",
    registryVersion: "insight-registry-1", submissionId: id, sourceKeys: [{ kind: "field", key: "header.reportNumber" }],
    statement: "Observation synthétique.", origin: "deterministic",
  } as const;
  const body = {
    task: { id, establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test" },
    submission: { submissionId: id, auditId: id, revision: 2, submittedBy: { id, displayName: "Employé Test" }, acceptedAt: "2026-10-07T08:00:00.000Z" },
    identity: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" },
    values: {},
    results: { voltageAccuracy: result, voltageRepeatability: result, outputRepeatability: result, outputLinearity: result, lightFieldCorrespondence: result },
    lineage: { replacementOf: null, replacedBy: null, recoverySource: null, recoverySuccessorTaskId: null },
    insights: { status: "available", registryVersion: "insight-registry-1", proposals: [proposal] },
    insightDecisions: [],
    manualInsights: [],
  };
  assert.deepEqual(acceptedEvidenceResponseSchema.parse(body), body);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, insights: { ...body.insights, proposals: [] } }).success, true);
  const { insights: _insights, ...withoutInsights } = body;
  const { approvalReference: _approval, ...withoutApproval } = proposal;
  for (const insights of [
    undefined,
    { ...body.insights, extra: 1 },
    { ...body.insights, proposals: [{ ...proposal, extra: 1 }] },
    { ...body.insights, proposals: [withoutApproval] },
    { ...body.insights, proposals: [{ ...proposal, origin: "ai" }] },
    { status: "unavailable", reason: "no-approved-rules", registryVersion: "insight-registry-1", proposals: [proposal] },
    { status: "unavailable", reason: "other", registryVersion: "insight-registry-1", proposals: [] },
  ]) assert.equal(acceptedEvidenceResponseSchema.safeParse(insights === undefined ? withoutInsights : { ...body, insights }).success, false, JSON.stringify(insights));
});

test("K11 insightDecisions is required, parses empty and populated, and refuses extras and an invalid decision; the request schema is strict", () => {
  const id = "00000000-0000-4000-8000-000000000040";
  const result = { test: "voltage-accuracy" };
  const decision = {
    proposalId: "rule-a:v1:x", decision: "retained", decidedAt: "2026-10-08T09:00:00.000Z", decidedBy: { id, displayName: "Responsable Test" },
    registryVersion: "insight-registry-1", ruleId: "rule-a", ruleVersion: 1,
  } as const;
  const body = {
    task: { id, establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test" },
    submission: { submissionId: id, auditId: id, revision: 2, submittedBy: { id, displayName: "Employé Test" }, acceptedAt: "2026-10-07T08:00:00.000Z" },
    identity: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" },
    values: {},
    results: { voltageAccuracy: result, voltageRepeatability: result, outputRepeatability: result, outputLinearity: result, lightFieldCorrespondence: result },
    lineage: { replacementOf: null, replacedBy: null, recoverySource: null, recoverySuccessorTaskId: null },
    insights: { status: "unavailable", reason: "no-approved-rules", registryVersion: "insight-registry-1", proposals: [] },
    insightDecisions: [decision],
    manualInsights: [],
  };
  assert.deepEqual(acceptedEvidenceResponseSchema.parse(body), body);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, insightDecisions: [] }).success, true);
  const { insightDecisions: _decisions, ...without } = body;
  assert.equal(acceptedEvidenceResponseSchema.safeParse(without).success, false);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, insightDecisions: [{ ...decision, decision: "approved" }] }).success, false);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, insightDecisions: [{ ...decision, extra: 1 }] }).success, false);
  assert.deepEqual(insightDecisionRequestSchema.parse({ proposalId: "p", decision: "discarded" }), { proposalId: "p", decision: "discarded" });
  for (const invalid of [{ proposalId: "p", decision: "x" }, { proposalId: "", decision: "retained" }, { proposalId: "p", decision: "retained", statement: "fabriqué" }, { decision: "retained" }]) {
    assert.equal(insightDecisionRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
  const { registryVersion: _r, ruleId: _i, ruleVersion: _v, ...response } = decision;
  assert.deepEqual(insightDecisionResponseSchema.parse(response), response);
  assert.equal(insightDecisionResponseSchema.safeParse(decision).success, false);
});

test("K13 manualInsights is required, parses empty and populated, and refuses extras and another source type; the request schema is strict and trims", () => {
  const id = "00000000-0000-4000-8000-000000000040";
  const result = { test: "voltage-accuracy" };
  const insight = { id, text: "Observation", justification: null, sourceType: "manual", createdAt: "2026-10-08T09:00:00.000Z", author: { id, displayName: "Responsable Test" } } as const;
  const body = {
    task: { id, establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test" },
    submission: { submissionId: id, auditId: id, revision: 2, submittedBy: { id, displayName: "Employé Test" }, acceptedAt: "2026-10-07T08:00:00.000Z" },
    identity: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" },
    values: {},
    results: { voltageAccuracy: result, voltageRepeatability: result, outputRepeatability: result, outputLinearity: result, lightFieldCorrespondence: result },
    lineage: { replacementOf: null, replacedBy: null, recoverySource: null, recoverySuccessorTaskId: null },
    insights: { status: "unavailable", reason: "no-approved-rules", registryVersion: "insight-registry-1", proposals: [] },
    insightDecisions: [],
    manualInsights: [insight],
  };
  assert.deepEqual(acceptedEvidenceResponseSchema.parse(body), body);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, manualInsights: [] }).success, true);
  const { manualInsights: _manual, ...without } = body;
  assert.equal(acceptedEvidenceResponseSchema.safeParse(without).success, false);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, manualInsights: [{ ...insight, sourceType: "rule" }] }).success, false);
  assert.equal(acceptedEvidenceResponseSchema.safeParse({ ...body, manualInsights: [{ ...insight, extra: 1 }] }).success, false);
  assert.deepEqual(manualInsightRequestSchema.parse({ text: "  Texte  ", justification: "  Motif " }), { text: "Texte", justification: "Motif" });
  assert.deepEqual(manualInsightRequestSchema.parse({ text: "Texte", justification: "   " }), { text: "Texte" });
  assert.deepEqual(manualInsightRequestSchema.parse({ text: "Texte", justification: null }), { text: "Texte" });
  for (const invalid of [{}, { text: "" }, { text: "   " }, { text: "x".repeat(1001) }, { text: "ok", justification: "y".repeat(1001) }, { text: "ok", authorId: "a" }, { text: "ok", createdAt: "x" }, { text: "ok", sourceType: "manual" }]) {
    assert.equal(manualInsightRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid).slice(0, 40));
  }
  assert.equal(manualInsightRequestSchema.safeParse({ text: "x".repeat(1000), justification: "y".repeat(1000) }).success, true);
  assert.deepEqual(manualInsightResponseSchema.parse(insight), insight);
  assert.equal(manualInsightResponseSchema.safeParse({ ...insight, sourceType: "rule" }).success, false);
});
