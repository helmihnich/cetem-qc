import type { Pool, PoolClient } from "pg";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The authenticated user a history read is authorized for: the Responsable by team, the Employé by current assignment. */
export type HistoryActor = { id: string; role: "responsable" | "employe" };

/** The task fields shown with a completed control. Same assignee wording as the Responsable task list. */
export type AuthorizedTaskSummary = { id: string; type: string; establishment: string; service: string; assignee: string };

interface AuthorizedTaskRow {
  id: string;
  task_type: string;
  establishment: string;
  service: string;
  assignee: string;
  assignee_is_active: boolean;
}

// Responsable: same predicate as `getOwnTeamTaskId` (team, assignment, employee of that team).
// Employé: the task's current assignment names the actor (same predicate as `getAssignedEmployeeTask`).
const authorizedSelect = `
  SELECT task.id, task.task_type, task.establishment, task.service,
         concat_ws(' ', employee.first_name, employee.surname) AS assignee,
         employee.is_active AS assignee_is_active
  FROM tasks task
  JOIN task_assignments assignment ON assignment.task_id = task.id
  JOIN identity_teams team ON team.id = assignment.team_id
  JOIN identity_accounts employee
    ON employee.id = assignment.employee_id
   AND employee.team_id = assignment.team_id
   AND employee.role = 'employe'
  WHERE (CASE WHEN $1::text = 'responsable' THEN team.responsable_account_id = $2::uuid ELSE assignment.employee_id = $2::uuid END)`;

const toSummary = (row: AuthorizedTaskRow): AuthorizedTaskSummary => ({
  id: row.id,
  type: row.task_type,
  establishment: row.establishment,
  service: row.service,
  assignee: row.assignee_is_active ? row.assignee : `${row.assignee} — Inactif`,
});

/** Every task the actor may see, whatever its state. Read only. */
export async function listAuthorizedTaskIds(pool: Pool | PoolClient, actor: HistoryActor): Promise<string[]> {
  const result = await pool.query<AuthorizedTaskRow>(authorizedSelect, [actor.role, actor.id]);
  return result.rows.map((row) => row.id);
}

/** The task summaries the actor may see, keyed by task id. Read only. */
export async function listAuthorizedTaskSummaries(pool: Pool | PoolClient, actor: HistoryActor): Promise<Map<string, AuthorizedTaskSummary>> {
  const result = await pool.query<AuthorizedTaskRow>(authorizedSelect, [actor.role, actor.id]);
  return new Map(result.rows.map((row) => [row.id, toSummary(row)]));
}

/** The task summary when the actor may see the task, otherwise undefined (malformed id, unknown, other team's, not assigned). */
export async function getAuthorizedTaskSummary(pool: Pool | PoolClient, actor: HistoryActor, taskId: string): Promise<AuthorizedTaskSummary | undefined> {
  if (!uuidPattern.test(taskId)) return undefined;
  const result = await pool.query<AuthorizedTaskRow>(`${authorizedSelect} AND task.id = $3::uuid`, [actor.role, actor.id, taskId]);
  const row = result.rows[0];
  return row ? toSummary(row) : undefined;
}
