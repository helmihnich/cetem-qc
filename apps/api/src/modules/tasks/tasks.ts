import type { Pool, PoolClient, QueryResultRow } from "pg";
import { withTransaction } from "../../db/transaction.js";

export class TaskAssigneeUnavailableError extends Error {}

export interface TaskAssignee {
  id: string;
  firstName: string;
  surname: string;
}

export interface CreateTaskInput {
  establishment: string;
  service: string;
  type: "graphie_mobile";
  assigneeId: string;
}

interface TaskRow extends QueryResultRow {
  id: string;
  establishment: string;
  service: string;
  task_type: "graphie_mobile";
  employee_id: string;
  created_by: string;
  created_at: Date;
  state: "draft";
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
  return withTransaction(pool, async (transaction) => {
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
    const row = await insertTaskAndAssignment(transaction, responsableId, employee, input);
    return {
      id: row.id,
      establishment: row.establishment,
      service: row.service,
      type: row.task_type,
      assigneeId: row.employee_id,
      creatorId: row.created_by,
      createdAt: row.created_at.toISOString(),
      state: row.state,
    };
  });
}

async function insertTaskAndAssignment(
  transaction: PoolClient,
  responsableId: string,
  employee: { id: string; team_id: string },
  input: CreateTaskInput,
): Promise<TaskRow> {
  const taskResult = await transaction.query<TaskRow>(
    `INSERT INTO tasks (establishment, service, task_type, created_by)
     VALUES ($1, $2, 'graphie_mobile', $3)
     RETURNING id, establishment, service, task_type, created_by, created_at, state`,
    [input.establishment.trim(), input.service, responsableId],
  );
  const task = taskResult.rows[0];
  await transaction.query(
    "INSERT INTO task_assignments (task_id, team_id, employee_id) VALUES ($1, $2, $3)",
    [task.id, employee.team_id, employee.id],
  );
  return { ...task, employee_id: employee.id };
}
