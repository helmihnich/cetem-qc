import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { apiV1Components, apiV1Operations } from "@cetem-qc/types";
import { apiErrorSchema, createEmployeeRequestSchema, createTaskRequestSchema, employeeCredentialResponseSchema, employeeListResponseSchema, employeeTaskListQuerySchema, employeeTaskListResponseSchema, employeeTaskResponseSchema, healthQuerySchema, healthResponseSchema, taskListQuerySchema, taskListResponseSchema, updateEmployeeStatusRequestSchema, updateEmployeeStatusResponseSchema } from "./v1.js";

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

test("task list schema exposes only the six authorized fields and rejects scope parameters", async () => {
  const item: apiV1Components["schemas"]["TaskListItem"] = {
    id: "00000000-0000-4000-8000-000000000010",
    type: "graphie_mobile",
    establishment: "Centre de contrôle",
    assignee: "Amel Ben Ali",
    state: "draft",
    lastUpdatedAt: "2026-09-28T10:00:00.000Z",
  };
  const response: apiV1Operations["listOwnTeamTasks"]["responses"][200]["content"]["application/json"] = { tasks: [item] };
  assert.deepEqual(taskListQuerySchema.parse({}), {});
  assert.equal(taskListQuerySchema.safeParse({ teamId: "other-team" }).success, false);
  assert.deepEqual(taskListResponseSchema.parse(response), response);
  assert.deepEqual(taskListResponseSchema.parse({ tasks: [] }), { tasks: [] });
  assert.equal(taskListResponseSchema.safeParse({ tasks: [{ ...item, service: "unrequested" }] }).success, false);

  const openapi = await readFile(path.resolve(contractPath), "utf8");
  assert.match(openapi, /listOwnTeamTasks[\s\S]*?TaskListResponse/);
  assert.match(openapi, /TaskListItem:[\s\S]*?required: \[id, type, establishment, assignee, state, lastUpdatedAt\]/);
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
