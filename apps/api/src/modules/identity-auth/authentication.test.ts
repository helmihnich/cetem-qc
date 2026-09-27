import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  authenticateWithPassword,
  InvalidCredentialsError,
  replacePasswordAfterAuthentication,
} from "./authentication.js";
import { hashPassword, verifyPassword } from "./password.js";

interface Account {
  id: string;
  email: string;
  display_name: string;
  role: "responsable" | "employe";
  password_hash: string;
  must_change_password: boolean;
  is_active: boolean;
}

function fakePool(account: Account | undefined, initialSessions: Array<{ id: string; account_id: string; revoked: boolean }> = []) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const sessions = new Map(initialSessions.map((session) => [session.id, { ...session }]));
  let transactionState: { account?: Account; sessions: Map<string, { id: string; account_id: string; revoked: boolean }> } | undefined;
  const execute = async (sql: string, values?: unknown[]) => {
    const normalized = sql.trim();
    queries.push({ sql: normalized, values });
    if (normalized === "BEGIN") {
      transactionState = {
        account: account && { ...account },
        sessions: new Map([...sessions].map(([id, session]) => [id, { ...session }])),
      };
      return { rows: [], rowCount: 0 };
    }
    if (normalized === "ROLLBACK") {
      transactionState = undefined;
      return { rows: [], rowCount: 0 };
    }
    if (normalized === "COMMIT") {
      if (transactionState) {
        if (account && transactionState.account) Object.assign(account, transactionState.account);
        sessions.clear();
        for (const [id, session] of transactionState.sessions) sessions.set(id, { ...session });
        transactionState = undefined;
      }
      return { rows: [], rowCount: 0 };
    }
    const currentAccount = transactionState?.account ?? account;
    const currentSessions = transactionState?.sessions ?? sessions;
    if (normalized.startsWith("SELECT") && currentAccount) return { rows: [{ ...currentAccount }], rowCount: 1 };
    if (normalized.startsWith("UPDATE identity_accounts") && currentAccount) {
      currentAccount.password_hash = String(values?.[1]);
      currentAccount.must_change_password = false;
      return { rows: [{ ...currentAccount }], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE identity_sessions")) {
      for (const session of currentSessions.values()) {
        if (session.account_id === values?.[0] && !session.revoked) session.revoked = true;
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("INSERT INTO identity_sessions")) {
      const id = String(values?.[1] ?? `session-${currentSessions.size + 1}`);
      currentSessions.set(id, { id, account_id: String(values?.[0]), revoked: false });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const client = {
    query: execute,
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = {
    query: execute,
    connect: async () => client,
  } as unknown as Pool;
  return { pool, queries, sessions };
}

async function accountFixture(overrides: Partial<Account> = {}): Promise<Account> {
  return {
    id: "account-id",
    email: "user@example.com",
    display_name: "User Name",
    role: "employe",
    password_hash: await hashPassword("temporary-secret"),
    must_change_password: false,
    is_active: true,
    ...overrides,
  };
}

test("authentication verifies active credentials and returns the server-owned role", async () => {
  const { pool, queries } = fakePool(await accountFixture({ must_change_password: true }));
  const account = await authenticateWithPassword(pool, " USER@example.com ", "temporary-secret");
  assert.deepEqual(account, {
    id: "account-id",
    email: "user@example.com",
    displayName: "User Name",
    role: "employe",
    mustChangePassword: true,
  });
  assert.deepEqual(queries[0]?.values, ["user@example.com"]);
  assert.doesNotMatch(queries[0]?.sql ?? "", /password\s*=\s*\$/i);
});

test("unknown email, wrong password, and inactive account have the same authentication error", async () => {
  const unknown = fakePool(undefined);
  const wrongPassword = fakePool(await accountFixture());
  const inactive = fakePool(await accountFixture({ is_active: false }));

  for (const attempt of [
    () => authenticateWithPassword(unknown.pool, "missing@example.com", "secret"),
    () => authenticateWithPassword(wrongPassword.pool, "user@example.com", "wrong"),
    () => authenticateWithPassword(inactive.pool, "user@example.com", "temporary-secret"),
  ]) {
    await assert.rejects(attempt, (error: unknown) => {
      assert.ok(error instanceof InvalidCredentialsError);
      assert.equal(error.message, "Email ou mot de passe invalide.");
      return true;
    });
  }
});

test("first-login replacement stores a new scrypt hash and clears the forced-change flag", async () => {
  const fixture = await accountFixture({ must_change_password: true });
  const oldHash = fixture.password_hash;
  const { pool, queries } = fakePool(fixture);
  const account = await replacePasswordAfterAuthentication(
    pool,
    fixture.email,
    "temporary-secret",
    "new-longer-secret",
  );

  assert.equal(account.mustChangePassword, false);
  assert.match(account.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(account.role, "employe");
  assert.notEqual(fixture.password_hash, oldHash);
  assert.equal(await verifyPassword("new-longer-secret", fixture.password_hash), true);
  assert.equal(await verifyPassword("temporary-secret", fixture.password_hash), false);
  assert.match(fixture.password_hash, /^scrypt:/);
  assert.ok(queries.some(({ sql }) => /FOR UPDATE/.test(sql)));
  assert.ok(queries.some(({ sql }) => /must_change_password = false/.test(sql)));
  assert.ok(queries.some(({ sql }) => sql === "COMMIT"));
  assert.ok(queries.some(({ sql }) => /INSERT INTO identity_sessions/.test(sql)));
  assert.ok(queries.every(({ values }) => !values?.includes("temporary-secret") && !values?.includes("new-longer-secret")));
  assert.ok(queries.some(({ values }) => typeof values?.[1] === "string" && String(values[1]).startsWith("scrypt:") && values[1] !== oldHash));
  assert.ok(queries.every(({ values }) => !values?.includes(account.token)));
});

test("replacement session insertion failure rolls back account and prior session state", async () => {
  const fixture = await accountFixture({ must_change_password: true });
  const originalHash = fixture.password_hash;
  const oldSession = { id: "old-session", account_id: fixture.id, revoked: false };
  const { pool, queries, sessions } = fakePool(fixture, [oldSession]);
  const originalSessions = [...sessions.values()].map((session) => ({ ...session }));
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.trim().startsWith("INSERT INTO identity_sessions")) throw new Error("insert failed");
      return pool.query(sql, values);
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const transactionalPool = { ...pool, connect: async () => client } as unknown as Pool;
  await assert.rejects(replacePasswordAfterAuthentication(transactionalPool, fixture.email, "temporary-secret", "new-longer-secret"), /insert failed/);
  assert.equal(fixture.password_hash, originalHash);
  assert.equal(fixture.must_change_password, true);
  assert.deepEqual([...sessions.values()], originalSessions);
  assert.equal(sessions.size, 1);
  assert.equal(sessions.get(oldSession.id)?.revoked, false);
  assert.ok(queries.some(({ sql }) => sql === "ROLLBACK"));
});

test("first-login replacement rejects reusing the temporary password and new credential replaces the old one", async () => {
  const fixture = await accountFixture({ must_change_password: true });
  const { pool } = fakePool(fixture);
  await assert.rejects(
    replacePasswordAfterAuthentication(pool, fixture.email, "temporary-secret", "temporary-secret"),
    InvalidCredentialsError,
  );
  assert.equal(fixture.must_change_password, true);
  assert.equal(await verifyPassword("temporary-secret", fixture.password_hash), true);

  await replacePasswordAfterAuthentication(pool, fixture.email, "temporary-secret", "replacement-secret");
  await assert.rejects(authenticateWithPassword(pool, fixture.email, "temporary-secret"), InvalidCredentialsError);
  assert.equal((await authenticateWithPassword(pool, fixture.email, "replacement-secret")).mustChangePassword, false);
});

test("password replacement refuses invalid, inactive or already activated accounts without updating", async () => {
  const currentPasswordFailure = fakePool(await accountFixture({ must_change_password: true }));
  const inactive = fakePool(await accountFixture({ must_change_password: true, is_active: false }));
  const alreadyActivated = fakePool(await accountFixture({ must_change_password: false }));

  for (const [context, currentPassword] of [
    [currentPasswordFailure, "wrong"],
    [inactive, "temporary-secret"],
    [alreadyActivated, "temporary-secret"],
  ] as const) {
    await assert.rejects(
      replacePasswordAfterAuthentication(context.pool, "user@example.com", currentPassword, "new-secret"),
      InvalidCredentialsError,
    );
    assert.equal(context.queries.some(({ sql }) => sql.startsWith("UPDATE")), false);
  }
});
