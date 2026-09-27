import type { Pool, QueryResultRow } from "pg";
import { hashPassword, verifyPassword } from "./password.js";
import { replacePasswordAndCreateSession } from "./sessions.js";
import { withTransaction } from "../../db/transaction.js";

// Fixed, valid scrypt hash used to keep unknown-email attempts on the same
// expensive verification path as known accounts. This is not a timing oracle fix.
const DUMMY_PASSWORD_HASH = "scrypt:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export type UserRole = "responsable" | "employe";

export interface AuthenticatedAccount {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  mustChangePassword: boolean;
}

interface AccountRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  password_hash: string;
  must_change_password: boolean;
  is_active: boolean;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email ou mot de passe invalide.");
    this.name = "InvalidCredentialsError";
  }
}

function toAccount(row: AccountRow): AuthenticatedAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: row.must_change_password,
  };
}

export async function authenticateWithPassword(
  pool: Pool,
  emailInput: string,
  password: string,
): Promise<AuthenticatedAccount> {
  const email = emailInput.trim().toLowerCase();
  const result = await pool.query<AccountRow>(
    `SELECT id, email, display_name, role, password_hash, must_change_password, is_active
     FROM identity_accounts WHERE email = $1`,
    [email],
  );
  const account = result.rows[0];
  const passwordMatches = await verifyPassword(password, account?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!account || !passwordMatches || !account.is_active) {
    throw new InvalidCredentialsError();
  }
  return toAccount(account);
}

export async function replacePasswordAfterAuthentication(
  pool: Pool,
  emailInput: string,
  currentPassword: string,
  newPassword: string,
): Promise<import("./sessions.js").AuthenticatedSession> {
  const email = emailInput.trim().toLowerCase();
  const newPasswordHash = await hashPassword(newPassword);
  return withTransaction(pool, async (transaction) => {
    const result = await transaction.query<AccountRow>(
      `SELECT id, email, display_name, role, password_hash, must_change_password, is_active
       FROM identity_accounts WHERE email = $1 FOR UPDATE`,
      [email],
    );
    const account = result.rows[0];
    if (!account || !(await verifyPassword(currentPassword, account.password_hash)) || !account.is_active || !account.must_change_password) {
      throw new InvalidCredentialsError();
    }
    if (await verifyPassword(newPassword, account.password_hash)) throw new InvalidCredentialsError();
    return replacePasswordAndCreateSession(transaction, toAccount(account), newPasswordHash);
  });
}
