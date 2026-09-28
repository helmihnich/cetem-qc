import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Pool, PoolClient } from "pg";
import { createApp } from "./index.js";
import { createOwnTeamEmployee, updateOwnTeamEmployeeStatus } from "./modules/team-access/employee-credentials.js";
import { hashPassword } from "./modules/identity-auth/index.js";
import { verifyPassword } from "./modules/identity-auth/index.js";
import { authenticateWithPassword } from "./modules/identity-auth/authentication.js";
import { createSession, findActiveSession } from "./modules/identity-auth/sessions.js";
import { Pool as PostgresPool } from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const responsable = { id: "responsable-1", email: "lead@example.com", display_name: "Lead User", role: "responsable", password_hash: "", must_change_password: false, is_active: true };
const employees: Array<{ id: string; first_name: string; surname: string; email: string; display_name: string; is_active: boolean; team_id: string; role: string; must_change_password: boolean; password_hash: string }> = [];
const sessions = new Map<string, { account_id: string; expires_at: string; revoked_at?: string }>();
const sessionToken = "T".repeat(43);
const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
let accountRows = 0;
let authenticatedAccount = responsable;

function testPool(failInsert = false, failStatusUpdate = false): Pool {
  const query = async (sql: string, values?: unknown[]) => {
    const statement = sql.trim();
    if (statement.includes("FROM identity_accounts WHERE email = $1")) return { rows: [{ ...(employees.find((employee) => employee.email === values?.[0]) ?? responsable) }], rowCount: 1 };
    if (statement.startsWith("INSERT INTO identity_sessions")) { sessions.set(String(values?.[1]), { account_id: responsable.id, expires_at: String(values?.[2]) }); return { rows: [], rowCount: 1 }; }
    if (statement.includes("FROM identity_sessions s")) {
      const session = sessions.get(String(values?.[0]));
      const account = employees.find((employee) => employee.id === session?.account_id)
        ?? (session?.account_id === responsable.id ? responsable : [...sessions.values()].some((entry) => entry.account_id === session?.account_id) ? authenticatedAccount : undefined);
      return session && !session.revoked_at && account?.is_active ? { rows: [{ id: account.id, email: account.email, display_name: account.display_name, role: account.role, must_change_password: account.must_change_password, expires_at: session.expires_at }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK" || statement.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
    if (statement.includes("FROM identity_teams WHERE responsable_account_id")) return { rows: [{ team_id: "team-1" }], rowCount: 1 };
    if (statement.startsWith("UPDATE identity_accounts employee")) {
      if (statement.includes("SET is_active = $1")) {
        if (failStatusUpdate) throw new Error("database failure");
        const target = employees.find((employee) => employee.id === values?.[1]);
        if (!target || target.team_id !== "team-1" || target.role !== "employe" || values?.[2] !== "responsable-1") return { rows: [], rowCount: 0 };
        target.is_active = Boolean(values?.[0]);
        return { rows: [{ id: target.id, first_name: target.first_name, surname: target.surname, email: target.email, is_active: target.is_active }], rowCount: 1 };
      }
      const target = employees.find((employee) => employee.id === values?.[1]);
      if (!target || target.team_id !== "team-1" || !target.is_active || target.must_change_password === false || target.role === "responsable" || values?.[2] !== "responsable-1") return { rows: [], rowCount: 0 };
      target.password_hash = String(values?.[0]);
      target.must_change_password = true;
      return { rows: [{ id: target.id, first_name: target.first_name, surname: target.surname, email: target.email, is_active: true }], rowCount: 1 };
    }
    if (statement.includes("FROM identity_teams team")) return { rows: employees.map(({ id, first_name, surname, email, is_active }) => ({ id, first_name, surname, email, is_active })), rowCount: employees.length };
    if (statement.includes("INSERT INTO identity_accounts")) {
      if (failInsert) throw new Error("database failure");
      if (employees.some((employee) => employee.email === values?.[0])) throw Object.assign(new Error("duplicate"), { code: "23505", constraint: "identity_accounts_email_case_insensitive_unique" });
      accountRows++;
      const employee = { id: `00000000-0000-4000-8000-${String(accountRows).padStart(12, "0")}`, first_name: String(values?.[4]), surname: String(values?.[5]), email: String(values?.[0]), display_name: `${String(values?.[4])} ${String(values?.[5])}`, is_active: true, team_id: String(values?.[3]), role: "employe", must_change_password: true, password_hash: String(values?.[2]) };
      employees.push(employee);
      return { rows: [{ id: employee.id, first_name: employee.first_name, surname: employee.surname, email: employee.email, is_active: true }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const client = { query, release: () => undefined } as unknown as PoolClient;
  return { query, connect: async () => client } as unknown as Pool;
}

async function withServer(pool: Pool, run: (root: string) => Promise<void>) {
  const server = createServer(createApp(pool));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { const address = server.address() as AddressInfo; await run(`http://127.0.0.1:${address.port}/api/v1`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function login(root: string) {
  void root;
  sessions.set(sessionHash, { account_id: responsable.id, expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  return sessionToken;
}

function loginAs(account: typeof responsable) {
  authenticatedAccount = account;
  const token = `T${account.id}`.padEnd(43, "T").slice(0, 43);
  const hash = createHash("sha256").update(token).digest("hex");
  sessions.set(hash, { account_id: account.id, expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  return token;
}

function request(root: string, token: string, method: string, body?: unknown) {
  return fetch(`${root}/employees`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("Responsable creates an employee, sees it in the roster, and roster omits the one-time credential", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear();
  await withServer(testPool(), async (root) => {
    const token = await login(root);
    assert.equal((await request(root, token, "POST", { firstName: "Nour", surname: "Ali", email: "nour@example.com", teamId: "other" })).status, 400);
    const created = await request(root, token, "POST", { firstName: "Nour", surname: "Ali", email: "Nour@Example.com" });
    assert.equal(created.status, 201);
    const payload = await created.json() as { employee: { id: string; email: string }; temporaryCredential: string };
    assert.equal(payload.employee.email, "nour@example.com"); assert.match(payload.temporaryCredential, /^[A-Za-z0-9_-]{32}$/);
    const roster = await (await request(root, token, "GET")).json();
    assert.deepEqual(roster, { employees: [{ id: payload.employee.id, firstName: "Nour", surname: "Ali", email: "nour@example.com", active: true }] });
    assert.doesNotMatch(JSON.stringify(roster), /temporaryCredential|passwordHash|password_hash/);
  });
});

test("employee creation validates names/email and rejects duplicates and anonymous sessions", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear();
  await withServer(testPool(), async (root) => {
    const token = await login(root);
    for (const body of [{ firstName: "", surname: "Ali", email: "a@example.com" }, { firstName: "Nour", surname: "", email: "a@example.com" }, { firstName: "Nour", surname: "Ali", email: "invalid" }]) assert.equal((await request(root, token, "POST", body)).status, 400);
    const body = { firstName: "Nour", surname: "Ali", email: "same@example.com" };
    assert.equal((await request(root, token, "POST", body)).status, 201);
    assert.equal((await request(root, token, "POST", body)).status, 409);
    assert.equal((await fetch(`${root}/employees`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, 401);
  });
});

test("database failure rolls back creation and concurrent duplicate attempts have one winner", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear();
  await withServer(testPool(true), async (root) => { const token = await login(root); assert.equal((await request(root, token, "POST", { firstName: "Nour", surname: "Ali", email: "fail@example.com" })).status, 500); });
  assert.equal(employees.length, 0);
  const results = await Promise.allSettled([
    createOwnTeamEmployee(testPool(), responsable.id, { firstName: "A", surname: "One", email: "dupe@example.com" }),
    createOwnTeamEmployee(testPool(), responsable.id, { firstName: "B", surname: "Two", email: "DUPE@example.com" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("credential regeneration is Responsable-only, own-team-only, one-time in response, and non-cacheable", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear(); authenticatedAccount = responsable;
  await withServer(testPool(), async (root) => {
    const responsableToken = await login(root);
    const created = await request(root, responsableToken, "POST", { firstName: "Nour", surname: "Ali", email: "regen@example.com" });
    const createdPayload = await created.json() as { employee: { id: string }; temporaryCredential: string };
    const oldCredential = createdPayload.temporaryCredential;
    const logged: unknown[][] = [];
    const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    console.log = (...args) => { logged.push(args); };
    console.info = (...args) => { logged.push(args); };
    console.warn = (...args) => { logged.push(args); };
    console.error = (...args) => { logged.push(args); };
    const response = await fetch(`${root}/employees/${createdPayload.employee.id}/credential`, { method: "POST", headers: { authorization: `Bearer ${responsableToken}` } });
    console.log = originalConsole.log; console.info = originalConsole.info; console.warn = originalConsole.warn; console.error = originalConsole.error;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json() as { employee: { id: string }; temporaryCredential: string };
    assert.equal(payload.employee.id, createdPayload.employee.id);
    assert.match(payload.temporaryCredential, /^[A-Za-z0-9_-]{32}$/);
    assert.notEqual(payload.temporaryCredential, oldCredential);
    const employee = employees[0]!;
    assert.match(employee.password_hash, /^scrypt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    assert.notEqual(employee.password_hash, payload.temporaryCredential);
    assert.equal(await verifyPassword(oldCredential, employee.password_hash), false);
    assert.equal(await verifyPassword(payload.temporaryCredential, employee.password_hash), true);
    assert.equal(employee.must_change_password, true);
    const rosterText = await (await request(root, responsableToken, "GET")).text();
    const sessionText = await (await fetch(`${root}/session`, { headers: { authorization: `Bearer ${responsableToken}` } })).text();
    assert.doesNotMatch(rosterText, new RegExp(payload.temporaryCredential));
    assert.doesNotMatch(sessionText, new RegExp(payload.temporaryCredential));
    assert.doesNotMatch(JSON.stringify(logged), new RegExp(payload.temporaryCredential));
  });
});

test("regeneration denies another team's employee and Employé role", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear(); authenticatedAccount = responsable;
  await withServer(testPool(), async (root) => {
    const ownerToken = await login(root);
    const created = await request(root, ownerToken, "POST", { firstName: "Nour", surname: "Ali", email: "private@example.com" });
    const id = (await created.json() as { employee: { id: string } }).employee.id;
    employees[0]!.team_id = "another-team";
    let token = loginAs({ ...responsable, id: "responsable-2" });
    authenticatedAccount = { ...responsable, id: "responsable-2" };
    const otherTeam = await fetch(`${root}/employees/${id}/credential`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    assert.equal(otherTeam.status, 404);
    employees[0]!.team_id = "team-1";
    token = loginAs({ ...responsable, id: "employee-user", role: "employe" });
    authenticatedAccount = { ...responsable, id: "employee-user", role: "employe" };
    const employeeRole = await fetch(`${root}/employees/${id}/credential`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    assert.equal(employeeRole.status, 403);
  });
});

test("Responsable deactivates and reactivates only own-team employees; sessions check current status and history is untouched", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear(); authenticatedAccount = responsable;
  await withServer(testPool(), async (root) => {
    const ownerToken = await login(root);
    const created = await request(root, ownerToken, "POST", { firstName: "Nour", surname: "Ali", email: "status@example.com" });
    const { employee } = await created.json() as { employee: { id: string } };
    const employeeAccount = employees[0]!;
    employeeAccount.password_hash = await hashPassword("employee-password"); employeeAccount.must_change_password = false;
    const employeeToken = loginAs(employeeAccount);
    authenticatedAccount = responsable;
    const inactive = await fetch(`${root}/employees/${employee.id}/status`, { method: "PATCH", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" }, body: JSON.stringify({ active: false }) });
    assert.equal(inactive.status, 200);
    assert.deepEqual((await inactive.json() as { employee: { active: boolean } }).employee.active, false);
    assert.equal(employeeAccount.is_active, false);
    assert.equal((await fetch(`${root}/session`, { headers: { authorization: `Bearer ${employeeToken}` } })).status, 401);
    const authPool = {
      query: async (sql: string) => sql.includes("FROM identity_accounts WHERE email")
        ? { rows: [{ ...employeeAccount }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    } as unknown as Pool;
    await assert.rejects(() => authenticateWithPassword(authPool, employeeAccount.email, "employee-password"));
    authenticatedAccount = responsable;
    const reactivated = await fetch(`${root}/employees/${employee.id}/status`, { method: "PATCH", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" }, body: JSON.stringify({ active: true }) });
    assert.equal(reactivated.status, 200);
    assert.equal(employeeAccount.is_active, true);
    const sessionPool = { query: async () => ({ rows: [{ id: employeeAccount.id, email: employeeAccount.email, display_name: "Nour Ali", role: "employe", must_change_password: false, expires_at: new Date(Date.now() + 3_600_000).toISOString() }], rowCount: 1 }) } as unknown as Pool;
    assert.ok(await findActiveSession(sessionPool, employeeToken));
    assert.equal((await fetch(`${root}/session`, { headers: { authorization: `Bearer ${employeeToken}` } })).status, 200);
    assert.equal(employees.length, 1);
    assert.equal(employees[0], employeeAccount);
    assert.equal(accountRows, 1);
  });
});

test("status mutation rejects invalid input, cross-team targets, Employé role and malformed IDs without changes", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear(); authenticatedAccount = responsable;
  await withServer(testPool(), async (root) => {
    const ownerToken = await login(root);
    const created = await request(root, ownerToken, "POST", { firstName: "Nour", surname: "Ali", email: "scope@example.com" });
    const id = (await created.json() as { employee: { id: string } }).employee.id;
    assert.equal((await fetch(`${root}/employees/${id}/status`, { method: "PATCH", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" }, body: JSON.stringify({ active: "false" }) })).status, 400);
    assert.equal(employees[0]!.is_active, true);
    employees[0]!.team_id = "another-team";
    const outsider = loginAs({ ...responsable, id: "responsable-2" });
    authenticatedAccount = { ...responsable, id: "responsable-2" };
    const denied = await fetch(`${root}/employees/${id}/status`, { method: "PATCH", headers: { authorization: `Bearer ${outsider}`, "content-type": "application/json" }, body: JSON.stringify({ active: false }) });
    assert.equal(denied.status, 404); assert.equal(employees[0]!.is_active, true);
    employees[0]!.team_id = "team-1";
    const employeeToken = loginAs({ ...responsable, id: "employee-user", role: "employe" });
    authenticatedAccount = { ...responsable, id: "employee-user", role: "employe" };
    assert.equal((await fetch(`${root}/employees/${id}/status`, { method: "PATCH", headers: { authorization: `Bearer ${employeeToken}`, "content-type": "application/json" }, body: JSON.stringify({ active: false }) })).status, 403);
    assert.equal(employees[0]!.is_active, true);
    assert.equal((await fetch(`${root}/employees/not-a-uuid/status`, { method: "PATCH", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" }, body: JSON.stringify({ active: false }) })).status, 404);
  });
});

test("status mutation rolls back on a database update failure and never deletes the employee", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear(); authenticatedAccount = responsable;
  await withServer(testPool(), async (root) => {
    const ownerToken = await login(root);
    const created = await request(root, ownerToken, "POST", { firstName: "Nour", surname: "Ali", email: "rollback@example.com" });
    assert.equal(created.status, 201);
    employees[0]!.is_active = false;
  });
  await withServer(testPool(false, true), async (root) => {
    const ownerToken = await login(root);
    const result = await fetch(`${root}/employees/${employees[0]!.id}/status`, { method: "PATCH", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" }, body: JSON.stringify({ active: false }) });
    assert.equal(result.status, 500);
    assert.equal(employees[0]!.is_active, false);
    assert.equal(employees.length, 1);
  });
});

test("an injected route pool is used even when the integration-test database URL is configured", async () => {
  const injectedPool = testPool();
  const previousUrl = process.env.CETEM_QC_TEST_DATABASE_URL;
  process.env.CETEM_QC_TEST_DATABASE_URL = "postgres://ambient-config-must-not-be-used/cetem_qc_test";
  try {
    await withServer(injectedPool, async (root) => {
      const token = await login(root);
      const response = await request(root, token, "GET");
      assert.equal(response.status, 200);
    });
  } finally {
    if (previousUrl === undefined) delete process.env.CETEM_QC_TEST_DATABASE_URL;
    else process.env.CETEM_QC_TEST_DATABASE_URL = previousUrl;
  }
});

test("PostgreSQL protected requests reject an existing session while inactive and accept it again after reactivation", { skip: !process.env.CETEM_QC_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.CETEM_QC_TEST_DATABASE_URL!;
  const parsedUrl = new URL(databaseUrl);
  assert.match(parsedUrl.pathname, /^\/(cetem_qc_test|cetem_qc_test_[a-z0-9_]+)$/i, "refusing to use a database not explicitly named cetem_qc_test");
  const pool = new PostgresPool({ connectionString: databaseUrl, max: 3 });
  const schema = `story33_session_${randomUUID().replaceAll("-", "")}`;
  const setup = await pool.connect();
  let setupReleased = false;
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}"`);
    for (const migration of ["0001_identity_accounts.sql", "0002_identity_authentication.sql", "0003_identity_sessions.sql", "0004_team_membership.sql", "0005_employee_email_normalization.sql"]) {
      await setup.query(await readFile(resolve("src/db/migrations", migration), "utf8"));
    }
    const passwordHash = await hashPassword("employee-session-password");
    const owner = (await setup.query<{ id: string }>("INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password) VALUES ($1,'Owner','responsable',$2,false) RETURNING id", [`owner-${randomUUID()}@example.test`, passwordHash])).rows[0]!.id;
    const team = (await setup.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [owner])).rows[0]!.id;
    const employee = (await setup.query<{ id: string }>("INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname) VALUES ($1,'Employee','employe',$2,false,$3,'Nour','Ali') RETURNING id", [`employee-${randomUUID()}@example.test`, passwordHash, team])).rows[0]!.id;
    setup.release(); setupReleased = true;
    const scopedPool = {
      query: async (sql: string, values?: unknown[]) => {
        const client = await pool.connect();
        try { await client.query(`SET search_path TO "${schema}"`); return await client.query(sql, values); }
        finally { client.release(); }
      },
      connect: async () => {
        const client = await pool.connect();
        await client.query(`SET search_path TO "${schema}"`);
        return client;
      },
    } as unknown as Pool;
    const email = (await scopedPool.query<{ email: string }>("SELECT email FROM identity_accounts WHERE id = $1", [employee])).rows[0]!.email;
    const employeeAccount = await authenticateWithPassword(scopedPool, email, "employee-session-password");
    const session = await createSession(scopedPool, employeeAccount);
    await updateOwnTeamEmployeeStatus(scopedPool, owner, employee, false);
    await withServer(scopedPool, async (root) => {
      assert.equal((await fetch(`${root}/session`, { headers: { authorization: `Bearer ${session.token}` } })).status, 401);
    });
    await updateOwnTeamEmployeeStatus(scopedPool, owner, employee, true);
    await withServer(scopedPool, async (root) => {
      assert.equal((await fetch(`${root}/session`, { headers: { authorization: `Bearer ${session.token}` } })).status, 200);
    });
  } finally {
    if (!setupReleased) setup.release();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
