import type { CalculationContext, GraphieCalculationResults, ValidatedGraphiePayload } from "@cetem-qc/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { getOwnTeamTaskId } from "../../tasks/queries/own-team-task.js";

/** The accepted submission of a task, exactly as the server stored it. */
export type AcceptedSubmissionSnapshot = {
  submissionId: string;
  operationId: string;
  taskId: string;
  auditId: string;
  revision: number;
  identity: CalculationContext;
  /** The stored payload: measurements and comment areas, raw strings unchanged. */
  payload: ValidatedGraphiePayload;
  /** The server calculation results, as stored. */
  results: GraphieCalculationResults;
  /** The account ID is the authority; the display name is the current one. */
  submittedBy: { id: string; displayName: string };
  /** ISO 8601 UTC, equal to the acceptedAt of the accepting response. */
  acceptedAt: string;
};

interface AcceptedSubmissionRow extends QueryResultRow {
  submission_id: string;
  operation_id: string;
  task_id: string;
  audit_id: string;
  revision: number;
  catalogue_id: string;
  catalogue_version: string;
  schema_version: number;
  rule_id: string;
  rule_version: string;
  payload: ValidatedGraphiePayload;
  results: GraphieCalculationResults;
  submitted_by: string;
  submitted_by_name: string;
  accepted_at: Date;
}

/**
 * The accepted snapshot for review by the Responsable who owns the task's team. Undefined for another
 * team's task, an unknown task or a task without accepted submission, without telling them apart.
 * Read only: the review route and its access log belong to Story 9.1.
 */
export async function getAcceptedSubmissionForReview(
  pool: Pool | PoolClient,
  responsableId: string,
  taskId: string,
): Promise<AcceptedSubmissionSnapshot | undefined> {
  const ownTaskId = await getOwnTeamTaskId(pool, responsableId, taskId);
  if (!ownTaskId) return undefined;
  const result = await pool.query<AcceptedSubmissionRow>(
    `SELECT submission.id AS submission_id, submission.operation_id, audit.task_id, audit.id AS audit_id,
            revision.revision, revision.catalogue_id, revision.catalogue_version, revision.schema_version,
            revision.rule_id, revision.rule_version, revision.payload, revision.results,
            submission.submitted_by, account.display_name AS submitted_by_name, submission.accepted_at
     FROM audits audit
     JOIN audit_submissions submission ON submission.audit_id = audit.id
     JOIN audit_revisions revision ON revision.audit_id = submission.audit_id AND revision.revision = submission.revision
     JOIN identity_accounts account ON account.id = submission.submitted_by
     WHERE audit.task_id = $1`,
    [ownTaskId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    submissionId: row.submission_id,
    operationId: row.operation_id,
    taskId: row.task_id,
    auditId: row.audit_id,
    revision: row.revision,
    identity: {
      catalogueId: row.catalogue_id,
      catalogueVersion: row.catalogue_version,
      schemaVersion: row.schema_version,
      ruleId: row.rule_id,
      ruleVersion: row.rule_version,
    },
    payload: row.payload,
    results: row.results,
    submittedBy: { id: row.submitted_by, displayName: row.submitted_by_name },
    acceptedAt: row.accepted_at.toISOString(),
  };
}
