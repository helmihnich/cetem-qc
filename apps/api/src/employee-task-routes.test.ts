import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { createApp } from "./index.js";

const employeeId = "00000000-0000-4000-8000-000000000002";
const ownerId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000010";
const secondTaskId = "00000000-0000-4000-8000-000000000012";
const otherTaskId = "00000000-0000-4000-8000-000000000011";
const employeeToken = "E".repeat(43);
const ownerToken = "O".repeat(43);
const temporaryToken = "T".repeat(43);
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
let taskQueries = 0;

function fakePool(): Pool {
  return {
    async query(sql: string, values?: unknown[]) {
      if (sql.includes("FROM identity_sessions s")) {
        const id = values?.[0] === digest(employeeToken) || values?.[0] === digest(temporaryToken) ? employeeId : values?.[0] === digest(ownerToken) ? ownerId : undefined;
        const mustChangePassword = values?.[0] === digest(temporaryToken);
        return id ? { rows: [{ id, email: "test@example.com", display_name: "Test", role: id === employeeId ? "employe" : "responsable", must_change_password: mustChangePassword, expires_at: new Date(Date.now() + 3_600_000) }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM tasks task") && sql.includes("task_assignments")) {
        taskQueries++;
        assert.match(sql, /assignment\.employee_id\s*=\s*\$1/);
        if (sql.includes("task.id = $2")) {
          assert.match(sql, /task\.id\s*=\s*\$2/);
          if (values?.[0] === employeeId && values?.[1] === taskId) return { rows: [{ id: taskId, establishment: "Centre A", service: "Radiologie", task_type: "graphie_mobile", state: "draft", created_at: new Date("2026-09-28T10:00:00Z") }], rowCount: 1 };
          if (values?.[0] === employeeId && values?.[1] === secondTaskId) return { rows: [{ id: secondTaskId, establishment: "Centre B", service: "Mammographie", task_type: "graphie_mobile", state: "draft", created_at: new Date("2026-09-29T10:00:00Z") }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        }
        return values?.[0] === employeeId ? { rows: [
          { id: taskId, establishment: "Centre A", service: "Radiologie", task_type: "graphie_mobile", state: "draft", created_at: new Date("2026-09-28T10:00:00Z") },
          { id: secondTaskId, establishment: "Centre B", service: "Mammographie", task_type: "graphie_mobile", state: "draft", created_at: new Date("2026-09-29T10:00:00Z") },
        ], rowCount: 2 } : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
}

async function withServer(run: (root: string) => Promise<void>) {
  const server = createServer(createApp(fakePool()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}/api/v1`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("employee task list and direct reads enforce session, role, assignment, no-store, and query scope", async () => {
  taskQueries = 0;
  await withServer(async (root) => {
    const get = (path: string, token?: string) => fetch(`${root}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const list = await get("/employee/tasks", employeeToken);
    assert.equal(list.status, 200);
    assert.match(list.headers.get("cache-control") ?? "", /no-store/i);
    assert.deepEqual(await list.json(), { tasks: [
      { id: taskId, type: "graphie_mobile", establishment: "Centre A", service: "Radiologie", state: "draft", createdAt: "2026-09-28T10:00:00.000Z" },
      { id: secondTaskId, type: "graphie_mobile", establishment: "Centre B", service: "Mammographie", state: "draft", createdAt: "2026-09-29T10:00:00.000Z" },
    ] });
    assert.equal(taskQueries, 1);

    const unsupportedScope = await get("/employee/tasks?teamId=other-team", employeeToken);
    assert.equal(unsupportedScope.status, 400);
    assert.equal(taskQueries, 1, "unsupported query scopes must be rejected before task queries");
    assert.equal((await get("/employee/tasks", ownerToken)).status, 403);
    const temporary = await get("/employee/tasks", temporaryToken);
    assert.equal(temporary.status, 401);
    assert.match(temporary.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal((await get("/employee/tasks")).status, 401);
    assert.equal(taskQueries, 1, "denied list requests must not query tasks");

    const detail = await get(`/employee/tasks/${taskId}`, employeeToken);
    assert.equal(detail.status, 200);
    assert.match(detail.headers.get("cache-control") ?? "", /no-store/i);
    assert.deepEqual(await detail.json(), { task: { id: taskId, type: "graphie_mobile", establishment: "Centre A", service: "Radiologie", state: "draft", createdAt: "2026-09-28T10:00:00.000Z" } });
    const unsupportedDetailScope = await get(`/employee/tasks/${taskId}?employeeId=${ownerId}`, employeeToken);
    assert.equal(unsupportedDetailScope.status, 400);
    assert.equal((await get(`/employee/tasks/${secondTaskId}`, employeeToken)).status, 200);
    const unassigned = await get(`/employee/tasks/${otherTaskId}`, employeeToken);
    const missing = await get("/employee/tasks/not-a-uuid", employeeToken);
    assert.equal(unassigned.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await unassigned.json(), await missing.json(), "unassigned and missing identifiers must be indistinguishable");
    assert.equal((await get(`/employee/tasks/${taskId}`, ownerToken)).status, 403);
  });
});
