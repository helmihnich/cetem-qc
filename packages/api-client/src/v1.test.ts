import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, createApiClient } from "./v1.js";

const baseUrl = "https://cetem-qc.example.test/";
const token = "employee-session-token";
const taskId = "00000000-0000-4000-8000-000000000010";
const task = {
  id: taskId,
  type: "graphie_mobile",
  establishment: "Centre A",
  service: "Radiologie",
  state: "draft",
  createdAt: "2026-09-29T10:00:00.000Z",
};

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function clientFor(payload: unknown, status = 200) {
  const calls: FetchCall[] = [];
  const client = createApiClient({
    baseUrl,
    sessionToken: token,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
      } as Response;
    },
  });
  return { client, calls };
}

test("assigned task list uses the versioned GET endpoint, bearer session, and parses the contract", async () => {
  const expected = { tasks: [task] };
  const { client, calls } = clientFor(expected);

  assert.deepEqual(await client.listAssignedEmployeeTasks(), expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://cetem-qc.example.test/api/v1/employee/tasks");
  assert.equal(calls[0]!.init?.method, "GET");
  assert.deepEqual(calls[0]!.init?.headers, {
    accept: "application/json",
    authorization: `Bearer ${token}`,
  });
  assert.equal(calls[0]!.init?.body, undefined);
});

test("assigned task list turns a contract-shaped API error into ApiRequestError", async () => {
  const { client, calls } = clientFor({
    error: { code: "INTERNAL_ERROR", message: "La liste des tâches n'a pas pu être chargée." },
  }, 500);

  await assert.rejects(client.listAssignedEmployeeTasks(), (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 500);
    assert.equal(error.code, "INTERNAL_ERROR");
    assert.equal(error.message, "La liste des tâches n'a pas pu être chargée.");
    return true;
  });
  assert.equal(calls[0]!.url, "https://cetem-qc.example.test/api/v1/employee/tasks");
});

test("assigned task detail encodes the requested ID and parses the read-only contract", async () => {
  const expected = { task };
  const { client, calls } = clientFor(expected);

  assert.deepEqual(await client.getAssignedEmployeeTask(taskId), expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, `https://cetem-qc.example.test/api/v1/employee/tasks/${taskId}`);
  assert.equal(calls[0]!.init?.method, "GET");
  assert.deepEqual(calls[0]!.init?.headers, {
    accept: "application/json",
    authorization: `Bearer ${token}`,
  });
  assert.equal(calls[0]!.init?.body, undefined);

  const encodedId = "task / id";
  const encoded = clientFor(expected);
  await encoded.client.getAssignedEmployeeTask(encodedId);
  assert.equal(encoded.calls[0]!.url, "https://cetem-qc.example.test/api/v1/employee/tasks/task%20%2F%20id");
});

test("unassigned or missing detail response preserves the non-disclosing 404 error", async () => {
  const { client } = clientFor({
    error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." },
  }, 404);

  await assert.rejects(client.getAssignedEmployeeTask(taskId), (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 404);
    assert.equal(error.code, "TASK_NOT_FOUND");
    assert.equal(error.message, "Tâche introuvable.");
    return true;
  });
});

test("assigned task list rejects payloads that drift from the strict response contract", async () => {
  const { client } = clientFor({ tasks: [{ ...task, measurements: [] }] });
  await assert.rejects(client.listAssignedEmployeeTasks(), { name: "ZodError" });
});

test("assigned task detail rejects malformed or Epic 5 fields through response validation", async () => {
  const { client } = clientFor({ task: { ...task, measurements: [] } });
  await assert.rejects(client.getAssignedEmployeeTask(taskId), { name: "ZodError" });
});

const syncBody = {
  operationId: "00000000-0000-4000-8000-000000000031",
  idempotencyKey: "00000000-0000-4000-8000-000000000032",
  baseRevision: 0,
  localDraftRevision: 2,
  clientSavedAt: "2026-10-04T10:00:00.000Z",
  payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0", values: {} },
};
const actor = { id: "00000000-0000-4000-8000-000000000040", displayName: "Employé Test" };
const acceptedBody = { outcome: "accepted", operationId: syncBody.operationId, kind: "submit", serverRevision: 1, acceptedAt: "2026-10-04T10:00:01.000Z", acceptedBy: actor, submissionId: "00000000-0000-4000-8000-000000000041" };
const conflictBody = { outcome: "conflict", operationId: syncBody.operationId, kind: "sync-draft", serverRevision: 2, current: { revision: 2, state: "draft", lastChangedAt: "2026-10-04T09:00:00.000Z", lastChangedBy: actor } };
const rejectedBody = { outcome: "rejected", operationId: syncBody.operationId, kind: "submit", code: "INVALID_PAYLOAD", message: "Les données du contrôle sont invalides.", issues: [{ path: "values.x", code: "unknown-field" }] };

test("C3 sync operations post the envelope with the bearer token to the route of their kind", async () => {
  const { client, calls } = clientFor(acceptedBody);
  assert.deepEqual(await client.submitEmployeeTaskAudit(taskId, syncBody), { status: 200, body: acceptedBody });
  assert.equal(calls[0]!.url, `https://cetem-qc.example.test/api/v1/employee/tasks/${taskId}/submissions`);
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(calls[0]!.init?.headers, { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` });
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), syncBody);

  const draft = clientFor({ ...acceptedBody, kind: "sync-draft", submissionId: undefined });
  const controller = new AbortController();
  const result = await draft.client.syncEmployeeTaskDraft(taskId, syncBody, { signal: controller.signal });
  assert.equal(result.status, 200);
  assert.equal(draft.calls[0]!.url, `https://cetem-qc.example.test/api/v1/employee/tasks/${taskId}/draft-syncs`);
  assert.equal(draft.calls[0]!.init?.signal, controller.signal);
});

test("C3 sync operations return conflict and rejected outcome bodies with their status", async () => {
  assert.deepEqual(await clientFor(conflictBody, 409).client.syncEmployeeTaskDraft(taskId, syncBody), { status: 409, body: conflictBody });
  assert.deepEqual(await clientFor(rejectedBody, 422).client.submitEmployeeTaskAudit(taskId, syncBody), { status: 422, body: rejectedBody });
});

test("C3 sync operations throw ApiRequestError for key reuse, errors and malformed bodies", async () => {
  const cases: Array<[unknown, number, string]> = [
    [{ error: { code: "IDEMPOTENCY_KEY_REUSED", message: "Cette clé d’opération a déjà été utilisée pour une autre requête." } }, 422, "IDEMPOTENCY_KEY_REUSED"],
    [{ error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." } }, 400, "VALIDATION_ERROR"],
    [{ error: { code: "AUTHENTICATION_FAILED", message: "Email ou mot de passe invalide." } }, 401, "AUTHENTICATION_FAILED"],
    [{ error: { code: "FORBIDDEN", message: "Accès réservé à l’Employé." } }, 403, "FORBIDDEN"],
    [{ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }, 404, "TASK_NOT_FOUND"],
    [{ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }, 500, "INTERNAL_ERROR"],
    [{ ...acceptedBody, outcome: "rejected" }, 200, "UNEXPECTED_API_RESPONSE"],
    [{ ...conflictBody, extra: true }, 409, "UNEXPECTED_API_RESPONSE"],
    [{ outcome: "rejected" }, 422, "UNEXPECTED_API_RESPONSE"],
    [acceptedBody, 201, "UNEXPECTED_API_RESPONSE"],
  ];
  for (const [payload, status, code] of cases) {
    await assert.rejects(clientFor(payload, status).client.submitEmployeeTaskAudit(taskId, syncBody), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError, `${status} ${code}`);
      assert.deepEqual([error.status, error.code], [status, code]);
      return true;
    });
  }
  const unreadable = createApiClient({ baseUrl, sessionToken: token, fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } }) as unknown as Response });
  await assert.rejects(unreadable.syncEmployeeTaskDraft(taskId, syncBody), (error: unknown) => error instanceof ApiRequestError && error.code === "UNEXPECTED_API_RESPONSE");
  const offline = createApiClient({ baseUrl, sessionToken: token, fetch: async () => { throw new TypeError("Network request failed"); } });
  await assert.rejects(offline.syncEmployeeTaskDraft(taskId, syncBody), TypeError);
});

test("K4 sync operations send correctionOfOperationId only when it is given", async () => {
  const correctionOfOperationId = "00000000-0000-4000-8000-000000000033";
  const withReference = clientFor(acceptedBody);
  await withReference.client.submitEmployeeTaskAudit(taskId, { ...syncBody, correctionOfOperationId });
  assert.deepEqual(JSON.parse(String(withReference.calls[0]!.init?.body)), { ...syncBody, correctionOfOperationId });
  const without = clientFor({ ...acceptedBody, kind: "sync-draft", submissionId: undefined });
  await without.client.syncEmployeeTaskDraft(taskId, syncBody);
  assert.equal("correctionOfOperationId" in JSON.parse(String(without.calls[0]!.init?.body)), false);
  const rejected = { ...rejectedBody, code: "INVALID_CORRECTION_REFERENCE", message: "La référence de la soumission corrigée est invalide.", issues: [{ path: "correctionOfOperationId", code: "invalid-reference" }] };
  assert.deepEqual(await clientFor(rejected, 422).client.submitEmployeeTaskAudit(taskId, { ...syncBody, correctionOfOperationId }), { status: 422, body: rejected });
});

const replacementInput = { establishment: "Centre B", service: "Radiologie", type: "graphie_mobile", assigneeId: "00000000-0000-4000-8000-000000000050" } as const;
const replacementBody = {
  task: { id: "00000000-0000-4000-8000-000000000051", establishment: "Centre B", service: "Radiologie", type: "graphie_mobile", assigneeId: replacementInput.assigneeId, creatorId: "00000000-0000-4000-8000-000000000052", createdAt: "2026-10-05T10:00:00.000Z", state: "draft" },
  replacementOf: { taskId, auditId: "00000000-0000-4000-8000-000000000053" },
};

test("K6 a replacement posts the task request with the bearer token to the original task's route and returns the 201 body", async () => {
  const { client, calls } = clientFor(replacementBody, 201);
  assert.deepEqual(await client.createReplacementControl(taskId, replacementInput), { status: 201, body: replacementBody });
  assert.equal(calls[0]!.url, `https://cetem-qc.example.test/api/v1/tasks/${taskId}/replacements`);
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(calls[0]!.init?.headers, { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` });
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), replacementInput);
  const encoded = clientFor(replacementBody, 201);
  await encoded.client.createReplacementControl("tâche / 1", replacementInput);
  assert.equal(encoded.calls[0]!.url, "https://cetem-qc.example.test/api/v1/tasks/t%C3%A2che%20%2F%201/replacements");
});

test("K6 a replacement returns typed 404, 409 and 422 outcomes and throws on anything else", async () => {
  const outcomes: Array<[number, string, string]> = [
    [404, "TASK_NOT_FOUND", "Tâche introuvable."],
    [409, "AUDIT_NOT_ACCEPTED", "Cette tâche n’a pas d’audit accepté par le serveur."],
    [409, "REPLACEMENT_ALREADY_EXISTS", "Un contrôle de remplacement existe déjà pour cet audit."],
    [422, "TASK_ASSIGNEE_UNAVAILABLE", "Cet Employé n’est pas actif ou ne fait pas partie de votre équipe."],
  ];
  for (const [status, code, message] of outcomes) {
    assert.deepEqual(await clientFor({ error: { code, message } }, status).client.createReplacementControl(taskId, replacementInput), { status, code, message });
  }
  const failures: Array<[unknown, number, string]> = [
    [{ error: { code: "VALIDATION_ERROR", message: "Invalide." } }, 400, "VALIDATION_ERROR"],
    [{ error: { code: "AUTHENTICATION_FAILED", message: "Email ou mot de passe invalide." } }, 401, "AUTHENTICATION_FAILED"],
    [{ error: { code: "FORBIDDEN", message: "Action réservée au Responsable de l’équipe." } }, 403, "FORBIDDEN"],
    [{ error: { code: "INTERNAL_ERROR", message: "Le contrôle de remplacement n’a pas pu être créé." } }, 500, "INTERNAL_ERROR"],
    [{ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }, 409, "TASK_NOT_FOUND"],
    [{ error: { code: "AUDIT_NOT_ACCEPTED", message: "x" } }, 422, "AUDIT_NOT_ACCEPTED"],
    [{ ...replacementBody, extra: true }, 201, "UNEXPECTED_API_RESPONSE"],
    [replacementBody, 200, "UNEXPECTED_API_RESPONSE"],
  ];
  for (const [payload, status, code] of failures) {
    await assert.rejects(clientFor(payload, status).client.createReplacementControl(taskId, replacementInput), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError, `${status} ${code}`);
      assert.deepEqual([error.status, error.code], [status, code]);
      return true;
    });
  }
  const { client, calls } = clientFor(replacementBody, 201);
  await assert.rejects(client.createReplacementControl(taskId, { ...replacementInput, assigneeId: "employe" }), { name: "ZodError" });
  assert.equal(calls.length, 0, "an invalid request is never sent");
});

const auditVersionBody = {
  revision: 2, state: "draft", lastChangedAt: "2026-10-04T09:00:00.000Z", lastChangedBy: actor, payload: syncBody.payload,
};

test("K2 the audit version is read with the bearer token from the task's route and parsed", async () => {
  const { client, calls } = clientFor(auditVersionBody);
  const controller = new AbortController();
  assert.deepEqual(await client.getEmployeeTaskAuditVersion(taskId, { signal: controller.signal }), auditVersionBody);
  assert.equal(calls[0]!.url, `https://cetem-qc.example.test/api/v1/employee/tasks/${taskId}/audit-version`);
  assert.equal(calls[0]!.init?.method, "GET");
  assert.deepEqual(calls[0]!.init?.headers, { accept: "application/json", authorization: `Bearer ${token}` });
  assert.equal(calls[0]!.init?.body, undefined);
  assert.equal(calls[0]!.init?.signal, controller.signal);
  const noAudit = { revision: 0, state: "draft", lastChangedAt: null, lastChangedBy: null, payload: null };
  assert.deepEqual(await clientFor(noAudit).client.getEmployeeTaskAuditVersion(taskId), noAudit);
});

test("K2 the audit version throws ApiRequestError on errors and invalid bodies", async () => {
  const cases: Array<[unknown, number, string]> = [
    [{ error: { code: "AUTHENTICATION_FAILED", message: "Email ou mot de passe invalide." } }, 401, "AUTHENTICATION_FAILED"],
    [{ error: { code: "FORBIDDEN", message: "Accès réservé à l’Employé." } }, 403, "FORBIDDEN"],
    [{ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }, 404, "TASK_NOT_FOUND"],
    [{ error: { code: "INTERNAL_ERROR", message: "La version du serveur n’a pas pu être chargée." } }, 500, "INTERNAL_ERROR"],
    [{ ...auditVersionBody, extra: true }, 200, "UNEXPECTED_API_RESPONSE"],
    [{ ...auditVersionBody, payload: { values: {} } }, 200, "UNEXPECTED_API_RESPONSE"],
    [auditVersionBody, 201, "UNEXPECTED_API_RESPONSE"],
  ];
  for (const [payload, status, code] of cases) {
    await assert.rejects(clientFor(payload, status).client.getEmployeeTaskAuditVersion(taskId), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError, `${status} ${code}`);
      assert.deepEqual([error.status, error.code], [status, code]);
      return true;
    });
  }
  const unreadable = createApiClient({ baseUrl, sessionToken: token, fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } }) as unknown as Response });
  await assert.rejects(unreadable.getEmployeeTaskAuditVersion(taskId), (error: unknown) => error instanceof ApiRequestError && error.code === "UNEXPECTED_API_RESPONSE");
  const offline = createApiClient({ baseUrl, sessionToken: token, fetch: async () => { throw new TypeError("Network request failed"); } });
  await assert.rejects(offline.getEmployeeTaskAuditVersion(taskId), TypeError);
});

test("employee password reset posts to the versioned endpoint and maps the inactive conflict", async () => {
  const employeeId = "00000000-0000-4000-8000-000000000020";
  const expected = {
    employee: { id: employeeId, firstName: "Test", surname: "Employe", email: "employe@example.test", active: true },
    temporaryCredential: "temporary-credential-value",
  };
  const { client, calls } = clientFor(expected);
  assert.deepEqual(await client.resetEmployeePassword(employeeId), expected);
  assert.equal(calls[0]!.url, `https://cetem-qc.example.test/api/v1/employees/${employeeId}/password-reset`);
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(calls[0]!.init?.body, undefined);

  const conflict = clientFor({ error: { code: "EMPLOYEE_INACTIVE", message: "Cet Employé est désactivé. Réactivez-le avant de réinitialiser son mot de passe." } }, 409);
  await assert.rejects(conflict.client.resetEmployeePassword(employeeId), (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "EMPLOYEE_INACTIVE");
    return true;
  });
});

test("K8 getAcceptedEvidence returns typed outcomes for 200, 403, 404 and 500 and throws on anything else", async () => {
  const id = "00000000-0000-4000-8000-000000000041";
  const result = { test: "voltage-accuracy" };
  const body = {
    task: { id, establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test" },
    submission: { submissionId: id, auditId: id, revision: 1, submittedBy: { id, displayName: "Employé Test" }, acceptedAt: "2026-10-07T08:00:00.000Z" },
    identity: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" },
    values: {},
    results: { voltageAccuracy: result, voltageRepeatability: result, outputRepeatability: result, outputLinearity: result, lightFieldCorrespondence: result },
    lineage: { replacementOf: null, replacedBy: null, recoverySource: null, recoverySuccessorTaskId: null },
    insights: { status: "unavailable", reason: "no-approved-rules", registryVersion: "insight-registry-1", proposals: [] },
  };
  const ok = clientFor(body);
  assert.deepEqual(await ok.client.getAcceptedEvidence(id), { status: 200, body });
  assert.equal(ok.calls[0]!.url, `https://cetem-qc.example.test/api/v1/tasks/${id}/accepted-evidence`);
  assert.equal(ok.calls[0]!.init?.method, "GET");
  const outcomes: Array<[number, string, string]> = [
    [403, "FORBIDDEN", "Accès réservé au Responsable de l’équipe."],
    [404, "TASK_NOT_FOUND", "Tâche introuvable."],
    [500, "INTERNAL_ERROR", "Les preuves n’ont pas pu être chargées."],
  ];
  for (const [status, code, message] of outcomes) {
    assert.deepEqual(await clientFor({ error: { code, message } }, status).client.getAcceptedEvidence(id), { status, code, message });
  }
  await assert.rejects(clientFor({ error: { code: "AUTHENTICATION_FAILED", message: "x" } }, 401).client.getAcceptedEvidence(id), ApiRequestError);
  await assert.rejects(clientFor({ ...body, lineage: undefined }).client.getAcceptedEvidence(id), ApiRequestError);
});
