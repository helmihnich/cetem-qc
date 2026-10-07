import type { CurrentInsightDecision, InsightDecisionValue } from "@cetem-qc/domain";
import type { Pool } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { getAcceptedSubmissionForReview } from "../queries/accepted-submission.js";
import { evaluateProposalsForSnapshot, isConsistentSnapshot, reviewCommandTestSeams } from "./record-review-access.js";

export type RecordInsightDecisionOutcome =
  | { type: "recorded"; current: CurrentInsightDecision }
  | { type: "not-found" }
  | { type: "inconsistent" }
  | { type: "unknown-proposal" };

/**
 * Records one insert-only decision on a proposal the server itself evaluates from the accepted snapshot.
 * The caller supplies only the proposal ID and the decision; the stored snapshot is the server's proposal.
 */
export async function recordInsightDecision(
  pool: Pool, responsableId: string, taskId: string, proposalId: string, decision: InsightDecisionValue,
): Promise<RecordInsightDecisionOutcome> {
  return withTransaction(pool, async (transaction): Promise<RecordInsightDecisionOutcome> => {
    const stored = await getAcceptedSubmissionForReview(transaction, responsableId, taskId);
    if (!stored) return { type: "not-found" };
    const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
    if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" };
    const proposal = evaluateProposalsForSnapshot(evidence).proposals.find((candidate) => candidate.proposalId === proposalId);
    if (!proposal) return { type: "unknown-proposal" };
    const result = await transaction.query<{ decided_at: Date; display_name: string }>(
      `WITH inserted AS (
         INSERT INTO audit_insight_decisions (actor_id, task_id, audit_id, submission_id, revision, revision_identity, proposal_id, decision, proposal)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)
         RETURNING actor_id, decided_at
       )
       SELECT inserted.decided_at, account.display_name FROM inserted JOIN identity_accounts account ON account.id = inserted.actor_id`,
      [responsableId, evidence.taskId, evidence.auditId, evidence.submissionId, evidence.revision, JSON.stringify(evidence.identity), proposal.proposalId, decision, JSON.stringify(proposal)],
    );
    const row = result.rows[0]!;
    return {
      type: "recorded",
      current: { proposalId: proposal.proposalId, decision, decidedAt: row.decided_at.toISOString(), decidedBy: { id: responsableId, displayName: row.display_name } },
    };
  });
}
