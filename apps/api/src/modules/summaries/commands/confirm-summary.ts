import { summaryInputSetPlainObject } from "@cetem-qc/domain";
import type { Pool } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { isConsistentSnapshot, reviewCommandTestSeams } from "../../audits/commands/record-review-access.js";
import { getAcceptedSubmissionForReview } from "../../audits/queries/accepted-submission.js";
import { buildInputSetForSnapshot } from "../input-set.js";
import { confirmedSummaryJoins, confirmedSummarySelect, getSummaryState, lockTaskSummary, toConfirmedSummary } from "../queries/confirmed-summary.js";
import type { ConfirmedSummary, ConfirmedSummaryRow } from "../queries/confirmed-summary.js";

export type ConfirmSummaryOutcome =
  | { type: "confirmed"; summary: ConfirmedSummary }
  | { type: "already-confirmed" }
  | { type: "invalid-draft" }
  | { type: "not-found" }
  | { type: "inconsistent" };

/** Test-only seam: runs just before the insert, inside the transaction. Never set in production. */
export const confirmSummaryTestSeams: { beforeInsert?: () => Promise<void> | void } = {};

/**
 * Confirms the final summary text of an own-team accepted audit in one transaction. The actual input set is rebuilt by
 * the server from the stored snapshot and the insights retained at this moment; the client supplies only the text and
 * the optional draft the text started from. No provider is called and no access row is written.
 */
export async function confirmSummary(
  pool: Pool, responsableId: string, taskId: string, input: { text: string; draftId?: string },
): Promise<ConfirmSummaryOutcome> {
  return withTransaction(pool, async (transaction): Promise<ConfirmSummaryOutcome> => {
    await lockTaskSummary(transaction, taskId);
    const stored = await getAcceptedSubmissionForReview(transaction, responsableId, taskId);
    if (!stored) return { type: "not-found" };
    const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
    if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" };
    const state = await getSummaryState(transaction, evidence.submissionId);
    if (state.state === "confirmed") return { type: "already-confirmed" };
    if (input.draftId) {
      const draft = await transaction.query(
        "SELECT 1 FROM summary_ai_drafts WHERE id = $1 AND task_id = $2 AND submission_id = $3 AND status = 'generated'",
        [input.draftId, evidence.taskId, evidence.submissionId],
      );
      if (draft.rows.length === 0) return { type: "invalid-draft" };
    }
    const { inputSet, summaryInputSetId } = await buildInputSetForSnapshot(transaction, evidence);
    await confirmSummaryTestSeams.beforeInsert?.();
    const result = await transaction.query<ConfirmedSummaryRow>(
      `WITH inserted AS (
         INSERT INTO confirmed_summaries (confirmed_by, task_id, audit_id, submission_id, revision, revision_identity, initial_draft_id, final_text, summary_input_set_id, input_set, version)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11)
         RETURNING *
       )
       SELECT ${confirmedSummarySelect} FROM inserted summary ${confirmedSummaryJoins}`,
      [
        responsableId, evidence.taskId, evidence.auditId, evidence.submissionId, evidence.revision, JSON.stringify(evidence.identity),
        input.draftId ?? null, input.text, summaryInputSetId, JSON.stringify(summaryInputSetPlainObject(inputSet)),
        state.nextVersion,
      ],
    );
    return { type: "confirmed", summary: toConfirmedSummary(result.rows[0]!) };
  });
}
