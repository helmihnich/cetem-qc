import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { Pool as PoolType, PoolClient } from "pg";
import { createApp } from "../../index.js";
import { createAssignedTask, getAssignedEmployeeTask, listAssignedEmployeeTasks } from "./tasks.js";
import { withPostgresTestSchema } from "../../test-support/postgres.js";

test("PostgreSQL employee reads use assignment ownership for lists and direct task IDs", async () => {
  await withPostgresTestSchema(async ({ pool, migrate }) => {
    const setup = await pool.connect();
    let setupReleased = false;
    try {
      const owner = await account(setup, "responsable", "Owner");
      const otherOwner = await account(setup, "responsable", "Other owner");
      await migrate();
      const teams = await setup.query<{ id: string; responsable_account_id: string }>("SELECT id, responsable_account_id FROM identity_teams");
      const team = teams.rows.find((row) => row.responsable_account_id === owner)!.id;
      const otherTeam = teams.rows.find((row) => row.responsable_account_id === otherOwner)!.id;
      const employee = await account(setup, "employe", "Amel Employee", team);
      const colleague = await account(setup, "employe", "Same Team Colleague", team);
      const unassignedEmployee = await account(setup, "employe", "No Assignment Employee", team);
      const otherEmployee = await account(setup, "employe", "Other Employee", otherTeam);
      setup.release();
      setupReleased = true;

      const scoped = pool;
      const own = await createAssignedTask(scoped, owner, { establishment: "Centre attribué", service: "Radiologie", type: "graphie_mobile", assigneeId: employee });
      const colleagueTask = await createAssignedTask(scoped, owner, { establishment: "Centre collègue", service: "Mammographie", type: "graphie_mobile", assigneeId: colleague });
      const other = await createAssignedTask(scoped, otherOwner, { establishment: "Centre privé", service: "Secret", type: "graphie_mobile", assigneeId: otherEmployee });
      const ownList = await listAssignedEmployeeTasks(scoped, employee);
      assert.deepEqual(ownList.map((task) => task.id), [own.id]);
      assert.deepEqual(await listAssignedEmployeeTasks(scoped, unassignedEmployee), []);
      assert.deepEqual(Object.keys(ownList[0]!).sort(), ["createdAt", "establishment", "id", "service", "state", "type"]);
      assert.equal(JSON.stringify(ownList).includes("Centre privé"), false);
      assert.equal(JSON.stringify(ownList).includes("Centre collègue"), false);
      assert.equal((await getAssignedEmployeeTask(scoped, employee, own.id))?.establishment, "Centre attribué");
      assert.equal(await getAssignedEmployeeTask(scoped, employee, colleagueTask.id), undefined);
      assert.equal(await getAssignedEmployeeTask(scoped, employee, other.id), undefined);

      const employeeToken = await addSession(scoped, employee);
      const unassignedEmployeeToken = await addSession(scoped, unassignedEmployee);
      const otherToken = await addSession(scoped, otherEmployee);
      const ownerToken = await addSession(scoped, owner);
      const server = createServer(createApp(scoped));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const address = server.address() as AddressInfo;
        const root = `http://127.0.0.1:${address.port}/api/v1/employee/tasks`;
        const listResponse = await fetch(root, { headers: { authorization: `Bearer ${employeeToken}` } });
        assert.equal(listResponse.status, 200);
        assert.match(listResponse.headers.get("cache-control") ?? "", /no-store/i);
        const payload = await listResponse.json() as { tasks: Array<{ id: string; establishment: string }> };
        assert.deepEqual(payload.tasks.map((task) => task.id), [own.id]);
        assert.equal(JSON.stringify(payload).includes("Centre privé"), false);

        const ownResponse = await fetch(`${root}/${own.id}`, { headers: { authorization: `Bearer ${employeeToken}` } });
        assert.equal(ownResponse.status, 200);
        assert.match(ownResponse.headers.get("cache-control") ?? "", /no-store/i);
        const otherResponse = await fetch(`${root}/${other.id}`, { headers: { authorization: `Bearer ${employeeToken}` } });
        const colleagueResponse = await fetch(`${root}/${colleagueTask.id}`, { headers: { authorization: `Bearer ${employeeToken}` } });
        const randomResponse = await fetch(`${root}/${randomUUID()}`, { headers: { authorization: `Bearer ${employeeToken}` } });
        assert.equal(otherResponse.status, 404);
        assert.equal(colleagueResponse.status, 404);
        assert.deepEqual(await otherResponse.json(), await randomResponse.json());
        assert.equal((await fetch(root, { headers: { authorization: `Bearer ${ownerToken}` } })).status, 403);
        const separateList = await fetch(root, { headers: { authorization: `Bearer ${otherToken}` } });
        assert.deepEqual((await separateList.json() as { tasks: Array<{ id: string }> }).tasks.map((task) => task.id), [other.id]);
        const noAssignments = await fetch(root, { headers: { authorization: `Bearer ${unassignedEmployeeToken}` } });
        assert.equal(noAssignments.status, 200);
        assert.deepEqual(await noAssignments.json(), { tasks: [] });

        await scoped.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);
        assert.equal((await fetch(root, { headers: { authorization: `Bearer ${employeeToken}` } })).status, 401);
        assert.equal((await fetch(`${root}/${own.id}`, { headers: { authorization: `Bearer ${employeeToken}` } })).status, 401);
        const retained = await scoped.query<{ count: string }>("SELECT count(*)::text AS count FROM task_assignments WHERE task_id = $1 AND employee_id = $2", [own.id, employee]);
        assert.equal(retained.rows[0]!.count, "1", "employee deactivation must preserve the assignment record");
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    } finally {
      if (!setupReleased) setup.release();
    }
  }, { migrateThrough: "0003_identity_sessions" });
});

async function account(client: PoolClient, role: "responsable" | "employe", name: string, teamId?: string) {
  const [firstName, surname = "Test"] = name.split(" ");
  const email = `${randomUUID()}@example.test`;
  const result = role === "responsable"
    ? await client.query<{ id: string }>(
      `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password)
       VALUES ($1, $2, $3, 'fixture-hash', false) RETURNING id`, [email, name, role],
    )
    : await client.query<{ id: string }>(
      `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname)
       VALUES ($1, $2, $3, 'fixture-hash', false, $4, $5, $6) RETURNING id`,
      [email, name, role, teamId ?? null, firstName, surname],
    );
  return result.rows[0]!.id;
}

async function addSession(pool: PoolType, accountId: string) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await pool.query("INSERT INTO identity_sessions (account_id, token_hash, expires_at) VALUES ($1, $2, $3)", [accountId, hash, new Date(Date.now() + 3_600_000).toISOString()]);
  return token;
}
