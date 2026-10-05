import type { QueryResultRow } from "pg";
import type { Transaction } from "../../../db/transaction.js";

export class TaskAssigneeUnavailableError extends Error {}

export interface CreateTaskInput {
  establishment: string;
  service: string;
  type: "graphie_mobile";
  assigneeId: string;
}

export interface AssignedTask {
  id: string;
  establishment: string;
  service: string;
  type: "graphie_mobile";
  assigneeId: string;
  creatorId: string;
  createdAt: string;
  state: "draft";
}

interface TaskRow extends QueryResultRow {
  id: string;
  establishment: string;
  service: string;
  task_type: "graphie_mobile";
  created_by: string;
  created_at: Date;
  state: "draft";
}

/**
 * Checks that the assignee is an active Employé of the Responsable's team (locked for the rest of the
 * transaction), then inserts the draft task and its assignment on the caller's transaction.
 * Throws `TaskAssigneeUnavailableError` when the assignee is not eligible.
 */
export async function insertAssignedTask(transaction: Transaction, responsableId: string, input: CreateTaskInput): Promise<AssignedTask> {
  const eligible = await transaction.query<{ id: string; team_id: string } & QueryResultRow>(
    `SELECT employee.id, employee.team_id
     FROM identity_teams team
     JOIN identity_accounts employee ON employee.team_id = team.id
     WHERE team.responsable_account_id = $1 AND employee.id = $2
       AND employee.role = 'employe' AND employee.is_active = true
     FOR UPDATE OF employee`,
    [responsableId, input.assigneeId],
  );
  const employee = eligible.rows[0];
  if (!employee) throw new TaskAssigneeUnavailableError();
  const taskResult = await transaction.query<TaskRow>(
    `INSERT INTO tasks (establishment, service, task_type, created_by)
     VALUES ($1, $2, 'graphie_mobile', $3)
     RETURNING id, establishment, service, task_type, created_by, created_at, state`,
    [input.establishment.trim(), input.service, responsableId],
  );
  const task = taskResult.rows[0]!;
  await transaction.query(
    "INSERT INTO task_assignments (task_id, team_id, employee_id) VALUES ($1, $2, $3)",
    [task.id, employee.team_id, employee.id],
  );
  return {
    id: task.id,
    establishment: task.establishment,
    service: task.service,
    type: task.task_type,
    assigneeId: employee.id,
    creatorId: task.created_by,
    createdAt: task.created_at.toISOString(),
    state: task.state,
  };
}
