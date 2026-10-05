import type { Pool } from "pg";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The task ID when the task is assigned within the Responsable's own team, otherwise undefined.
 * Same predicate as the Responsable task list, so every listed task is reviewable and no other one.
 */
export async function getOwnTeamTaskId(pool: Pool, responsableId: string, taskId: string): Promise<string | undefined> {
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
