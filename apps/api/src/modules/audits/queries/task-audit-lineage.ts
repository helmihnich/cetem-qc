import type { Pool, QueryResultRow } from "pg";

/** The server-accepted state and the replacement lineage of one task, as shown in the Responsable list. */
export type TaskAcceptanceAndLineage = {
  /** `submitted` when the task's audit was accepted by the server, otherwise `draft`. */
  state: "draft" | "submitted";
  /** The original task ID when this task is a replacement control. */
  replacementOf: string | null;
  /** The replacement task ID when this task's accepted audit was replaced. */
  replacedBy: string | null;
};

interface LineageRow extends QueryResultRow {
  id: string;
  has_submitted_audit: boolean;
  replacement_of: string | null;
  replaced_by: string | null;
}

/**
 * Reads, for the given task IDs, the audit acceptance state and the `replacement-control` links in both
 * directions. Lineage comes only from `audit_replacement_links`. Read only. Every given ID is in the result.
 */
export async function readTaskAcceptanceAndLineage(pool: Pool, taskIds: string[]): Promise<Map<string, TaskAcceptanceAndLineage>> {
  const lineage = new Map<string, TaskAcceptanceAndLineage>();
  if (taskIds.length === 0) return lineage;
  const result = await pool.query<LineageRow>(
    `SELECT listed.id,
            EXISTS (
              SELECT 1 FROM audits audit
              WHERE audit.task_id = listed.id AND audit.state = 'submitted'
            ) AS has_submitted_audit,
            (SELECT replaced.original_task_id
             FROM audit_replacement_links replaced
             WHERE replaced.replacement_task_id = listed.id
             ORDER BY replaced.created_at, replaced.id
             LIMIT 1) AS replacement_of,
            (SELECT replacement.replacement_task_id
             FROM audit_replacement_links replacement
             WHERE replacement.original_task_id = listed.id
             ORDER BY replacement.created_at, replacement.id
             LIMIT 1) AS replaced_by
     FROM unnest($1::uuid[]) AS listed(id)
     `,
    [taskIds],
  );
  for (const row of result.rows) {
    lineage.set(row.id, {
      state: row.has_submitted_audit ? "submitted" : "draft",
      replacementOf: row.replacement_of,
      replacedBy: row.replaced_by,
    });
  }
  for (const id of taskIds) {
    if (!lineage.has(id)) lineage.set(id, { state: "draft", replacementOf: null, replacedBy: null });
  }
  return lineage;
}
