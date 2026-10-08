import type { Pool, QueryResultRow } from "pg";

/** The server-accepted state and the replacement lineage of one task, as shown in the Responsable list. */
export type TaskAcceptanceAndLineage = {
  /** `submitted` only when an accepted-submission record exists; rejected/pending work remains `draft`. */
  state: "draft" | "submitted";
  /** The original task ID when this task is a replacement control. */
  replacementOf: string | null;
  /** The replacement task ID when this task's accepted audit was replaced. */
  replacedBy: string | null;
  recoveryState: "unstarted" | "synchronized-draft" | "correction-draft" | "resolution-required" | "accepted" | "recovered" | null;
  recoverySource: { taskId: string; auditId: string; revision: number } | null;
  recoverySuccessorTaskId: string | null;
  recoveryRevision: number | null;
};

interface LineageRow extends QueryResultRow {
  id: string;
  has_accepted_submission: boolean;
  has_audit: boolean;
  replacement_of: string | null;
  replaced_by: string | null;
  open_conflict: boolean;
  open_rejection: boolean;
  correction_revision: boolean;
  recovered_by_task: string | null;
  recovery_source_task: string | null;
  recovery_source_audit: string | null;
  recovery_source_revision: number | null;
  current_revision: number | null;
}

/**
 * Reads server-authoritative audit/recovery state and replacement/recovery lineage. Read only. Every ID is returned.
 */
export async function readTaskAcceptanceAndLineage(pool: Pool, taskIds: string[]): Promise<Map<string, TaskAcceptanceAndLineage>> {
  const lineage = new Map<string, TaskAcceptanceAndLineage>();
  if (taskIds.length === 0) return lineage;
  const result = await pool.query<LineageRow>(
    `SELECT listed.id,
            EXISTS (
              SELECT 1 FROM audit_submissions submission
              JOIN audits audit ON audit.id = submission.audit_id
              WHERE audit.task_id = listed.id
            ) AS has_accepted_submission,
            EXISTS (SELECT 1 FROM audits audit WHERE audit.task_id = listed.id) AS has_audit,
            (SELECT replaced.original_task_id
             FROM audit_replacement_links replaced
             WHERE replaced.replacement_task_id = listed.id
             ORDER BY replaced.created_at, replaced.id
             LIMIT 1) AS replacement_of,
            (SELECT replacement.replacement_task_id
             FROM audit_replacement_links replacement
             WHERE replacement.original_task_id = listed.id
             ORDER BY replacement.created_at, replacement.id
             LIMIT 1) AS replaced_by,
            EXISTS (
              SELECT 1 FROM sync_operation_outcomes outcome
              WHERE outcome.task_id = listed.id AND outcome.outcome = 'conflict'
                AND NOT EXISTS (SELECT 1 FROM audit_lineage_links link WHERE link.predecessor_operation_id = outcome.operation_id)
            ) AS open_conflict,
            EXISTS (
              SELECT 1 FROM sync_operation_outcomes outcome
              WHERE outcome.task_id = listed.id AND outcome.kind = 'submit' AND outcome.outcome = 'rejected'
                AND outcome.response->>'code' <> 'AUDIT_ALREADY_SUBMITTED'
                AND NOT EXISTS (SELECT 1 FROM audit_lineage_links link WHERE link.predecessor_operation_id = outcome.operation_id)
            ) AS open_rejection,
            EXISTS (
              SELECT 1 FROM audits current_audit
              JOIN audit_lineage_links link ON link.audit_id = current_audit.id
                AND link.revision = current_audit.current_revision
                AND link.link_type = 'rejected-submission-correction'
              WHERE current_audit.task_id = listed.id AND current_audit.state = 'draft'
            ) AS correction_revision,
            (SELECT current_audit.current_revision FROM audits current_audit WHERE current_audit.task_id = listed.id) AS current_revision,
            (SELECT recovery.successor_task_id FROM audit_deactivated_assignee_recovery_links recovery
             WHERE recovery.source_task_id = listed.id ORDER BY recovery.created_at DESC LIMIT 1) AS recovered_by_task,
            (SELECT recovery.source_task_id FROM audit_deactivated_assignee_recovery_links recovery
             WHERE recovery.successor_task_id = listed.id ORDER BY recovery.created_at DESC LIMIT 1) AS recovery_source_task,
            (SELECT recovery.source_audit_id FROM audit_deactivated_assignee_recovery_links recovery
             WHERE recovery.successor_task_id = listed.id ORDER BY recovery.created_at DESC LIMIT 1) AS recovery_source_audit,
            (SELECT recovery.source_revision FROM audit_deactivated_assignee_recovery_links recovery
             WHERE recovery.successor_task_id = listed.id ORDER BY recovery.created_at DESC LIMIT 1) AS recovery_source_revision
     FROM unnest($1::uuid[]) AS listed(id)
     `,
    [taskIds],
  );
  for (const row of result.rows) {
    lineage.set(row.id, {
      state: row.has_accepted_submission ? "submitted" : "draft",
      replacementOf: row.replacement_of,
      replacedBy: row.replaced_by,
      recoveryState: row.has_accepted_submission ? "accepted"
        : row.recovered_by_task ? "recovered"
        : row.open_conflict || row.open_rejection ? "resolution-required"
          : row.has_audit ? row.correction_revision ? "correction-draft" : "synchronized-draft"
            : "unstarted",
      recoverySource: row.recovery_source_task && row.recovery_source_audit && row.recovery_source_revision !== null
        ? { taskId: row.recovery_source_task, auditId: row.recovery_source_audit, revision: row.recovery_source_revision }
        : null,
      recoverySuccessorTaskId: row.recovered_by_task,
      recoveryRevision: row.current_revision,
    });
  }
  for (const id of taskIds) {
    if (!lineage.has(id)) lineage.set(id, { state: "draft", replacementOf: null, replacedBy: null, recoveryState: "unstarted", recoverySource: null, recoverySuccessorTaskId: null, recoveryRevision: null });
  }
  return lineage;
}

/** The audit ID of each given task that has an audit; tasks without one are absent. Read only. */
export async function readAuditIdsByTask(pool: Pool, taskIds: string[]): Promise<Map<string, string>> {
  const auditIds = new Map<string, string>();
  if (taskIds.length === 0) return auditIds;
  const result = await pool.query<{ task_id: string; id: string }>("SELECT task_id, id FROM audits WHERE task_id = ANY($1::uuid[])", [taskIds]);
  for (const row of result.rows) auditIds.set(row.task_id, row.id);
  return auditIds;
}
