import type { ManualInsight } from "@cetem-qc/domain";
import type { Pool } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { getAcceptedSubmissionForReview } from "../queries/accepted-submission.js";
import { toManualInsight } from "../queries/manual-insights.js";
import type { ManualInsightRow } from "../queries/manual-insights.js";
import { isConsistentSnapshot, reviewCommandTestSeams } from "./record-review-access.js";

export type AddManualInsightOutcome =
  | { type: "added"; insight: ManualInsight }
  | { type: "not-found" }
  | { type: "inconsistent" };

/**
 * Inserts one insert-only manual insight on the accepted snapshot of an own-team task. Author, date and source type
 * are set by the server; the caller supplies only the text and the optional justification.
 */
export async function addManualInsight(
  pool: Pool, responsableId: string, taskId: string, input: { text: string; justification?: string | null },
): Promise<AddManualInsightOutcome> {
  return withTransaction(pool, async (transaction): Promise<AddManualInsightOutcome> => {
    const stored = await getAcceptedSubmissionForReview(transaction, responsableId, taskId);
    if (!stored) return { type: "not-found" };
    const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
    if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" };
    const result = await transaction.query<ManualInsightRow>(
      `WITH inserted AS (
         INSERT INTO audit_manual_insights (author_id, task_id, audit_id, submission_id, revision, revision_identity, insight_text, justification)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING id, insight_text, justification, created_at, author_id
       )
       SELECT inserted.id, inserted.insight_text, inserted.justification, inserted.created_at, inserted.author_id, account.display_name
       FROM inserted JOIN identity_accounts account ON account.id = inserted.author_id`,
      [responsableId, evidence.taskId, evidence.auditId, evidence.submissionId, evidence.revision, JSON.stringify(evidence.identity), input.text, input.justification ?? null],
    );
    return { type: "added", insight: toManualInsight(result.rows[0]!) };
  });
}
