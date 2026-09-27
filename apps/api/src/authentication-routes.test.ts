import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Pool, PoolClient } from "pg";
import { apiErrorSchema } from "@cetem-qc/schemas/api/v1";
import { hashPassword } from "./modules/identity-auth/password.js";
import { createApp } from "./index.js";

interface Account {
  id: string; email: string; display_name: string; role: "responsable" | "employe";
  password_hash: string; must_change_password: boolean; is_active: boolean;
}

function poolFor(account?: Account, fail = false) {
  const sessions = new Map<string, { account_id: string; expires_at: string; revoked_at?: string }>();
  sessionsForTests = sessions;
  let beforeTransaction: { account?: Account; sessions: Map<string, { account_id: string; expires_at: string; revoked_at?: string }> } | undefined;
  const execute = async (sql: string, values?: unknown[]) => {
    if (fail) throw new Error("private database failure details");
    const normalized = sql.trim();
    if (normalized === "BEGIN") { beforeTransaction = { account: account && { ...account }, sessions: new Map([...sessions].map(([key, value]) => [key, { ...value }])) }; return { rows: [], rowCount: 0 }; }
    if (normalized === "ROLLBACK") { if (account && beforeTransaction?.account) Object.assign(account, beforeTransaction.account); sessions.clear(); for (const [key, value] of beforeTransaction?.sessions ?? []) sessions.set(key, value); return { rows: [], rowCount: 0 }; }
    if (normalized === "COMMIT") return { rows: [], rowCount: 0 };
    if (normalized.includes("FROM identity_sessions s") && account) {
      const hash = String(values?.[0]);
      const session = sessions.get(hash);
      if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() || !account.is_active) return { rows: [], rowCount: 0 };
      return { rows: [{ id: account.id, email: account.email, display_name: account.display_name, role: account.role, must_change_password: account.must_change_password, expires_at: session.expires_at }], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO identity_sessions") && account?.is_active && account.must_change_password === values?.[3]) {
      sessions.set(String(values?.[1]), { account_id: account.id, expires_at: String(values?.[2]) });
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE identity_sessions")) {
      const session = sessions.get(String(values?.[0])); if (session) session.revoked_at = new Date().toISOString();
      if (normalized.includes("WHERE account_id = $1")) for (const item of sessions.values()) item.revoked_at = new Date().toISOString();
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO identity_sessions") && normalized.includes("must_change_password = false")) {
      if (process.env.TEST_FAIL_REPLACEMENT_SESSION_INSERT === "1") throw new Error("private replacement session insert failure");
      sessions.set(String(values?.[1]), { account_id: account!.id, expires_at: String(values?.[2]) });
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("SELECT") && account) return { rows: [{ ...account }], rowCount: 1 };
    if (normalized.startsWith("UPDATE identity_accounts") && account) {
      account.password_hash = String(values?.[1]); account.must_change_password = false;
      return { rows: [{ ...account }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const client = { query: execute, release: () => undefined } as unknown as PoolClient;
  return { query: execute, connect: async () => client } as unknown as Pool;
}

let sessionsForTests = new Map<string, { account_id: string; expires_at: string; revoked_at?: string }>();

async function withServer(pool: Pool, run: (root: string) => Promise<void>) {
  const app = createApp(pool);
  app.get("/api/v1/operational", (_request, response) => response.status(200).json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}/api/v1`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(root: string, path: string, body: unknown) {
  return fetch(`${root}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function sessionRequest(root: string, path: string, token: string, method = "GET", body?: unknown) {
  return fetch(`${root}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

async function fixture(overrides: Partial<Account> = {}): Promise<Account> {
  return {
    id: "account-id", email: "user@example.com", display_name: "User Name", role: "employe",
    password_hash: await hashPassword("temporary-secret"), must_change_password: false, is_active: true, ...overrides,
  };
}

test("authentication endpoints reject malformed input with French safe copy", async () => {
  await withServer(poolFor(await fixture()), async (root) => {
    const response = await post(root, "/authenticate", { email: "user@example.com" });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." } });
    const login = await post(root, "/authenticate", { email: "user@example.com", password: "temporary-secret" });
    const { token } = await login.json() as { token: string };
    const replacement = await sessionRequest(root, "/authenticate/password", token, "POST", { currentPassword: "temporary-secret" });
    assert.equal(replacement.status, 400);
    assert.doesNotMatch(await replacement.text(), /temporary-secret/);
  });
});

test("route returns authenticated account with server-owned role", async () => {
  await withServer(poolFor(await fixture()), async (root) => {
    const response = await post(root, "/authenticate", { email: "user@example.com", password: "temporary-secret" });
    assert.equal(response.status, 200);
    const payload = await response.json() as { token: string; user: { id: string; email: string; displayName: string; role: string; mustChangePassword: boolean } };
    assert.match(payload.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.deepEqual(payload.user, { id: "account-id", email: "user@example.com", displayName: "User Name", role: "employe", mustChangePassword: false });
    assert.equal(response.headers.has("set-cookie"), false);
  });
});

test("wrong password, unknown email, and inactive account use identical generic French response", async () => {
  const accounts = [await fixture(), undefined, await fixture({ is_active: false })];
  const payloads: unknown[] = [];
  for (const account of accounts) {
    await withServer(poolFor(account), async (root) => {
      const response = await post(root, "/authenticate", {
        email: account?.email ?? "missing@example.com", password: account?.is_active ? "wrong" : "temporary-secret",
      });
      assert.equal(response.status, 401);
      payloads.push(await response.json());
    });
  }
  assert.deepEqual(payloads[0], payloads[1]);
  assert.deepEqual(payloads[1], payloads[2]);
  assert.deepEqual(payloads[0], { error: { code: "AUTHENTICATION_FAILED", message: "Email ou mot de passe invalide." } });
});

test("route replaces mandatory temporary password", async () => {
  const account = await fixture({ must_change_password: true });
  await withServer(poolFor(account), async (root) => {
    const login = await post(root, "/authenticate", { email: account.email, password: "temporary-secret" });
    const { token } = await login.json() as { token: string };
    const response = await sessionRequest(root, "/authenticate/password", token, "POST", { currentPassword: "temporary-secret", newPassword: "new-password" });
    assert.equal(response.status, 200);
    const replacement = await response.json() as { user: { mustChangePassword: boolean }; token: string };
    assert.equal(replacement.user.mustChangePassword, false);
    assert.notEqual(replacement.token, token);
    assert.equal((await sessionRequest(root, "/session", token)).status, 401);
    assert.equal((await sessionRequest(root, "/session", replacement.token)).status, 200);
  });
});

test("temporary credential session is limited to activation routes; replacement session can access protected routes", async () => {
  const account = await fixture({ must_change_password: true });
  await withServer(poolFor(account), async (root) => {
    const login = await post(root, "/authenticate", { email: account.email, password: "temporary-secret" });
    const temporarySession = await login.json() as { token: string; user: { mustChangePassword: boolean } };
    assert.equal(temporarySession.user.mustChangePassword, true);
    assert.equal((await sessionRequest(root, "/session", temporarySession.token)).status, 200);
    assert.equal((await sessionRequest(root, "/operational", temporarySession.token)).status, 401);
    assert.equal((await sessionRequest(root, "/session", temporarySession.token, "DELETE")).status, 204);
  });
});

test("temporary credential still permits password replacement and replacement token authorizes protected route", async () => {
  const account = await fixture({ must_change_password: true });
  await withServer(poolFor(account), async (root) => {
    const login = await post(root, "/authenticate", { email: account.email, password: "temporary-secret" });
    const temporarySession = await login.json() as { token: string };
    const change = await sessionRequest(root, "/authenticate/password", temporarySession.token, "POST", { currentPassword: "temporary-secret", newPassword: "replacement-secret" });
    assert.equal(change.status, 200);
    const active = await change.json() as { token: string; user: { mustChangePassword: boolean } };
    assert.equal(active.user.mustChangePassword, false);
    assert.equal((await sessionRequest(root, "/session", temporarySession.token)).status, 401);
    assert.equal((await sessionRequest(root, "/session", active.token)).status, 200);
    assert.equal((await sessionRequest(root, "/operational", active.token)).status, 200);
  });
});

test("failed replacement session insert preserves original password flag and old session", async () => {
  const account = await fixture({ must_change_password: true });
  const originalHash = account.password_hash;
  const previous = process.env.TEST_FAIL_REPLACEMENT_SESSION_INSERT;
  process.env.TEST_FAIL_REPLACEMENT_SESSION_INSERT = "1";
  try {
    await withServer(poolFor(account), async (root) => {
      const login = await post(root, "/authenticate", { email: account.email, password: "temporary-secret" });
      const { token } = await login.json() as { token: string };
      const response = await sessionRequest(root, "/authenticate/password", token, "POST", { currentPassword: "temporary-secret", newPassword: "replacement-secret" });
      assert.equal(response.status, 500);
      assert.equal(account.password_hash, originalHash);
      assert.equal(account.must_change_password, true);
      assert.equal((await sessionRequest(root, "/session", token)).status, 200);
      assert.equal((await sessionRequest(root, "/operational", token)).status, 401);
      assert.doesNotMatch(await response.text(), /replacement-secret|temporary-secret|private replacement/);
    });
  } finally {
    if (previous === undefined) delete process.env.TEST_FAIL_REPLACEMENT_SESSION_INSERT;
    else process.env.TEST_FAIL_REPLACEMENT_SESSION_INSERT = previous;
  }
});

test("inactive, expired, malformed and logged-out sessions cannot authorize server requests", async () => {
  const account = await fixture();
  await withServer(poolFor(account), async (root) => {
    const login = await post(root, "/authenticate", { email: account.email, password: "temporary-secret" });
    const { token } = await login.json() as { token: string };
    assert.equal((await sessionRequest(root, "/session", "not-a-valid-token")).status, 401);
    account.is_active = false;
    assert.equal((await sessionRequest(root, "/session", token)).status, 401);
    account.is_active = true;
    const expiredLogin = await post(root, "/authenticate", { email: account.email, password: "temporary-secret" });
    const expired = await expiredLogin.json() as { token: string };
    const expiredHash = (await import("node:crypto")).createHash("sha256").update(expired.token).digest("hex");
    const sessionRow = sessionsForTests.get(expiredHash);
    if (sessionRow) sessionRow.expires_at = new Date(0).toISOString();
    assert.equal((await sessionRequest(root, "/session", expired.token)).status, 401);
    const logoutLogin = await post(root, "/authenticate", { email: account.email, password: "temporary-secret" });
    const logout = await logoutLogin.json() as { token: string };
    assert.equal((await sessionRequest(root, "/session", logout.token, "DELETE")).status, 204);
    assert.equal((await sessionRequest(root, "/session", logout.token)).status, 401);
  });
});

test("route hides internal database errors", async () => {
  await withServer(poolFor(undefined, true), async (root) => {
    const response = await post(root, "/authenticate", { email: "user@example.com", password: "secret" });
    assert.equal(response.status, 500);
    const payload = await response.text();
    assert.match(payload, /Une erreur est survenue/);
    assert.doesNotMatch(payload, /private database failure details|secret/);
  });
});

test("session GET and DELETE return the shared safe error response on database failure", async () => {
  const expected = { error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } };
  await withServer(poolFor(undefined, true), async (root) => {
    for (const method of ["GET", "DELETE"] as const) {
      const response = await sessionRequest(root, "/session", "A".repeat(43), method);
      assert.equal(response.status, 500);
      const payload: unknown = await response.json();
      assert.deepEqual(apiErrorSchema.parse(payload), expected);
      assert.doesNotMatch(JSON.stringify(payload), /private database failure details/);
    }
  });
});
