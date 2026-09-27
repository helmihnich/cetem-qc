import type { Pool } from "pg";
import { withTransaction } from "../../db/transaction.js";
import { generateTemporaryPassword, hashPassword } from "./password.js";

export interface BootstrapResponsableInput {
  email: string;
  displayName: string;
}

export async function bootstrapFirstResponsable(
  pool: Pool,
  input: BootstrapResponsableInput,
): Promise<{ email: string; temporaryPassword: string }> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("A valid email is required.");
  if (!displayName) throw new Error("A display name is required.");

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await withTransaction(pool, async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock($1)", [1_339_347_526]);
    const existing = await transaction.query("SELECT 1 FROM identity_accounts LIMIT 1");
    if (existing.rowCount) throw new Error("An identity account already exists; bootstrap is single-use.");
    await transaction.query(
      `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password)
       VALUES ($1, $2, 'responsable', $3, true)`,
      [email, displayName, passwordHash],
    );
  });
  return { email, temporaryPassword };
}
