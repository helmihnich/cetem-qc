import type { Pool, QueryResultRow } from "pg";
import { createHash } from "node:crypto";
import { withTransaction } from "../../db/transaction.js";
import { applyPasswordReset, generateTemporaryCredential, hashPassword, logPasswordReset } from "../identity-auth/index.js";

export class DuplicateEmployeeEmailError extends Error {}
export class EmployeeCredentialUnavailableError extends Error {}
export class EmployeeStatusUnavailableError extends Error {}

const employeeEmailUniqueConstraints = new Set([
  "identity_accounts_email_key",
  "identity_accounts_email_case_insensitive_unique",
]);

export interface EmployeeDetails {
  firstName: string;
  surname: string;
  email: string;
}

export interface EmployeeCredentialResult {
  employee: EmployeeDetails & { id: string; active: boolean };
  temporaryCredential: string;
}

interface CreatedEmployeeRow extends QueryResultRow {
  id: string;
  first_name: string;
  surname: string;
  email: string;
  is_active: boolean;
}

export async function createOwnTeamEmployee(pool: Pool, responsableAccountId: string, details: EmployeeDetails): Promise<EmployeeCredentialResult> {
  const normalizedEmail = details.email.trim().toLowerCase();
  try {
    const employee = await withTransaction(pool, async (transaction) => {
      const key = createHash("sha256").update(`employee-email:${normalizedEmail}`).digest().readBigInt64BE(0).toString();
      await transaction.query("SELECT pg_advisory_xact_lock($1::bigint)", [key]);
      const credential = generateTemporaryCredential();
      const passwordHash = await hashPassword(credential);
      const team = await transaction.query<{ team_id: string } & QueryResultRow>(
        "SELECT id AS team_id FROM identity_teams WHERE responsable_account_id = $1 FOR SHARE", [responsableAccountId],
      );
      if (!team.rows[0]) throw new Error("Responsable team is unavailable");
      const result = await transaction.query<CreatedEmployeeRow>(
        `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname)
         VALUES ($1, $2, 'employe', $3, true, $4, $5, $6)
         RETURNING id, first_name, surname, email, is_active`,
        [normalizedEmail, `${details.firstName.trim()} ${details.surname.trim()}`, passwordHash, team.rows[0].team_id, details.firstName.trim(), details.surname.trim()],
      );
      const row = result.rows[0];
      return { employee: { id: row.id, firstName: row.first_name, surname: row.surname, email: row.email, active: row.is_active }, temporaryCredential: credential };
    });
    return employee;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateEmployeeEmailError();
    throw error;
  }
}

export async function regenerateOwnTeamEmployeeCredential(pool: Pool, responsableAccountId: string, employeeId: string): Promise<EmployeeCredentialResult | undefined> {
  const credential = generateTemporaryCredential();
  const passwordHash = await hashPassword(credential);
  const employee = await withTransaction(pool, async (transaction) => {
    const result = await transaction.query<CreatedEmployeeRow>(
      `UPDATE identity_accounts employee SET password_hash = $1
       FROM identity_teams team
       WHERE employee.id = $2 AND employee.team_id = team.id
         AND team.responsable_account_id = $3 AND employee.role = 'employe'
         AND employee.must_change_password = true AND employee.is_active = true
       RETURNING employee.id, employee.first_name, employee.surname, employee.email, employee.is_active`,
      [passwordHash, employeeId, responsableAccountId],
    );
    const row = result.rows[0];
    return row && { id: row.id, firstName: row.first_name, surname: row.surname, email: row.email, active: row.is_active };
  });
  return employee ? { employee, temporaryCredential: credential } : undefined;
}

export type EmployeePasswordResetResult =
  | ({ outcome: "reset" } & EmployeeCredentialResult)
  | { outcome: "not_found" }
  | { outcome: "inactive" };

export async function resetOwnTeamEmployeePassword(pool: Pool, responsableAccountId: string, employeeId: string): Promise<EmployeePasswordResetResult> {
  const credential = generateTemporaryCredential();
  const passwordHash = await hashPassword(credential);
  const result = await withTransaction(pool, async (transaction): Promise<EmployeePasswordResetResult | { outcome: "committed"; employee: EmployeeCredentialResult["employee"] }> => {
    const target = await transaction.query<CreatedEmployeeRow>(
      `SELECT employee.id, employee.first_name, employee.surname, employee.email, employee.is_active
       FROM identity_accounts employee
       JOIN identity_teams team ON employee.team_id = team.id
       WHERE employee.id = $1 AND team.responsable_account_id = $2 AND employee.role = 'employe'
       FOR UPDATE OF employee`,
      [employeeId, responsableAccountId],
    );
    const row = target.rows[0];
    if (!row) return { outcome: "not_found" };
    if (!row.is_active) return { outcome: "inactive" };
    await applyPasswordReset(transaction, { accountId: row.id, passwordHash, channel: "responsable", resetByAccountId: responsableAccountId });
    return { outcome: "committed", employee: { id: row.id, firstName: row.first_name, surname: row.surname, email: row.email, active: row.is_active } };
  });
  if (result.outcome !== "committed") return result;
  logPasswordReset("responsable", result.employee.id, responsableAccountId);
  return { outcome: "reset", employee: result.employee, temporaryCredential: credential };
}

export async function updateOwnTeamEmployeeStatus(
  pool: Pool,
  responsableAccountId: string,
  employeeId: string,
  active: boolean,
): Promise<EmployeeCredentialResult["employee"] | undefined> {
  return withTransaction(pool, async (transaction) => {
    const result = await transaction.query<CreatedEmployeeRow>(
      `UPDATE identity_accounts employee SET is_active = $1
       FROM identity_teams team
       WHERE employee.id = $2 AND employee.team_id = team.id
         AND team.responsable_account_id = $3 AND employee.role = 'employe'
       RETURNING employee.id, employee.first_name, employee.surname, employee.email, employee.is_active`,
      [active, employeeId, responsableAccountId],
    );
    const row = result.rows[0];
    return row && { id: row.id, firstName: row.first_name, surname: row.surname, email: row.email, active: row.is_active };
  });
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const databaseError = error as { code?: string; constraint?: string };
  return databaseError.code === "23505" && !!databaseError.constraint && employeeEmailUniqueConstraints.has(databaseError.constraint);
}
