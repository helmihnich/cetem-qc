import type { QueryResultRow } from "pg";
import type { Transaction } from "../../../db/transaction.js";

export type ReassignDeactivatedTaskResult =
  | { type: "reassigned"; taskId: string; employeeId: string; assignmentVersion: number }
  | { type: "not-found" }
  | { type: "stale" }
  | { type: "not-unstarted" }
  | { type: "assignee-unavailable" }
  | { type: "responsable-inactive" };

/** Reassigns only an inactive employee's server-unstarted task, atomically preserving an assignment event. */
export async function reassignDeactivatedTask(
  transaction: Transaction,
  input: { responsableId: string; taskId: string; employeeId: string; expectedAssignmentVersion: number },
): Promise<ReassignDeactivatedTaskResult> {
  const actor = await transaction.query<{ id: string }>(
    `SELECT id FROM identity_accounts WHERE id = $1 AND role = 'responsable' AND is_active = true FOR SHARE`,
    [input.responsableId],
  );
  if (!actor.rows[0]) return { type: "responsable-inactive" };

  const owned = await transaction.query<{
    task_id: string; team_id: string; employee_id: string; assignment_version: string;
  } & QueryResultRow>(
    `SELECT task.id AS task_id, assignment.team_id, assignment.employee_id, assignment.assignment_version::text
     FROM tasks task
     JOIN task_assignments assignment ON assignment.task_id = task.id
     JOIN identity_teams team ON team.id = assignment.team_id AND team.responsable_account_id = $1
     WHERE task.id = $2
     FOR UPDATE OF task, assignment`,
    [input.responsableId, input.taskId],
  );
  const current = owned.rows[0];
  if (!current) return { type: "not-found" };
  if (Number(current.assignment_version) !== input.expectedAssignmentVersion) return { type: "stale" };
  const currentEmployee = await transaction.query<{ is_active: boolean }>(
    `SELECT is_active FROM identity_accounts WHERE id = $1 AND team_id = $2 AND role = 'employe' FOR UPDATE`,
    [current.employee_id, current.team_id],
  );
  if (!currentEmployee.rows[0]) return { type: "not-found" };
  if (currentEmployee.rows[0].is_active) return { type: "stale" };

  const work = await transaction.query<{ has_audit: boolean; has_resolution_state: boolean } & QueryResultRow>(
    `SELECT EXISTS (SELECT 1 FROM audits WHERE task_id = $1) AS has_audit,
            EXISTS (
              SELECT 1 FROM sync_operation_outcomes outcome
              WHERE outcome.task_id = $1
                AND (outcome.outcome = 'conflict' OR (outcome.kind = 'submit' AND outcome.outcome = 'rejected'))
            ) AS has_resolution_state`,
    [input.taskId],
  );
  if (work.rows[0]!.has_audit || work.rows[0]!.has_resolution_state) return { type: "not-unstarted" };

  const successor = await transaction.query<{ id: string }>(
    `SELECT employee.id
     FROM identity_teams team JOIN identity_accounts employee ON employee.team_id = team.id
     WHERE team.id = $1 AND team.responsable_account_id = $2 AND employee.id = $3
       AND employee.role = 'employe' AND employee.is_active = true
     FOR UPDATE OF employee`,
    [current.team_id, input.responsableId, input.employeeId],
  );
  if (!successor.rows[0]) return { type: "assignee-unavailable" };

  const updated = await transaction.query<{ assignment_version: string }>(
    `UPDATE task_assignments
     SET employee_id = $2, assigned_at = date_trunc('milliseconds', now()), assignment_version = assignment_version + 1
     WHERE task_id = $1 AND assignment_version = $3
     RETURNING assignment_version::text`,
    [input.taskId, input.employeeId, input.expectedAssignmentVersion],
  );
  if (!updated.rows[0]) return { type: "stale" };
  const createdAt = await transaction.query<{ created_at: Date }>("SELECT date_trunc('milliseconds', now()) AS created_at");
  await transaction.query(
    `INSERT INTO task_assignment_history
      (task_id, team_id, previous_employee_id, new_employee_id, actor_id, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, 'deactivated-assignee-recovery', $6)`,
    [input.taskId, current.team_id, current.employee_id, input.employeeId, input.responsableId, createdAt.rows[0]!.created_at],
  );
  return { type: "reassigned", taskId: input.taskId, employeeId: input.employeeId, assignmentVersion: Number(updated.rows[0].assignment_version) };
}
