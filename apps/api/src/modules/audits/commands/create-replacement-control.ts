import type { Pool, QueryResultRow } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { insertAssignedTask, TaskAssigneeUnavailableError } from "../../tasks/commands/insert-assigned-task.js";
import type { AssignedTask, CreateTaskInput } from "../../tasks/commands/insert-assigned-task.js";

export type CreateReplacementControlInput = {
  responsableId: string;
  /** The own-team task holding the accepted audit to replace. */
  originalTaskId: string;
  task: CreateTaskInput;
};

export type CreateReplacementControlOutcome =
  | { type: "created"; task: AssignedTask; replacementOf: { taskId: string; auditId: string } }
  | { type: "not-found" }
  | { type: "not-accepted" }
  | { type: "already-replaced" }
  | { type: "assignee-unavailable" };

/** Test-only seam: failure injection after the replacement task and its assignment are inserted. Never set in production. */
export const replacementCommandTestSeams: { afterTaskInsert?: () => Promise<void> | void } = {};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AcceptedAuditRow extends QueryResultRow {
  audit_id: string;
  submission_id: string;
}

/**
 * CreateReplacementControl (FR-024, OD-03): in one transaction, creates a new draft task assigned like
 * POST /tasks and one insert-only `replacement-control` link to the accepted audit of an own-team task.
 * The original task, assignment, audit, revisions, submission, outcomes and lineage rows are only read.
 */
export async function createReplacementControl(pool: Pool, input: CreateReplacementControlInput): Promise<CreateReplacementControlOutcome> {
  const originalTaskId = input.originalTaskId.toLowerCase();
  if (!uuidPattern.test(originalTaskId)) return { type: "not-found" };
  try {
    return await withTransaction(pool, async (transaction): Promise<CreateReplacementControlOutcome> => {
      // Serializes replacement requests on the original. A row lock does not fire the updated_at trigger.
      const original = await transaction.query<{ id: string }>(
        `SELECT task.id
         FROM tasks task
         JOIN task_assignments assignment ON assignment.task_id = task.id
         JOIN identity_teams team ON team.id = assignment.team_id
         JOIN identity_accounts employee
           ON employee.id = assignment.employee_id
          AND employee.team_id = assignment.team_id
          AND employee.role = 'employe'
         WHERE team.responsable_account_id = $1 AND task.id = $2
         FOR UPDATE OF task`,
        [input.responsableId, originalTaskId],
      );
      if (!original.rows[0]) return { type: "not-found" };

      const accepted = await transaction.query<AcceptedAuditRow>(
        `SELECT audit.id AS audit_id, submission.id AS submission_id
         FROM audits audit
         JOIN audit_submissions submission ON submission.audit_id = audit.id
         WHERE audit.task_id = $1 AND audit.state = 'submitted'`,
        [originalTaskId],
      );
      const acceptedAudit = accepted.rows[0];
      if (!acceptedAudit) return { type: "not-accepted" };

      const existing = await transaction.query("SELECT 1 FROM audit_replacement_links WHERE original_task_id = $1", [originalTaskId]);
      if (existing.rows.length > 0) return { type: "already-replaced" };

      const task = await insertAssignedTask(transaction, input.responsableId, input.task);
      await replacementCommandTestSeams.afterTaskInsert?.();
      await transaction.query(
        `INSERT INTO audit_replacement_links
           (link_type, original_task_id, original_audit_id, original_submission_id, replacement_task_id, actor_id)
         VALUES ('replacement-control', $1, $2, $3, $4, $5)`,
        [originalTaskId, acceptedAudit.audit_id, acceptedAudit.submission_id, task.id, input.responsableId],
      );
      return { type: "created", task, replacementOf: { taskId: originalTaskId, auditId: acceptedAudit.audit_id } };
    });
  } catch (error) {
    if (error instanceof TaskAssigneeUnavailableError) return { type: "assignee-unavailable" };
    const pgError = error as { code?: unknown; table?: unknown } | null;
    if (pgError?.code === "23505" && pgError.table === "audit_replacement_links") return { type: "already-replaced" };
    throw error;
  }
}
