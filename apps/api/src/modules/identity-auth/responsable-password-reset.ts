import type { Pool } from "pg";
import { withTransaction } from "../../db/transaction.js";
import type { Transaction } from "../../db/transaction.js";
import { generateTemporaryCredential, hashPassword } from "./password.js";

export type PasswordResetChannel = "responsable" | "operator";

export class ResponsablePasswordResetUnavailableError extends Error {
  constructor() {
    super("No active Responsable account matches the operator input.");
  }
}

/**
 * Replaces the password hash, forces the Story 2.3 activation flow, revokes every open session
 * and records the audit row. Runs on the caller's transaction so all four writes commit together.
 */
export async function applyPasswordReset(
  transaction: Transaction,
  reset: { accountId: string; passwordHash: string; channel: PasswordResetChannel; resetByAccountId: string | null },
): Promise<void> {
  await transaction.query(
    "UPDATE identity_accounts SET password_hash = $2, must_change_password = true WHERE id = $1",
    [reset.accountId, reset.passwordHash],
  );
  await transaction.query(
    "UPDATE identity_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL",
    [reset.accountId],
  );
  await transaction.query(
    "INSERT INTO identity_password_resets (account_id, reset_by_account_id, channel) VALUES ($1, $2, $3)",
    [reset.accountId, reset.resetByAccountId, reset.channel],
  );
}

/** One structured line per committed reset; ids and channel only, never the email or credential. */
export function logPasswordReset(channel: PasswordResetChannel, accountId: string, resetByAccountId: string | null): void {
  console.info(JSON.stringify({ event: "identity.password_reset", channel, accountId, resetByAccountId }));
}

export async function resetResponsablePassword(
  pool: Pool,
  email: string,
): Promise<{ email: string; temporaryPassword: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const temporaryPassword = generateTemporaryCredential();
  const passwordHash = await hashPassword(temporaryPassword);
  const account = await withTransaction(pool, async (transaction) => {
    const result = await transaction.query<{ id: string; email: string }>(
      `SELECT id, email FROM identity_accounts
       WHERE email = $1 AND role = 'responsable' AND is_active = true
       FOR UPDATE`,
      [normalizedEmail],
    );
    const row = result.rows[0];
    if (!row) throw new ResponsablePasswordResetUnavailableError();
    await applyPasswordReset(transaction, { accountId: row.id, passwordHash, channel: "operator", resetByAccountId: null });
    return row;
  });
  logPasswordReset("operator", account.id, null);
  return { email: account.email, temporaryPassword };
}
