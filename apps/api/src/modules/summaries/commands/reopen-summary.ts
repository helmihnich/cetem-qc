import type { Pool } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { isConsistentSnapshot, reviewCommandTestSeams } from "../../audits/commands/record-review-access.js";
import { getAcceptedSubmissionForReview } from "../../audits/queries/accepted-submission.js";
import { getSummaryState, lockTaskSummary } from "../queries/confirmed-summary.js";
import type { ConfirmedSummary } from "../queries/confirmed-summary.js";
import { listSummaryReopenParticipants } from "../reopen-participants.js";

export interface SummaryReopeningRecord {
  version: number;
  reopenedAt: string;
  reopenedBy: { id: string; displayName: string };
  previous: ConfirmedSummary;
}

export type ReopenSummaryOutcome =
  | { type: "reopened"; reopening: SummaryReopeningRecord }
  | { type: "not-confirmed" }
  | { type: "designated" }
  | { type: "not-found" }
  | { type: "inconsistent" };

/**
 * Reopens the current confirmed summary of an own-team accepted audit in one transaction. Only the insert-only
 * reopening row is written; the confirmed row is never modified. Registered participants may veto (official
 * designation) and are then told, in the same transaction, so their records can become non-current. No provider is
 * called and no access row is written.
 */
export async function reopenSummary(pool: Pool, responsableId: string, taskId: string): Promise<ReopenSummaryOutcome> {
  return withTransaction(pool, async (transaction): Promise<ReopenSummaryOutcome> => {
    await lockTaskSummary(transaction, taskId);
    const stored = await getAcceptedSubmissionForReview(transaction, responsableId, taskId);
    if (!stored) return { type: "not-found" };
    const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
    if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" };
    const state = await getSummaryState(transaction, evidence.submissionId);
    if (state.state !== "confirmed") return { type: "not-confirmed" };
    const participants = listSummaryReopenParticipants();
    const context = { taskId: evidence.taskId, submissionId: evidence.submissionId };
    for (const participant of participants) {
      if (await participant.hasOfficialDesignation(transaction, context)) return { type: "designated" };
    }
    const inserted = await transaction.query<{ reopened_at: Date; display_name: string }>(
      `WITH inserted AS (
         INSERT INTO summary_reopenings (confirmed_summary_id, reopened_by, task_id, submission_id)
         VALUES ($1, $2, $3, $4) RETURNING reopened_at, reopened_by
       )
       SELECT inserted.reopened_at, account.display_name FROM inserted JOIN identity_accounts account ON account.id = inserted.reopened_by`,
      [state.summary.id, responsableId, evidence.taskId, evidence.submissionId],
    );
    const reopenedAt = inserted.rows[0]!.reopened_at.toISOString();
    for (const participant of participants) {
      await participant.onSummaryReopened(transaction, {
        ...context, reopenedSummaryId: state.summary.id, reopenedAt, actorId: responsableId,
      });
    }
    return {
      type: "reopened",
      reopening: {
        version: state.summary.version + 1, reopenedAt,
        reopenedBy: { id: responsableId, displayName: inserted.rows[0]!.display_name }, previous: state.summary,
      },
    };
  });
}
