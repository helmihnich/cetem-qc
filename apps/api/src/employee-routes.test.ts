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
import { createAssignedTask, listEligibleTaskAssignees } from "./modules/tasks/tasks.js";
import { createSession, findActiveSession } from "./modules/identity-auth/sessions.js";
import { withPostgresTestSchema } from "./test-support/postgres.js";
import { employeeCredentialResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { MailMessage, Mailer } from "./modules/notifications/mailer.js";

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
    if (statement.includes("FOR UPDATE OF employee") && statement.includes("employee.email")) {
      const target = employees.find((employee) => employee.id === values?.[0]);
      return target && target.team_id === "team-1" && target.role === "employe" && values?.[1] === "responsable-1"
        ? { rows: [{ id: target.id, first_name: target.first_name, surname: target.surname, email: target.email, is_active: target.is_active }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (statement === "UPDATE identity_accounts SET is_active = $2 WHERE id = $1 RETURNING is_active") {
      if (failStatusUpdate) throw new Error("database failure");
      const target = employees.find((employee) => employee.id === values?.[0]);
      if (!target) return { rows: [], rowCount: 0 };
      target.is_active = Boolean(values?.[1]);
      return { rows: [{ is_active: target.is_active }], rowCount: 1 };
    }
    if (statement.startsWith("SELECT employee.id, employee.first_name, employee.surname") && !statement.includes("employee.email") && statement.includes("ORDER BY employee.surname")) {
      return { rows: employees.filter((employee) => employee.team_id === "team-1" && employee.role === "employe" && employee.is_active).map(({ id, first_name, surname }) => ({ id, first_name, surname })), rowCount: employees.filter((employee) => employee.team_id === "team-1" && employee.role === "employe" && employee.is_active).length };
    }
    if (statement.startsWith("SELECT employee.id, employee.team_id") && statement.includes("FOR UPDATE OF employee")) {
      const target = employees.find((employee) => employee.id === values?.[1]);
      const ownerTeam = values?.[0] === "responsable-1";
      return target && target.team_id === "team-1" && target.role === "employe" && target.is_active && ownerTeam ? { rows: [{ id: target.id, team_id: target.team_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (statement.startsWith("INSERT INTO tasks")) return { rows: [{ id: "00000000-0000-4000-8000-000000000099", establishment: values?.[0], service: values?.[1], task_type: "graphie_mobile", created_by: values?.[2], created_at: new Date(), state: "draft" }], rowCount: 1 };
    if (statement.startsWith("INSERT INTO task_assignments")) return { rows: [], rowCount: 1 };
    if (statement.includes("FROM identity_teams WHERE responsable_account_id") && statement.includes("SELECT id AS team_id")) return values?.[0] === "responsable-1" ? { rows: [{ team_id: "team-1" }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (statement.includes("FROM identity_teams WHERE responsable_account_id")) return values?.[0] === "responsable-1" ? { rows: [{ id: "team-1" }], rowCount: 1 } : { rows: [], rowCount: 0 };
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
    if (statement.startsWith("SELECT employee.id, employee.first_name, employee.surname, employee.email, employee.is_active")) return { rows: employees.map(({ id, first_name, surname, email, is_active, must_change_password }) => ({ id, first_name, surname, email, is_active, must_change_password })), rowCount: employees.length };
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

async function withServer(pool: Pool, run: (root: string) => Promise<void>, mailer?: Mailer) {
  const server = createServer(createApp(pool, mailer ? { mailer } : {}));
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

function taskRequest(root: string, token: string, method: string, body?: unknown) {
  return fetch(`${root}/tasks`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("Responsable creates an employee, sees it in the roster, and roster omits the one-time credential", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear();
  await withServer(testPool(), async (root) => {
    const token = await login(root);
    assert.equal((await request(root, token, "POST", { firstName: "Nour", surname: "Ali", email: "nour@example.com", teamId: "other" })).status, 400);
    const created = await request(root, token, "POST", { firstName: "Nour", surname: "Ali", email: "Nour@Example.com" });
    assert.equal(created.status, 201);
    const payload = await created.json() as { employee: { id: string; email: string; activated: boolean }; temporaryCredential: string; emailSent: boolean };
    assert.equal(payload.employee.email, "nour@example.com"); assert.match(payload.temporaryCredential, /^[A-Za-z0-9!@#$%*?]{8}$/);
    assert.equal(payload.employee.activated, false);
    assert.equal(payload.emailSent, false, "SMTP is not configured in tests");
    const roster = await (await request(root, token, "GET")).json();
    assert.deepEqual(roster, { employees: [{ id: payload.employee.id, firstName: "Nour", surname: "Ali", email: "nour@example.com", active: true, activated: false }] });
    employees[0]!.must_change_password = false;
    const activatedRoster = await (await request(root, token, "GET")).json() as { employees: Array<{ activated: boolean }> };
    assert.equal(activatedRoster.employees[0]!.activated, true);
    assert.doesNotMatch(JSON.stringify(roster), /temporaryCredential|passwordHash|password_hash/);
  });
});

test("creating a technician e-mails the temporary credential; an SMTP failure still creates the account", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear();
  const sent: MailMessage[] = [];
  await withServer(testPool(), async (root) => {
    const token = await login(root);
    const created = await request(root, token, "POST", { firstName: "Nour", surname: "Ali", email: "nour@example.com" });
    assert.equal(created.status, 201);
    const payload = await created.json() as { temporaryCredential: string; emailSent: boolean };
    assert.equal(payload.emailSent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, "nour@example.com");
    assert.ok(sent[0]!.text.includes(payload.temporaryCredential));
  }, { configured: true, send: async (message) => { sent.push(message); } });

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    await withServer(testPool(), async (root) => {
      const token = await login(root);
      const created = await request(root, token, "POST", { firstName: "Sami", surname: "Ali", email: "sami@example.com" });
      assert.equal(created.status, 201);
      const payload = await created.json() as { temporaryCredential: string; emailSent: boolean };
      assert.equal(payload.emailSent, false);
      assert.match(payload.temporaryCredential, /^[A-Za-z0-9!@#$%*?]{8}$/);
    }, { configured: true, send: async () => { throw new Error("SMTP down"); } });
  } finally { console.warn = originalWarn; }
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

test("task creation exposes active own-team employees and rejects invalid or out-of-scope assignments", async () => {
  responsable.password_hash = await hashPassword("temporary-secret"); employees.length = 0; accountRows = 0; sessions.clear(); authenticatedAccount = responsable;
  await withServer(testPool(), async (root) => {
    const token = await login(root);
    const created = await request(root, token, "POST", { firstName: "Nour", surname: "Ali", email: "eligible@example.com" });
    const employeeId = (await created.json() as { employee: { id: string } }).employee.id;
    employees.push({ ...employees[0]!, id: "inactive-employee", email: "inactive@example.com", is_active: false });
    employees.push({ ...employees[0]!, id: "other-team-employee", email: "other@example.com", team_id: "other-team" });
    const list = await fetch(`${root}/task-assignees`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json() as { assignees: Array<{ id: string }> }).assignees.map((assignee) => assignee.id), [employeeId]);
    const payload = { establishment: "Centre de contrôle", service: "Radiologie", type: "graphie_mobile", assigneeId: employeeId };
    for (const body of [{ ...payload, establishment: " " }, { ...payload, type: "graphie_fixe" }, { ...payload, teamId: "other-team" }]) {
      assert.equal((await taskRequest(root, token, "POST", body)).status, 400);
    }
    const employeeToken = loginAs({ ...responsable, id: "employee-user", role: "employe" }); authenticatedAccount = { ...responsable, id: "employee-user", role: "employe" };
    assert.equal((await taskRequest(root, employeeToken, "POST", payload)).status, 403);
    assert.equal((await fetch(`${root}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })).status, 401);
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
    assert.match(payload.temporaryCredential, /^[A-Za-z0-9!@#$%*?]{8}$/);
    assert.notEqual(payload.temporaryCredential, oldCredential);
    const employee = employees[0]!;
    assert.match(employee.password_hash, /^scrypt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    assert.notEqual(employee.password_hash, payload.temporaryCredential);
    assert.equal(await verifyPassword(oldCredential, employee.password_hash), false);
    assert.equal(await verifyPassword(payload.temporaryCredential, employee.password_hash), true);
    assert.equal(employee.must_change_password, true);
    const rosterText = await (await request(root, responsableToken, "GET")).text();
    const sessionText = await (await fetch(`${root}/session`, { headers: { authorization: `Bearer ${responsableToken}` } })).text();
    assert.equal(rosterText.includes(payload.temporaryCredential), false);
    assert.equal(sessionText.includes(payload.temporaryCredential), false);
    assert.equal(JSON.stringify(logged).includes(payload.temporaryCredential), false);
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

test("PostgreSQL protected requests reject an existing session while inactive and accept it again after reactivation", async () => {
  await withPostgresTestSchema(async ({ pool: scopedPool }) => {
    const setup = await scopedPool.connect();
    let setupReleased = false;
    try {
      const passwordHash = await hashPassword("employee-session-password");
      const owner = (await setup.query<{ id: string }>("INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password) VALUES ($1,'Owner','responsable',$2,false) RETURNING id", [`owner-${randomUUID()}@example.test`, passwordHash])).rows[0]!.id;
      const team = (await setup.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [owner])).rows[0]!.id;
      const employee = (await setup.query<{ id: string }>("INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname) VALUES ($1,'Employee','employe',$2,false,$3,'Nour','Ali') RETURNING id", [`employee-${randomUUID()}@example.test`, passwordHash, team])).rows[0]!.id;
      setup.release(); setupReleased = true;
      const email = (await scopedPool.query<{ email: string }>("SELECT email FROM identity_accounts WHERE id = $1", [employee])).rows[0]!.email;
      const employeeAccount = await authenticateWithPassword(scopedPool, email, "employee-session-password");
      const session = await createSession(scopedPool, employeeAccount);
      await updateOwnTeamEmployeeStatus(scopedPool, owner, employee, false);
      await withServer(scopedPool, async (root) => {
        // Story 5.2: a live session of a deactivated account is refused with 403 ACCOUNT_DEACTIVATED, not a generic 401.
        const inactiveResponse = await fetch(`${root}/session`, { headers: { authorization: `Bearer ${session.token}` } });
        assert.equal(inactiveResponse.status, 403);
        assert.equal((await inactiveResponse.json() as { error: { code: string } }).error.code, "ACCOUNT_DEACTIVATED");
      });
      await updateOwnTeamEmployeeStatus(scopedPool, owner, employee, true);
      await withServer(scopedPool, async (root) => {
        assert.equal((await fetch(`${root}/session`, { headers: { authorization: `Bearer ${session.token}` } })).status, 200);
      });
    } finally {
      if (!setupReleased) setup.release();
    }
  });
});

test("PostgreSQL enforces eligible task assignment and persists task provenance atomically", async () => {
  await withPostgresTestSchema(async ({ pool: scopedPool }) => {
    const setup = await scopedPool.connect();
    let setupReleased = false;
    try {
      const passwordHash = await hashPassword("task-test-password");
      const insertResponsable = (email: string) => setup.query<{ id: string }>("INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password) VALUES ($1,'Owner','responsable',$2,false) RETURNING id", [email, passwordHash]);
      const owner = (await insertResponsable(`owner-${randomUUID()}@example.test`)).rows[0]!.id;
      const otherOwner = (await insertResponsable(`other-${randomUUID()}@example.test`)).rows[0]!.id;
      const team = (await setup.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [owner])).rows[0]!.id;
      const otherTeam = (await setup.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [otherOwner])).rows[0]!.id;
      const insertEmployee = async (email: string, employeeTeam: string, active: boolean) => (await setup.query<{ id: string }>("INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname, is_active) VALUES ($1,'Employee',$2,$3,false,$4,'Nour','Ali',$5) RETURNING id", [email, "employe", passwordHash, employeeTeam, active])).rows[0]!.id;
      const activeEmployee = await insertEmployee(`active-${randomUUID()}@example.test`, team, true);
      const inactiveEmployee = await insertEmployee(`inactive-${randomUUID()}@example.test`, team, false);
      const otherTeamEmployee = await insertEmployee(`other-employee-${randomUUID()}@example.test`, otherTeam, true);
      const nonEmployee = (await setup.query<{ id: string }>("INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password) VALUES ($1,'Other Responsable','responsable',$2,false) RETURNING id", [`other-responsable-${randomUUID()}@example.test`, passwordHash])).rows[0]!.id;
      const eligible = await listEligibleTaskAssignees({ query: (sql: string, values?: unknown[]) => setup.query(sql, values) } as unknown as Pool, owner);
      assert.deepEqual(eligible.map((employee) => employee.id), [activeEmployee]);
      for (const assigneeId of [inactiveEmployee, otherTeamEmployee, owner, otherOwner, nonEmployee]) {
        await assert.rejects(() => createAssignedTask(scopedPool, owner, { establishment: "Centre", service: "Service", type: "graphie_mobile", assigneeId }));
      }
      const task = await createAssignedTask(scopedPool, owner, { establishment: "Centre Hospitalier", service: "Service libre", type: "graphie_mobile", assigneeId: activeEmployee });
      assert.equal(task.creatorId, owner);
      assert.equal(task.assigneeId, activeEmployee);
      assert.equal(task.state, "draft");
      assert.ok(Number.isFinite(Date.parse(task.createdAt)));
      assert.match(task.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.equal(task.type, "graphie_mobile");
      assert.equal(task.establishment, "Centre Hospitalier");
      assert.equal(task.service, "Service libre");
      const persisted = await scopedPool.query<{ id: string; establishment: string; service: string; task_type: string; created_by: string; created_at: Date; state: string; team_id: string; employee_id: string; task_count: string; assignment_count: string }>(
        `SELECT task.id, task.establishment, task.service, task.task_type, task.created_by, task.created_at, task.state,
                assignment.team_id, assignment.employee_id,
                (SELECT count(*) FROM tasks)::text AS task_count, (SELECT count(*) FROM task_assignments)::text AS assignment_count
         FROM tasks task JOIN task_assignments assignment ON assignment.task_id = task.id`,
      );
      assert.equal(persisted.rows.length, 1);
      assert.deepEqual(persisted.rows[0], {
        id: task.id,
        establishment: "Centre Hospitalier",
        service: "Service libre",
        task_type: "graphie_mobile",
        created_by: owner,
        created_at: new Date(task.createdAt),
        state: "draft",
        team_id: team,
        employee_id: activeEmployee,
        task_count: "1",
        assignment_count: "1",
      });

      await assert.rejects(() => createAssignedTask(scopedPool, owner, { establishment: "  ", service: "Service libre", type: "graphie_mobile", assigneeId: activeEmployee }));
      const afterTaskInsertFailure = await scopedPool.query<{ task_count: string; assignment_count: string }>("SELECT (SELECT count(*) FROM tasks)::text AS task_count, (SELECT count(*) FROM task_assignments)::text AS assignment_count");
      assert.deepEqual(afterTaskInsertFailure.rows[0], { task_count: "1", assignment_count: "1" });

      const triggerName = `fail_assignment_${randomUUID().replaceAll("-", "")}`;
      await setup.query(`CREATE FUNCTION fail_task_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced task assignment persistence failure'; END $$`);
      await setup.query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON task_assignments FOR EACH ROW EXECUTE FUNCTION fail_task_assignment()`);
      await assert.rejects(() => createAssignedTask(scopedPool, owner, { establishment: "Rollback Centre", service: "Service libre", type: "graphie_mobile", assigneeId: activeEmployee }), /forced task assignment persistence failure/);
      await setup.query(`DROP TRIGGER "${triggerName}" ON task_assignments`);
      await setup.query("DROP FUNCTION fail_task_assignment()");
      const afterAssignmentInsertFailure = await scopedPool.query<{ task_count: string; assignment_count: string }>("SELECT (SELECT count(*) FROM tasks)::text AS task_count, (SELECT count(*) FROM task_assignments)::text AS assignment_count");
      assert.deepEqual(afterAssignmentInsertFailure.rows[0], { task_count: "1", assignment_count: "1" });
    } finally {
      if (!setupReleased) setup.release();
    }
  });
});

test("PostgreSQL task creation rejects NUL characters and blank establishments as validation errors without storing a task", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const passwordHash = await hashPassword("task-validation-password");
    const ownerEmail = `owner-${randomUUID()}@example.test`;
    const owner = (await pool.query<{ id: string }>("INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password) VALUES ($1,'Owner','responsable',$2,false) RETURNING id", [ownerEmail, passwordHash])).rows[0]!.id;
    const team = (await pool.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [owner])).rows[0]!.id;
    const employee = (await pool.query<{ id: string }>("INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname) VALUES ($1,'Employee','employe',$2,false,$3,'Nour','Ali') RETURNING id", [`employee-${randomUUID()}@example.test`, passwordHash, team])).rows[0]!.id;
    const session = await createSession(pool, await authenticateWithPassword(pool, ownerEmail, "task-validation-password"));
    const payload = { establishment: "Centre Hospitalier", service: "Radiologie", type: "graphie_mobile", assigneeId: employee };
    const taskCount = async () => (await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM tasks")).rows[0]!.count;

    await withServer(pool, async (root) => {
      for (const body of [
        { ...payload, establishment: "Centre\u0000Hospitalier" },
        { ...payload, service: "Radio\u0000logie" },
        { ...payload, establishment: "   " },
      ]) {
        const response = await taskRequest(root, session.token, "POST", body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal((await response.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");
      }
      assert.equal(await taskCount(), "0", "rejected requests must not store a task");

      const accepted = await taskRequest(root, session.token, "POST", { ...payload, establishment: " Centre " });
      assert.equal(accepted.status, 201);
      assert.equal((await accepted.json() as { task: { establishment: string } }).task.establishment, "Centre");
      assert.equal(await taskCount(), "1");
    });
  });
});

test("PostgreSQL password reset: Responsable-only, own-team-only, revokes sessions, forces activation and never logs the credential", async (t) => {
  await withPostgresTestSchema(async ({ pool: scopedPool }) => {
    const oldPassword = "employee-old-password";
    const passwordHash = await hashPassword(oldPassword);
    const insert = async (sql: string, values: unknown[]) => (await scopedPool.query<{ id: string }>(sql, values)).rows[0]!.id;
    const responsableSql = "INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password) VALUES ($1,'Owner','responsable',$2,$3) RETURNING id";
    const employeeSql = "INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname, is_active) VALUES ($1,'Employee','employe',$2,false,$3,'Test','Employe',$4) RETURNING id";
    const ownerEmail = `owner-${randomUUID()}@example.test`;
    const owner = await insert(responsableSql, [ownerEmail, passwordHash, false]);
    const otherOwner = await insert(responsableSql, [`other-owner-${randomUUID()}@example.test`, passwordHash, false]);
    const pendingOwnerEmail = `pending-owner-${randomUUID()}@example.test`;
    const pendingOwner = await insert(responsableSql, [pendingOwnerEmail, passwordHash, true]);
    const ownTeam = await insert("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [owner]);
    const otherTeam = await insert("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [otherOwner]);
    await insert("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [pendingOwner]);
    const employeeEmail = `employee-${randomUUID()}@example.test`;
    const employee = await insert(employeeSql, [employeeEmail, passwordHash, ownTeam, true]);
    const otherEmployee = await insert(employeeSql, [`other-employee-${randomUUID()}@example.test`, passwordHash, otherTeam, true]);
    const inactiveEmployee = await insert(employeeSql, [`inactive-employee-${randomUUID()}@example.test`, passwordHash, ownTeam, false]);

    const state = async () => ({
      accounts: (await scopedPool.query("SELECT id, password_hash, must_change_password, is_active FROM identity_accounts ORDER BY id")).rows,
      sessions: (await scopedPool.query("SELECT id, revoked_at FROM identity_sessions ORDER BY id")).rows,
      resets: (await scopedPool.query("SELECT * FROM identity_password_resets ORDER BY id")).rows,
    });

    const captured: string[] = [];
    const originals = { info: console.info, error: console.error, warn: console.warn, log: console.log };
    const capture = (...args: unknown[]) => {
      captured.push(args.map((arg) => typeof arg === "string" ? arg : arg instanceof Error ? `${arg.message} ${arg.stack ?? ""}` : JSON.stringify(arg)).join(" "));
    };
    Object.assign(console, { info: capture, error: capture, warn: capture, log: capture });
    let credential = "";
    let resetHash = "";
    try {
      await withServer(scopedPool, async (root) => {
        const authenticate = (email: string, password: string) => fetch(`${root}/authenticate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
        const tokenFor = async (email: string, password: string) => ((await (await authenticate(email, password)).json()) as { token: string }).token;
        const reset = (token: string, id: string) => fetch(`${root}/employees/${id}/password-reset`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
        const get = (path: string, token: string) => fetch(`${root}${path}`, { headers: { authorization: `Bearer ${token}` } });
        const ownerToken = await tokenFor(ownerEmail, oldPassword);

        await t.test("H1 Responsable resets an activated Employé end to end", async () => {
          const employeeToken = await tokenFor(employeeEmail, oldPassword);
          assert.equal((await get("/employee/tasks", employeeToken)).status, 200);
          const response = await reset(ownerToken, employee);
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("cache-control"), "no-store");
          const body = employeeCredentialResponseSchema.parse(await response.json());
          assert.equal(body.employee.id, employee);
          credential = body.temporaryCredential;
          resetHash = (await scopedPool.query<{ password_hash: string }>("SELECT password_hash FROM identity_accounts WHERE id = $1", [employee])).rows[0]!.password_hash;
          assert.equal((await get("/employee/tasks", employeeToken)).status, 401, "the old session stops working");
          assert.equal((await authenticate(employeeEmail, oldPassword)).status, 401, "the old password stops working");
          const temporary = await authenticate(employeeEmail, credential);
          assert.equal(temporary.status, 200);
          const temporarySession = await temporary.json() as { token: string; user: { mustChangePassword: boolean } };
          assert.equal(temporarySession.user.mustChangePassword, true);
          assert.equal((await get("/employee/tasks", temporarySession.token)).status, 401, "activation-only session");
          const replaced = await fetch(`${root}/authenticate/password`, {
            method: "POST",
            headers: { authorization: `Bearer ${temporarySession.token}`, "content-type": "application/json" },
            body: JSON.stringify({ currentPassword: credential, newPassword: "Employee-new-passw0rd" }),
          });
          assert.equal(replaced.status, 200);
          const active = await replaced.json() as { token: string };
          assert.equal((await get("/employee/tasks", active.token)).status, 200);
        });

        await t.test("H2 an Employé session gets 403 without mutation", async () => {
          const employeeToken = await tokenFor(employeeEmail, "Employee-new-passw0rd");
          const before = await state();
          const response = await reset(employeeToken, employee);
          assert.equal(response.status, 403);
          assert.equal((await response.json() as { error: { code: string } }).error.code, "FORBIDDEN");
          assert.deepEqual(await state(), before);
        });

        await t.test("H3 an activation-only Responsable session gets 401 without mutation", async () => {
          const pendingToken = await tokenFor(pendingOwnerEmail, oldPassword);
          const before = await state();
          assert.equal((await reset(pendingToken, employee)).status, 401);
          assert.deepEqual(await state(), before);
        });

        await t.test("H4 other team, own id, a Responsable id, unknown and malformed ids get the same 404", async () => {
          const before = await state();
          const unknown = await reset(ownerToken, randomUUID());
          assert.equal(unknown.status, 404);
          const unknownBody = await unknown.json() as { error: { code: string } };
          assert.equal(unknownBody.error.code, "EMPLOYEE_NOT_FOUND");
          for (const id of [otherEmployee, owner, otherOwner, "not-a-uuid"]) {
            const response = await reset(ownerToken, id);
            assert.equal(response.status, 404, id);
            assert.deepEqual(await response.json(), unknownBody, "no disclosure beyond an unknown id");
          }
          assert.deepEqual(await state(), before);
        });

        await t.test("H5 a deactivated own-team Employé gets 409 EMPLOYEE_INACTIVE", async () => {
          const before = await state();
          const response = await reset(ownerToken, inactiveEmployee);
          assert.equal(response.status, 409);
          assert.equal((await response.json() as { error: { code: string } }).error.code, "EMPLOYEE_INACTIVE");
          assert.deepEqual(await state(), before);
        });

        await t.test("H6 an internal failure returns 500 without a credential and changes nothing", async () => {
          await scopedPool.query("CREATE FUNCTION fail_route_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END $$");
          await scopedPool.query("CREATE TRIGGER fail_route_reset_audit BEFORE INSERT ON identity_password_resets FOR EACH ROW EXECUTE FUNCTION fail_route_reset_audit()");
          try {
            const before = await state();
            const response = await reset(ownerToken, employee);
            assert.equal(response.status, 500);
            const body = await response.json() as Record<string, unknown> & { error: { code: string } };
            assert.equal(body.error.code, "INTERNAL_ERROR");
            assert.equal("temporaryCredential" in body, false);
            assert.deepEqual(await state(), before);
          } finally {
            await scopedPool.query("DROP TRIGGER fail_route_reset_audit ON identity_password_resets");
          }
        });
      });
    } finally {
      Object.assign(console, originals);
    }

    await t.test("H7 exactly one reset log line and no secret or email in any captured output", () => {
      const events = captured.filter((line) => line.includes("identity.password_reset"));
      assert.equal(events.length, 1);
      assert.deepEqual(JSON.parse(events[0]!), { event: "identity.password_reset", channel: "responsable", accountId: employee, resetByAccountId: owner });
      assert.ok(credential.length > 0 && resetHash.startsWith("scrypt:"));
      for (const line of captured) {
        assert.equal(line.includes(credential), false);
        assert.equal(line.includes(resetHash), false);
        assert.equal(line.includes("scrypt:"), false);
        assert.equal(line.includes(employeeEmail), false);
      }
    });
  });
});
