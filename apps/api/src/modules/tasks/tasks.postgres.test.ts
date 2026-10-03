import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { Pool as PoolType } from "pg";
import { createApp } from "../../index.js";
import { createAssignedTask, listOwnTeamTasks } from "./tasks.js";
import { withPostgresTestSchema } from "../../test-support/postgres.js";

test("PostgreSQL scopes the operational task list by assigned team and tracks the last update", async () => {
  await withPostgresTestSchema(async ({ pool, migrate }) => {
    const setup = await pool.connect();
    let setupReleased = false;

    try {

      const owner = (await setup.query<{ id: string }>(
        `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password)
         VALUES ($1, 'Owner', 'responsable', 'fixture-hash', false) RETURNING id`,
        [`owner-${randomUUID()}@example.test`],
      )).rows[0]!.id;
      const otherOwner = (await setup.query<{ id: string }>(
        `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password)
         VALUES ($1, 'Other owner', 'responsable', 'fixture-hash', false) RETURNING id`,
        [`other-owner-${randomUUID()}@example.test`],
      )).rows[0]!.id;

      await migrate({ through: "0006_tasks" });
      const teams = await setup.query<{ id: string; responsable_account_id: string }>("SELECT id, responsable_account_id FROM identity_teams");
      const ownTeam = teams.rows.find((team) => team.responsable_account_id === owner)!.id;
      const otherTeam = teams.rows.find((team) => team.responsable_account_id === otherOwner)!.id;

      const ownEmployee = (await setup.query<{ id: string }>(
        `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname)
         VALUES ($1, 'Amel Ben Ali', 'employe', 'fixture-hash', false, $2, 'Amel', 'Ben Ali') RETURNING id`,
        [`employee-${randomUUID()}@example.test`, ownTeam],
      )).rows[0]!.id;
      const otherEmployee = (await setup.query<{ id: string }>(
        `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname)
         VALUES ($1, 'Sami Other', 'employe', 'fixture-hash', false, $2, 'Sami', 'Other') RETURNING id`,
        [`other-employee-${randomUUID()}@example.test`, otherTeam],
      )).rows[0]!.id;

      // Seed a valid Story 4.1 task under migrations 0001–0006 to prove the additive 0007 migration backfills existing rows.
      const oldTask = (await setup.query<{ id: string; created_at: Date }>(
        `INSERT INTO tasks (establishment, service, task_type, created_by)
         VALUES ('Centre préexistant', 'Service', 'graphie_mobile', $1)
         RETURNING id, created_at`, [owner],
      )).rows[0]!;
      await setup.query("INSERT INTO task_assignments (task_id, team_id, employee_id) VALUES ($1, $2, $3)", [oldTask.id, ownTeam, ownEmployee]);
      const columnBefore = await setup.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'tasks' AND column_name = 'updated_at') AS exists",
      );
      assert.equal(columnBefore.rows[0]!.exists, false, "updated_at must not exist before migration 0007");
      await migrate({ through: "0007_task_last_update" });
      const backfilled = await setup.query<{ created_at: Date; updated_at: Date }>("SELECT created_at, updated_at FROM tasks WHERE id = $1", [oldTask.id]);
      assert.equal(backfilled.rows[0]!.updated_at.toISOString(), oldTask.created_at.toISOString());
      setup.release();
      setupReleased = true;
      const scopedPool = pool;
      const ownTask = await createAssignedTask(scopedPool, owner, { establishment: "Centre A", service: "Service", type: "graphie_mobile", assigneeId: ownEmployee });
      await createAssignedTask(scopedPool, owner, { establishment: "Centre B", service: "Service", type: "graphie_mobile", assigneeId: ownEmployee });
      await createAssignedTask(scopedPool, otherOwner, { establishment: "Centre secret", service: "Service", type: "graphie_mobile", assigneeId: otherEmployee });

      const rows = await listOwnTeamTasks(scopedPool, owner);
      assert.equal(rows.length, 3);
      assert.deepEqual(rows.map((task) => task.establishment).sort(), ["Centre A", "Centre B", "Centre préexistant"]);
      assert.equal(JSON.stringify(rows).includes("Centre secret"), false);
      assert.deepEqual(Object.keys(rows[0]!).sort(), ["assignee", "establishment", "id", "lastUpdatedAt", "state", "type"]);
      assert.ok(rows.every((task) => task.assignee === "Amel Ben Ali" && task.state === "draft"));
      assert.equal(rows.find((task) => task.establishment === "Centre préexistant")?.lastUpdatedAt, oldTask.created_at.toISOString());

      const timestamps = await scopedPool.query<{ created_at: Date; updated_at: Date }>(
        "UPDATE tasks SET establishment = 'Centre A actualisé' WHERE id = $1 RETURNING created_at, updated_at", [ownTask.id],
      );
      assert.ok(timestamps.rows[0]!.updated_at > timestamps.rows[0]!.created_at);
      const updatedList = await listOwnTeamTasks(scopedPool, owner);
      assert.equal(updatedList.find((task) => task.id === ownTask.id)?.lastUpdatedAt, timestamps.rows[0]!.updated_at.toISOString());

      const ownerToken = await addSession(scopedPool, owner);
      const otherOwnerToken = await addSession(scopedPool, otherOwner);
      const employeeToken = await addSession(scopedPool, ownEmployee);
      const server = createServer(createApp(scopedPool));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const address = server.address() as AddressInfo;
        const root = `http://127.0.0.1:${address.port}/api/v1/tasks`;
        const ownResponse = await fetch(root, { headers: { authorization: `Bearer ${ownerToken}` } });
        assert.equal(ownResponse.status, 200);
        const ownPayload = await ownResponse.json() as { tasks: Array<{ establishment: string }> };
        assert.deepEqual(ownPayload.tasks.map((task) => task.establishment).sort(), ["Centre A actualisé", "Centre B", "Centre préexistant"]);
        assert.equal(JSON.stringify(ownPayload).includes("Centre secret"), false);

        const otherResponse = await fetch(root, { headers: { authorization: `Bearer ${otherOwnerToken}` } });
        assert.equal(otherResponse.status, 200);
        const otherPayload = await otherResponse.json() as { tasks: Array<{ establishment: string }> };
        assert.deepEqual(otherPayload.tasks.map((task) => task.establishment), ["Centre secret"]);
        assert.equal(JSON.stringify(otherPayload).includes("Centre A"), false);

        const employeeResponse = await fetch(root, { headers: { authorization: `Bearer ${employeeToken}` } });
        assert.equal(employeeResponse.status, 403);
        const crossTeamQuery = await fetch(`${root}?teamId=${otherTeam}`, { headers: { authorization: `Bearer ${ownerToken}` } });
        assert.equal(crossTeamQuery.status, 400);
        assert.equal(JSON.stringify(await crossTeamQuery.json()).includes("Centre secret"), false);
        await scopedPool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [ownEmployee]);
        const afterEmployeeDeactivation = await listOwnTeamTasks(scopedPool, owner);
        assert.equal(afterEmployeeDeactivation.some((task) => task.id === ownTask.id && task.assignee === "Amel Ben Ali \u2014 Inactif"), true);
        assert.equal(afterEmployeeDeactivation.length, 3, "deactivating an employee must not hide their assigned tasks");
        const afterDeactivationResponse = await fetch(root, { headers: { authorization: `Bearer ${ownerToken}` } });
        assert.equal(afterDeactivationResponse.status, 200);
        const afterDeactivationPayload = await afterDeactivationResponse.json() as { tasks: Array<{ id: string; assignee: string }> };
        assert.equal(afterDeactivationPayload.tasks.some((task) => task.id === ownTask.id && task.assignee === "Amel Ben Ali \u2014 Inactif"), true);
        assert.equal(afterDeactivationPayload.tasks.length, 3, "the API must retain existing tasks after assignee deactivation");

        await scopedPool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [owner]);
        const deactivatedResponse = await fetch(root, { headers: { authorization: `Bearer ${ownerToken}` } });
        assert.equal(deactivatedResponse.status, 401);
        const invalidResponse = await fetch(root, { headers: { authorization: `Bearer ${"X".repeat(43)}` } });
        assert.equal(invalidResponse.status, 401);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    } finally {
      if (!setupReleased) setup.release();
    }
  }, { migrateThrough: "0003_identity_sessions" });
});

async function addSession(pool: PoolType, accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  await pool.query("INSERT INTO identity_sessions (account_id, token_hash, expires_at) VALUES ($1, $2, $3)", [accountId, tokenHash, expiresAt]);
  return token;
}
