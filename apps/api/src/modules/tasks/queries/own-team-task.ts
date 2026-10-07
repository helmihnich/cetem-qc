import type { Pool, PoolClient } from "pg";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The task ID when the task is assigned within the Responsable's own team, otherwise undefined.
 * Same predicate as the Responsable task list, so every listed task is reviewable and no other one.
 */
export async function getOwnTeamTaskId(pool: Pool | PoolClient, responsableId: string, taskId: string): Promise<string | undefined> {
  if (!uuidPattern.test(taskId)) return undefined;
  const result = await pool.query<{ id: string }>(
    `SELECT task.id
     FROM tasks task
     JOIN task_assignments assignment ON assignment.task_id = task.id
     JOIN identity_teams team ON team.id = assignment.team_id
     JOIN identity_accounts employee
       ON employee.id = assignment.employee_id
      AND employee.team_id = assignment.team_id
      AND employee.role = 'employe'
     WHERE team.responsable_account_id = $1 AND task.id = $2`,
    [responsableId, taskId],
  );
  return result.rows[0]?.id;
}

/** The task fields shown with its evidence: establishment, service and the assignee as the Responsable task list shows it. */
export type OwnTeamTaskSummary = { id: string; establishment: string; service: string; assignee: string };

/** Same predicate as `getOwnTeamTaskId`; undefined for anything outside the Responsable's own team. */
export async function getOwnTeamTaskSummary(pool: Pool | PoolClient, responsableId: string, taskId: string): Promise<OwnTeamTaskSummary | undefined> {
  if (!uuidPattern.test(taskId)) return undefined;
  const result = await pool.query<{ id: string; establishment: string; service: string; assignee: string; assignee_is_active: boolean }>(
    `SELECT task.id, task.establishment, task.service,
            concat_ws(' ', employee.first_name, employee.surname) AS assignee,
            employee.is_active AS assignee_is_active
     FROM tasks task
     JOIN task_assignments assignment ON assignment.task_id = task.id
     JOIN identity_teams team ON team.id = assignment.team_id
     JOIN identity_accounts employee
       ON employee.id = assignment.employee_id
      AND employee.team_id = assignment.team_id
      AND employee.role = 'employe'
     WHERE team.responsable_account_id = $1 AND task.id = $2`,
    [responsableId, taskId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return { id: row.id, establishment: row.establishment, service: row.service, assignee: row.assignee_is_active ? row.assignee : `${row.assignee} — Inactif` };
}
