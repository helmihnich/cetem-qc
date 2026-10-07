import type { CurrentInsightDecision, InsightDecisionValue } from "@cetem-qc/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";

/** A current decision with the identity of the stored proposal snapshot it applies to. */
export type EvidenceInsightDecision = CurrentInsightDecision & { registryVersion: string; ruleId: string; ruleVersion: number };

interface CurrentDecisionRow extends QueryResultRow {
  proposal_id: string;
  decision: InsightDecisionValue;
  decided_at: Date;
  actor_id: string;
  display_name: string;
  proposal: { registryVersion: string; ruleId: string; ruleVersion: number };
}

/** The latest decision per proposal of a submission (latest identity sequence wins). Read only. */
export async function getCurrentInsightDecisions(client: Pool | PoolClient, submissionId: string): Promise<EvidenceInsightDecision[]> {
  const result = await client.query<CurrentDecisionRow>(
    `SELECT DISTINCT ON (decision.proposal_id) decision.proposal_id, decision.decision, decision.decided_at,
            decision.actor_id, account.display_name, decision.proposal
     FROM audit_insight_decisions decision
     JOIN identity_accounts account ON account.id = decision.actor_id
     WHERE decision.submission_id = $1
     ORDER BY decision.proposal_id, decision.seq DESC`,
    [submissionId],
  );
  return result.rows.map((row) => ({
    proposalId: row.proposal_id,
    decision: row.decision,
    decidedAt: row.decided_at.toISOString(),
    decidedBy: { id: row.actor_id, displayName: row.display_name },
    registryVersion: row.proposal.registryVersion,
    ruleId: row.proposal.ruleId,
    ruleVersion: row.proposal.ruleVersion,
  }));
}
