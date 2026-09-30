import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { AuthenticatedAccount } from "./authentication.js";
import { withTransaction } from "../../db/transaction.js";
import type { Transaction } from "../../db/transaction.js";

export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

export interface AuthenticatedSession extends AuthenticatedAccount {
  token: string;
  expiresAt: string;
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(pool: Pool, account: AuthenticatedAccount): Promise<AuthenticatedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  await pool.query(
    `INSERT INTO identity_sessions (account_id, token_hash, expires_at)
     SELECT id, $2, $3 FROM identity_accounts
     WHERE id = $1 AND is_active = true AND must_change_password = $4`,
    [account.id, tokenDigest(token), expiresAt, account.mustChangePassword],
  );
  return { ...account, token, expiresAt };
}

export async function findActiveSession(pool: Pool, token: string): Promise<AuthenticatedSession | undefined> {
  const result = await pool.query<{
    id: string; email: string; display_name: string; role: AuthenticatedAccount["role"];
    must_change_password: boolean; expires_at: Date | string;
  }>(
    `SELECT a.id, a.email, a.display_name, a.role, a.must_change_password, s.expires_at
     FROM identity_sessions s
     JOIN identity_accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL
       AND s.expires_at > now() AND a.is_active = true`,
    [tokenDigest(token)],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    id: row.id, email: row.email, displayName: row.display_name, role: row.role,
    mustChangePassword: row.must_change_password,
    token,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export async function hasLiveDeactivatedSession(pool: Pool, token: string): Promise<boolean> {
  const result = await pool.query<{ inactive: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM identity_sessions s
       JOIN identity_accounts a ON a.id = s.account_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL
         AND s.expires_at > now() AND a.is_active = false
     ) AS inactive`,
    [tokenDigest(token)],
  );
  return result.rows[0]?.inactive === true;
}

export async function revokeSession(pool: Pool, token: string): Promise<void> {
  await pool.query(
    "UPDATE identity_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [tokenDigest(token)],
  );
}

export async function revokeAccountSessions(pool: Pool, accountId: string): Promise<void> {
  await pool.query(
    "UPDATE identity_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL",
    [accountId],
  );
}

export async function replacePasswordAndCreateSession(
  transaction: Transaction,
  account: AuthenticatedAccount,
  passwordHash: string,
): Promise<AuthenticatedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    const updated = await transaction.query<{ id: string }>(
      `UPDATE identity_accounts SET password_hash = $2, must_change_password = false
       WHERE id = $1 AND is_active = true AND must_change_password = true
       RETURNING id`,
      [account.id, passwordHash],
    );
    if (!updated.rows[0]) throw new Error("Account is not eligible for password activation.");
    await transaction.query(
      "UPDATE identity_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL",
      [account.id],
    );
    const inserted = await transaction.query(
      `INSERT INTO identity_sessions (account_id, token_hash, expires_at)
       SELECT id, $2, $3 FROM identity_accounts
       WHERE id = $1 AND is_active = true AND must_change_password = false`,
      [account.id, tokenDigest(token), expiresAt],
    );
    if (inserted.rowCount !== 1) throw new Error("Replacement session could not be created.");
    return { ...account, mustChangePassword: false, token, expiresAt };
}
