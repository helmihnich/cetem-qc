import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Pool, QueryResultRow } from "pg";
import { createApp } from "./index.js";

const ownerId = "00000000-0000-4000-8000-000000000001";
const employeeId = "00000000-0000-4000-8000-000000000002";
const inactiveOwnerId = "00000000-0000-4000-8000-000000000003";
const ownerToken = "O".repeat(43);
const employeeToken = "E".repeat(43);
const inactiveToken = "I".repeat(43);
const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");

const sessions = new Map([
  [sessionHash(ownerToken), { id: ownerId, role: "responsable", active: true }],
  [sessionHash(employeeToken), { id: employeeId, role: "employe", active: true }],
  [sessionHash(inactiveToken), { id: inactiveOwnerId, role: "responsable", active: false }],
]);

const ownTask = {
  id: "00000000-0000-4000-8000-000000000010",
  task_type: "graphie_mobile",
  establishment: "Centre de contrôle",
  assignee: "Amel Ben Ali",
  assignee_is_active: true,
  state: "draft",
  last_updated_at: new Date("2026-09-28T10:00:00.000Z"),
};
const inactiveTask = {
  ...ownTask,
  id: "00000000-0000-4000-8000-000000000011",
  establishment: "Centre inactif",
  assignee: "Sami Ben Ali",
  assignee_is_active: false,
};
let taskQueryCount = 0;

function fakePool(): Pool {
  return {
    async query(sql: string, values?: unknown[]) {
      if (sql.includes("FROM identity_sessions s")) {
        const session = sessions.get(String(values?.[0]));
        return session?.active ? { rows: [{ id: session.id, email: "test@example.com", display_name: "Test", role: session.role, must_change_password: false, expires_at: new Date(Date.now() + 3_600_000) }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM tasks task")) {
        taskQueryCount++;
        assert.match(sql, /team\.responsable_account_id\s*=\s*\$1/);
        assert.doesNotMatch(sql, /ORDER BY/i);
        return { rows: values?.[0] === ownerId ? [ownTask, inactiveTask] : [], rowCount: values?.[0] === ownerId ? 2 : 0 };
      }
      if (sql.includes("FROM unnest($1::uuid[]) AS listed(id)")) {
        return { rows: [{ id: ownTask.id, has_submitted_audit: false, replacement_of: null, replaced_by: null }, {
          id: inactiveTask.id, has_submitted_audit: true, replacement_of: ownTask.id, replaced_by: null,
        }], rowCount: 2 };
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

test("GET /tasks returns the scoped fields with inactive assignee labels and denies unsupported or unauthorized access", async () => {
  taskQueryCount = 0;
  await withServer(async (root) => {
    const getTasks = (token?: string, path = "/tasks") => fetch(`${root}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const own = await getTasks(ownerToken);
    assert.equal(own.status, 200);
    assert.match(own.headers.get("cache-control") ?? "", /no-store/i);
    const ownPayload = await own.json() as { tasks: Array<Record<string, unknown>> };
    assert.deepEqual(ownPayload, { tasks: [{
      id: ownTask.id,
      type: "graphie_mobile",
      establishment: "Centre de contrôle",
      assignee: "Amel Ben Ali",
      state: "draft",
      lastUpdatedAt: "2026-09-28T10:00:00.000Z",
      replacementOf: null,
      replacedBy: null,
    }, {
      id: inactiveTask.id,
      type: "graphie_mobile",
      establishment: "Centre inactif",
      assignee: "Sami Ben Ali — Inactif",
      state: "submitted",
      lastUpdatedAt: "2026-09-28T10:00:00.000Z",
      replacementOf: ownTask.id,
      replacedBy: null,
    }] });
    // Story 8.3 adds the two lineage fields (null without a replacement-control link).
    for (const task of ownPayload.tasks) assert.deepEqual(Object.keys(task).sort(), ["assignee", "establishment", "id", "lastUpdatedAt", "replacedBy", "replacementOf", "state", "type"]);
    assert.equal(taskQueryCount, 1);

    const unsupportedTeam = await getTasks(ownerToken, "/tasks?teamId=other-team");
    assert.equal(unsupportedTeam.status, 400);
    assert.deepEqual(await unsupportedTeam.json(), { error: { code: "VALIDATION_ERROR", message: "Les paramètres de la requête sont invalides." } });
    assert.equal(taskQueryCount, 1, "unsupported team scope must be rejected before querying task data");

    assert.equal((await getTasks(employeeToken)).status, 403);
    assert.equal((await getTasks()).status, 401);
    assert.equal((await getTasks("X".repeat(43))).status, 401);
    assert.equal((await getTasks(inactiveToken)).status, 401);
    assert.equal(taskQueryCount, 1, "denied requests must not query task rows");
  });
});
