import type { Pool, QueryResultRow } from "pg";
import { withTransaction } from "../../db/transaction.js";
import { insertAssignedTask } from "./commands/insert-assigned-task.js";
import type { CreateTaskInput } from "./commands/insert-assigned-task.js";
import { reassignDeactivatedTask } from "./commands/reassign-deactivated-task.js";
import type { ReassignDeactivatedTaskResult } from "./commands/reassign-deactivated-task.js";

export { TaskAssigneeUnavailableError } from "./commands/insert-assigned-task.js";
export type { CreateTaskInput } from "./commands/insert-assigned-task.js";

export interface TaskAssignee {
  id: string;
  firstName: string;
  surname: string;
}

export type TaskAssignmentHistoryItem = {
  previousEmployee: string | null;
  newEmployee: string;
  actor: string;
  reason: string;
  createdAt: string;
};

interface TaskListRow extends QueryResultRow {
  id: string;
  establishment: string;
  task_type: "graphie_mobile";
  assignee: string;
  assignee_is_active: boolean;
  assignment_version: string;
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
            assignment.assignment_version::text,
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
    assigneeActive: row.assignee_is_active,
    assignmentVersion: Number(row.assignment_version),
    assignmentHistory: [] as TaskAssignmentHistoryItem[],
    state: row.state,
    lastUpdatedAt: row.last_updated_at.toISOString(),
  }));
}

export async function listTaskAssignmentHistory(pool: Pool, responsableId: string, taskIds: string[]): Promise<Map<string, TaskAssignmentHistoryItem[]>> {
  const history = new Map<string, TaskAssignmentHistoryItem[]>();
  if (taskIds.length === 0) return history;
  const result = await pool.query<{
    task_id: string; previous_employee: string | null; new_employee: string; actor: string; reason: string; created_at: Date;
  } & QueryResultRow>(
    `SELECT history.task_id, previous.display_name AS previous_employee,
            current.display_name AS new_employee, actor.display_name AS actor,
            history.reason, history.created_at
     FROM task_assignment_history history
     JOIN tasks task ON task.id = history.task_id
     JOIN task_assignments assignment ON assignment.task_id = task.id
     JOIN identity_teams team ON team.id = assignment.team_id AND team.responsable_account_id = $1
     LEFT JOIN identity_accounts previous ON previous.id = history.previous_employee_id
     JOIN identity_accounts current ON current.id = history.new_employee_id
     JOIN identity_accounts actor ON actor.id = history.actor_id
     WHERE history.task_id = ANY($2::uuid[])
     ORDER BY history.created_at, history.id`,
    [responsableId, taskIds],
  );
  for (const row of result.rows) {
    const items = history.get(row.task_id) ?? [];
    items.push({ previousEmployee: row.previous_employee, newEmployee: row.new_employee, actor: row.actor, reason: row.reason, createdAt: row.created_at.toISOString() });
    history.set(row.task_id, items);
  }
  return history;
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

export async function reassignUnstartedDeactivatedTask(pool: Pool, input: { responsableId: string; taskId: string; employeeId: string; expectedAssignmentVersion: number }): Promise<ReassignDeactivatedTaskResult> {
  return withTransaction(pool, (transaction) => reassignDeactivatedTask(transaction, input));
}
