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
