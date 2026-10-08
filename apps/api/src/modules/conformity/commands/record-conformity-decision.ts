import type { Pool } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { isConsistentSnapshot, reviewCommandTestSeams } from "../../audits/commands/record-review-access.js";
import { getAcceptedSubmissionForReview } from "../../audits/queries/accepted-submission.js";
import { getSummaryState, lockTaskSummary } from "../../summaries/index.js";
import type { ConformityDecision, ConformityOutcome } from "../queries/conformity-decision.js";

export type RecordConformityDecisionOutcome =
  | { type: "recorded"; decision: ConformityDecision }
  | { type: "not-confirmed" }
  | { type: "already-decided" }
  | { type: "not-found" }
  | { type: "inconsistent" };

/**
 * Records the explicit decision of the Responsable for the current confirmed summary in one transaction. The outcome
 * is the only caller-supplied value: no result, verdict, insight, draft or summary text is read, no provider is
 * called, and only the insert-only decision row is written. The per-task lock serializes it with a reopening.
 */
export async function recordConformityDecision(
  pool: Pool, responsableId: string, taskId: string, outcome: ConformityOutcome,
): Promise<RecordConformityDecisionOutcome> {
  return withTransaction(pool, async (transaction): Promise<RecordConformityDecisionOutcome> => {
    await lockTaskSummary(transaction, taskId);
    const stored = await getAcceptedSubmissionForReview(transaction, responsableId, taskId);
    if (!stored) return { type: "not-found" };
    const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
    if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" };
    const state = await getSummaryState(transaction, evidence.submissionId);
    if (state.state !== "confirmed") return { type: "not-confirmed" };
    const existing = await transaction.query("SELECT 1 FROM conformity_decisions WHERE confirmed_summary_id = $1", [state.summary.id]);
    if (existing.rows.length > 0) return { type: "already-decided" };
    const inserted = await transaction.query<{ id: string; decided_at: Date; display_name: string }>(
      `WITH inserted AS (
         INSERT INTO conformity_decisions (confirmed_summary_id, outcome, decided_by, task_id, submission_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, decided_at, decided_by
       )
       SELECT inserted.id, inserted.decided_at, account.display_name FROM inserted JOIN identity_accounts account ON account.id = inserted.decided_by`,
      [state.summary.id, outcome, responsableId, evidence.taskId, evidence.submissionId],
    );
    const row = inserted.rows[0]!;
    return {
      type: "recorded",
      decision: {
        id: row.id, outcome, decidedAt: row.decided_at.toISOString(),
        decidedBy: { id: responsableId, displayName: row.display_name },
        summaryId: state.summary.id, summaryVersion: state.summary.version,
      },
    };
  });
}
