import type { GraphieDraftPayload } from "@cetem-qc/schemas/api/v1";
import type { Pool, QueryResultRow } from "pg";

/** The current server version of a task's audit; revision 0, state `draft` and nulls when no audit exists. */
export type CurrentAuditVersion = {
  revision: number;
  state: "draft" | "submitted";
  /** ISO 8601 UTC. */
  lastChangedAt: string | null;
  lastChangedBy: { id: string; displayName: string } | null;
  /** The payload of the current revision, unchanged. */
  payload: GraphieDraftPayload | null;
};

interface CurrentAuditVersionRow extends QueryResultRow {
  current_revision: number;
  state: "draft" | "submitted";
  updated_at: Date;
  updated_by: string;
  updated_by_name: string;
  payload: GraphieDraftPayload;
}

/**
 * Reads the audit, its current revision and the last author in one statement, so the metadata matches
 * what a conflict outcome would report at that instant. The caller checks the task assignment first.
 */
export async function getCurrentAuditVersion(pool: Pool, taskId: string): Promise<CurrentAuditVersion> {
  const result = await pool.query<CurrentAuditVersionRow>(
    `SELECT audit.current_revision, audit.state, audit.updated_at, audit.updated_by,
            account.display_name AS updated_by_name, revision.payload
     FROM audits audit
     JOIN audit_revisions revision ON revision.audit_id = audit.id AND revision.revision = audit.current_revision
     JOIN identity_accounts account ON account.id = audit.updated_by
     WHERE audit.task_id = $1`,
    [taskId],
  );
  const row = result.rows[0];
  if (!row) return { revision: 0, state: "draft", lastChangedAt: null, lastChangedBy: null, payload: null };
  return {
    revision: row.current_revision,
    state: row.state,
    lastChangedAt: row.updated_at.toISOString(),
    lastChangedBy: { id: row.updated_by, displayName: row.updated_by_name },
    payload: row.payload,
  };
}
