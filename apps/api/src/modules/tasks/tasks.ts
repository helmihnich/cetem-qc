import type { Pool, QueryResultRow } from "pg";
import { withTransaction } from "../../db/transaction.js";
import { insertAssignedTask } from "./commands/insert-assigned-task.js";
import type { CreateTaskInput } from "./commands/insert-assigned-task.js";

export { TaskAssigneeUnavailableError } from "./commands/insert-assigned-task.js";
export type { CreateTaskInput } from "./commands/insert-assigned-task.js";

export interface TaskAssignee {
  id: string;
  firstName: string;
  surname: string;
}

interface TaskListRow extends QueryResultRow {
  id: string;
  establishment: string;
  task_type: "graphie_mobile";
  assignee: string;
  assignee_is_active: boolean;
  state: "draft";
  last_updated_at: Date;
}

interface EmployeeTaskRow extends QueryResultRow {
  id: string;
  establishment: string;
  service: string;
  task_type: "graphie_mobile";
  state: "draft";
  created_at: Date;
}

export async function listAssignedEmployeeTasks(pool: Pool, employeeId: string) {
  const result = await pool.query<EmployeeTaskRow>(
    `SELECT task.id, task.establishment, task.service, task.task_type,
            task.state, task.created_at
     FROM tasks task
     JOIN task_assignments assignment ON assignment.task_id = task.id
     WHERE assignment.employee_id = $1`,
    [employeeId],
  );
  return result.rows.map(toEmployeeTask);
}

export async function getAssignedEmployeeTask(pool: Pool, employeeId: string, taskId: string) {
  const result = await pool.query<EmployeeTaskRow>(
    `SELECT task.id, task.establishment, task.service, task.task_type,
            task.state, task.created_at
     FROM tasks task
     JOIN task_assignments assignment ON assignment.task_id = task.id
     WHERE assignment.employee_id = $1 AND task.id = $2`,
    [employeeId, taskId],
  );
  const row = result.rows[0];
  return row ? toEmployeeTask(row) : undefined;
}

function toEmployeeTask(row: EmployeeTaskRow) {
  return {
    id: row.id,
    type: row.task_type,
    establishment: row.establishment,
    service: row.service,
    state: row.state,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listOwnTeamTasks(pool: Pool, responsableId: string) {
  const result = await pool.query<TaskListRow>(
    `SELECT task.id, task.task_type, task.establishment,
            concat_ws(' ', employee.first_name, employee.surname) AS assignee,
            employee.is_active AS assignee_is_active,
            task.state, task.updated_at AS last_updated_at
     FROM tasks task
     JOIN task_assignments assignment ON assignment.task_id = task.id
     JOIN identity_teams team ON team.id = assignment.team_id
     JOIN identity_accounts employee
       ON employee.id = assignment.employee_id
      AND employee.team_id = assignment.team_id
      AND employee.role = 'employe'
     WHERE team.responsable_account_id = $1`,
    [responsableId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    type: row.task_type,
    establishment: row.establishment,
    assignee: row.assignee_is_active ? row.assignee : `${row.assignee} — Inactif`,
    state: row.state,
    lastUpdatedAt: row.last_updated_at.toISOString(),
  }));
}

export async function listEligibleTaskAssignees(pool: Pool, responsableId: string): Promise<TaskAssignee[]> {
  const result = await pool.query<{ id: string; first_name: string; surname: string } & QueryResultRow>(
    `SELECT employee.id, employee.first_name, employee.surname
     FROM identity_teams team
     JOIN identity_accounts employee ON employee.team_id = team.id
     WHERE team.responsable_account_id = $1
       AND employee.role = 'employe' AND employee.is_active = true
     ORDER BY employee.surname, employee.first_name, employee.id`,
    [responsableId],
  );
  return result.rows.map((row) => ({ id: row.id, firstName: row.first_name, surname: row.surname }));
}

export async function createAssignedTask(pool: Pool, responsableId: string, input: CreateTaskInput) {
  return withTransaction(pool, (transaction) => insertAssignedTask(transaction, responsableId, input));
}
