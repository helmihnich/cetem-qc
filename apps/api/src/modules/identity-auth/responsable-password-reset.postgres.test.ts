import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { resetResponsablePassword, ResponsablePasswordResetUnavailableError } from "./responsable-password-reset.js";
import { authenticateWithPassword } from "./authentication.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createSession } from "./sessions.js";
import { withPostgresTestSchema } from "../../test-support/postgres.js";

const previousPassword = "previous-responsable-password";
const genericFailure = "Responsable password reset failed. Check operator input and database connectivity.";

async function insertAccount(pool: Pool, email: string, role: "responsable", active = true): Promise<string> {
  return (await pool.query<{ id: string }>(
    `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, is_active)
     VALUES ($1, 'Story 2.4 operator test', $2, $3, false, $4) RETURNING id`,
    [email, role, await hashPassword(previousPassword), active],
  )).rows[0]!.id;
}

async function snapshot(pool: Pool) {
  const accounts = await pool.query("SELECT id, password_hash, must_change_password, is_active FROM identity_accounts ORDER BY id");
  const sessions = await pool.query("SELECT id, account_id, revoked_at FROM identity_sessions ORDER BY id");
  const resets = await pool.query("SELECT * FROM identity_password_resets ORDER BY id");
  return { accounts: accounts.rows, sessions: sessions.rows, resets: resets.rows };
}

test("C1 the operator reset gives an active Responsable a forced-change credential, revokes sessions and audits without an actor", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const email = `owner-${randomUUID()}@example.test`;
    const ownerId = await insertAccount(pool, email, "responsable");
    await createSession(pool, await authenticateWithPassword(pool, email, previousPassword));

    const result = await resetResponsablePassword(pool, email);
    assert.equal(result.email, email);
    const row = (await pool.query<{ password_hash: string; must_change_password: boolean }>(
      "SELECT password_hash, must_change_password FROM identity_accounts WHERE id = $1", [ownerId],
    )).rows[0]!;
    assert.equal(row.must_change_password, true);
    assert.equal(await verifyPassword(previousPassword, row.password_hash), false);
    assert.equal(await verifyPassword(result.temporaryPassword, row.password_hash), true);
    assert.equal((await pool.query("SELECT 1 FROM identity_sessions WHERE account_id = $1 AND revoked_at IS NULL", [ownerId])).rowCount, 0);
    const audit = await pool.query("SELECT account_id, reset_by_account_id, channel FROM identity_password_resets");
    assert.deepEqual(audit.rows, [{ account_id: ownerId, reset_by_account_id: null, channel: "operator" }]);
    const signedIn = await authenticateWithPassword(pool, email, result.temporaryPassword);
    assert.equal(signedIn.mustChangePassword, true, "the temporary credential gives an activation-only session");
    await assert.rejects(authenticateWithPassword(pool, email, previousPassword));
  });
});

test("C2 unknown, Employé and inactive Responsable emails are refused with nothing changed", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const employeeEmail = `employee-${randomUUID()}@example.test`;
    const inactiveEmail = `inactive-${randomUUID()}@example.test`;
    const ownerId = await insertAccount(pool, `owner-${randomUUID()}@example.test`, "responsable");
    const teamId = (await pool.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [ownerId])).rows[0]!.id;
    await pool.query(
      `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname)
       VALUES ($1, 'Story 2.4 employee', 'employe', $2, false, $3, 'Test', 'Employe')`,
      [employeeEmail, await hashPassword(previousPassword), teamId],
    );
    await insertAccount(pool, inactiveEmail, "responsable", false);
    for (const email of [`unknown-${randomUUID()}@example.test`, employeeEmail, inactiveEmail]) {
      const before = await snapshot(pool);
      await assert.rejects(resetResponsablePassword(pool, email), (error: unknown) => {
        assert.ok(error instanceof ResponsablePasswordResetUnavailableError);
        assert.equal(String((error as Error).message).includes(email), false, "the error never repeats the input");
        return true;
      });
      assert.deepEqual(await snapshot(pool), before);
    }
  });
});

test("C3 the operator email is trimmed and matched case-insensitively", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const ownerId = await insertAccount(pool, "owner@example.test", "responsable");
    const result = await resetResponsablePassword(pool, "  Owner@Example.TEST ");
    assert.equal(result.email, "owner@example.test");
    const audit = await pool.query<{ account_id: string }>("SELECT account_id FROM identity_password_resets");
    assert.deepEqual(audit.rows.map((row) => row.account_id), [ownerId]);
  });
});

test("C4 the CLI prints only the generic failure and exits 1 when the database is unreachable", async () => {
  const email = "operator-input@example.test";
  const child = spawn(process.execPath, ["--import", "tsx", "src/scripts/reset-responsable-password.ts"], {
    env: { ...process.env, DATABASE_URL: "postgresql://127.0.0.1:1/cetem_qc_test" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  child.stdin.end(`${email}\n`);
  const exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve));
  assert.equal(exitCode, 1);
  assert.equal(stderr.trim(), genericFailure);
  assert.equal(stdout.includes(email), false);
  assert.equal(stderr.includes(email), false);
});
