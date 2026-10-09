import type { Pool, QueryResultRow } from "pg";

export interface TeamEmployee {
  id: string;
  firstName: string;
  surname: string;
  email: string;
  active: boolean;
  /** False until the technician replaces the temporary credential at first login. */
  activated: boolean;
}

interface TeamEmployeeRow extends QueryResultRow {
  id: string;
  first_name: string;
  surname: string;
  email: string;
  is_active: boolean;
  must_change_password: boolean;
}

export async function listOwnTeamEmployees(pool: Pool, responsableAccountId: string): Promise<TeamEmployee[]> {
  const result = await pool.query<TeamEmployeeRow>(
    `SELECT employee.id, employee.first_name, employee.surname, employee.email, employee.is_active, employee.must_change_password
     FROM identity_teams team
     JOIN identity_accounts employee ON employee.team_id = team.id
     WHERE team.responsable_account_id = $1
       AND employee.team_id = team.id AND employee.role = 'employe'
     ORDER BY employee.surname, employee.first_name, employee.id`,
    [responsableAccountId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    surname: row.surname,
    email: row.email,
    active: row.is_active,
    activated: row.must_change_password === false,
  }));
}
