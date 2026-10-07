import type { ManualInsight } from "@cetem-qc/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";

export interface ManualInsightRow extends QueryResultRow {
  id: string;
  insight_text: string;
  justification: string | null;
  created_at: Date;
  author_id: string;
  display_name: string;
}

export const toManualInsight = (row: ManualInsightRow): ManualInsight => ({
  id: row.id,
  text: row.insight_text,
  justification: row.justification,
  sourceType: "manual",
  createdAt: row.created_at.toISOString(),
  author: { id: row.author_id, displayName: row.display_name },
});

/** The manual insights of a submission, oldest first. Read only. */
export async function getManualInsights(client: Pool | PoolClient, submissionId: string): Promise<ManualInsight[]> {
  const result = await client.query<ManualInsightRow>(
    `SELECT insight.id, insight.insight_text, insight.justification, insight.created_at, insight.author_id, account.display_name
     FROM audit_manual_insights insight
     JOIN identity_accounts account ON account.id = insight.author_id
     WHERE insight.submission_id = $1
     ORDER BY insight.seq ASC`,
    [submissionId],
  );
  return result.rows.map(toManualInsight);
}
