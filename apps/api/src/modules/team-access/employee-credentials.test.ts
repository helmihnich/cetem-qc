import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { createOwnTeamEmployee, DuplicateEmployeeEmailError, regenerateOwnTeamEmployeeCredential } from "./employee-credentials.js";
import { authenticateWithPassword, hashPassword, InvalidCredentialsError, verifyPassword } from "../identity-auth/index.js";

test("employee account insertion and team membership are atomic and only the salted hash is persisted", async () => {
  const state: { inserted?: unknown[]; committed: boolean; rolledBack: boolean } = { committed: false, rolledBack: false };
  let failInsert = false;
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "BEGIN") return { rows: [], rowCount: 0 };
      if (sql.trim() === "COMMIT") { state.committed = true; return { rows: [], rowCount: 0 }; }
      if (sql.trim() === "ROLLBACK") { state.rolledBack = true; state.inserted = undefined; return { rows: [], rowCount: 0 }; }
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM identity_accounts WHERE email")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM identity_teams WHERE")) return { rows: [{ team_id: "own-team" }], rowCount: 1 };
      if (sql.includes("INSERT INTO identity_accounts")) {
        if (failInsert) throw new Error("database failure");
        state.inserted = values;
        return { rows: [{ first_name: values?.[4], surname: values?.[5], email: values?.[0], is_active: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }, release: () => undefined,
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;

  const result = await createOwnTeamEmployee(pool, "responsable", { firstName: "Nour", surname: "Ali", email: "nour@example.com" });
  assert.equal(state.committed, true);
  assert.equal(state.rolledBack, false);
  assert.equal((state.inserted?.[3]), "own-team");
  assert.match(String(state.inserted?.[2]), /^scrypt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.notEqual(state.inserted?.[2], result.temporaryCredential);
  assert.equal(state.inserted?.[3], "own-team");

  state.committed = false;
  failInsert = true;
  await assert.rejects(createOwnTeamEmployee(pool, "responsable", { firstName: "Sam", surname: "Ben", email: "sam@example.com" }), /database failure/);
  assert.equal(state.rolledBack, true);
  assert.equal(state.inserted, undefined);
});

function poolFailingWith(databaseError: Error & { code: string; constraint?: string }): Pool {
  return { connect: async () => ({ query: async (sql: string) => {
    if (["BEGIN", "ROLLBACK"].includes(sql.trim()) || sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM identity_teams WHERE")) return { rows: [{ team_id: "team" }], rowCount: 1 };
    if (sql.includes("INSERT INTO identity_accounts")) throw databaseError;
    return { rows: [], rowCount: 0 };
  }, release: () => undefined }) } as unknown as Pool;
}

test("identity_accounts_email_key maps to duplicate email", async () => {
  const error = Object.assign(new Error("duplicate"), { code: "23505", constraint: "identity_accounts_email_key" });
  await assert.rejects(createOwnTeamEmployee(poolFailingWith(error), "responsable", { firstName: "A", surname: "B", email: "duplicate@example.com" }), DuplicateEmployeeEmailError);
});

test("identity_accounts_email_case_insensitive_unique maps to duplicate email", async () => {
  const error = Object.assign(new Error("duplicate"), { code: "23505", constraint: "identity_accounts_email_case_insensitive_unique" });
  await assert.rejects(createOwnTeamEmployee(poolFailingWith(error), "responsable", { firstName: "A", surname: "B", email: "duplicate@example.com" }), DuplicateEmployeeEmailError);
});

test("unrelated unique constraint is not mapped to duplicate email", async () => {
  const error = Object.assign(new Error("different unique constraint"), { code: "23505", constraint: "identity_accounts_pkey" });
  await assert.rejects(createOwnTeamEmployee(poolFailingWith(error), "responsable", { firstName: "A", surname: "B", email: "unrelated@example.com" }), (caught) => caught === error && !(caught instanceof DuplicateEmployeeEmailError));
});

test("unrelated database error is not mapped to duplicate email", async () => {
  const error = Object.assign(new Error("connection failure"), { code: "08006" });
  await assert.rejects(createOwnTeamEmployee(poolFailingWith(error), "responsable", { firstName: "A", surname: "B", email: "unrelated@example.com" }), (caught) => caught === error && !(caught instanceof DuplicateEmployeeEmailError));
});

test("regeneration replaces the salted hash, preserves activation requirement, and invalidates the prior credential", async () => {
  const previousCredential = "previous-temporary-credential";
  const account = { id: "employee", email: "employee@example.com", display_name: "Nour Ali", role: "employe", password_hash: await hashPassword(previousCredential), must_change_password: true, is_active: true };
  let committed = false;
  let stateAtBegin: typeof account | undefined;
  const query = async (sql: string, values?: unknown[]) => {
    if (sql.trim() === "BEGIN") { stateAtBegin = { ...account }; return { rows: [], rowCount: 0 }; }
    if (sql.trim() === "COMMIT") { committed = true; return { rows: [], rowCount: 0 }; }
    if (sql.trim() === "ROLLBACK") { Object.assign(account, stateAtBegin!); return { rows: [], rowCount: 0 }; }
    if (sql.includes("UPDATE identity_accounts employee")) {
      account.password_hash = String(values?.[0]);
      return { rows: [{ id: account.id, first_name: "Nour", surname: "Ali", email: account.email, is_active: account.is_active }], rowCount: 1 };
    }
    if (sql.includes("FROM identity_accounts WHERE email = $1")) return { rows: [{ ...account }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const client = { query, release: () => undefined } as unknown as PoolClient;
  const pool = { query, connect: async () => client } as unknown as Pool;

  const result = await regenerateOwnTeamEmployeeCredential(pool, "responsable", account.id);
  assert.ok(result);
  assert.match(result.temporaryCredential, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(result.temporaryCredential, previousCredential);
  assert.match(account.password_hash, /^scrypt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.notEqual(account.password_hash, result.temporaryCredential);
  assert.equal(await verifyPassword(previousCredential, account.password_hash), false);
  assert.equal(await verifyPassword(result.temporaryCredential, account.password_hash), true);
  assert.equal(account.must_change_password, true);
  assert.equal(committed, true);
  assert.equal(await authenticateWithPassword(pool, account.email, previousCredential).then(() => false, (e) => e instanceof InvalidCredentialsError), true);
  assert.equal((await authenticateWithPassword(pool, account.email, result.temporaryCredential)).mustChangePassword, true);
});

test("regeneration rolls back a failed hash replacement and leaves the previous credential valid", async () => {
  const oldHash = await hashPassword("still-valid-temporary");
  const account = { id: "employee", email: "employee@example.com", display_name: "Nour Ali", role: "employe", password_hash: oldHash, must_change_password: true, is_active: true };
  let before: typeof account | undefined;
  const query = async (sql: string) => {
    if (sql.trim() === "BEGIN") { before = { ...account }; return { rows: [], rowCount: 0 }; }
    if (sql.trim() === "ROLLBACK") { Object.assign(account, before!); return { rows: [], rowCount: 0 }; }
    if (sql.includes("UPDATE identity_accounts employee")) { account.password_hash = "partial-corruption"; throw new Error("hash replacement failed"); }
    return { rows: [], rowCount: 0 };
  };
  const client = { query, release: () => undefined } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  await assert.rejects(regenerateOwnTeamEmployeeCredential(pool, "responsable", account.id), /hash replacement failed/);
  assert.equal(account.password_hash, oldHash);
  assert.equal(await verifyPassword("still-valid-temporary", account.password_hash), true);
});

test("regeneration update eligibility requires same team, employee role, active status, and pending activation", async () => {
  const cases = [
    { label: "other team", owner: "different-responsable", active: true, mustChange: true, role: "employe" },
    { label: "inactive", owner: "responsable", active: false, mustChange: true, role: "employe" },
    { label: "already activated", owner: "responsable", active: true, mustChange: false, role: "employe" },
    { label: "not employee", owner: "responsable", active: true, mustChange: true, role: "responsable" },
  ];
  for (const scenario of cases) {
    let updateAttempted = false;
    const query = async (sql: string) => {
      if (sql.trim() === "BEGIN" || sql.trim() === "COMMIT" || sql.trim() === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("UPDATE identity_accounts employee")) { updateAttempted = true; return { rows: [], rowCount: 0 }; }
      return { rows: [], rowCount: 0 };
    };
    const client = { query, release: () => undefined } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;
    const result = await regenerateOwnTeamEmployeeCredential(pool, scenario.owner, "employee");
    assert.equal(result, undefined, scenario.label);
    assert.equal(updateAttempted, true, scenario.label);
  }
});
