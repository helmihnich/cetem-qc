import type { Pool, PoolClient, QueryResultRow } from "pg";

export interface ConfirmedSummary {
  id: string;
  text: string;
  confirmedAt: string;
  confirmedBy: { id: string; displayName: string };
  summaryInputSetId: string;
  initialDraft: { id: string; text: string; provider: string; model: string; requestedAt: string; summaryInputSetId: string } | null;
}

export interface ConfirmedSummaryRow extends QueryResultRow {
  id: string;
  final_text: string;
  confirmed_at: Date;
  confirmed_by: string;
  display_name: string;
  summary_input_set_id: string;
  draft_id: string | null;
  draft_text: string | null;
  draft_provider: string | null;
  draft_model: string | null;
  draft_requested_at: Date | null;
  draft_summary_input_set_id: string | null;
}

export const toConfirmedSummary = (row: ConfirmedSummaryRow): ConfirmedSummary => ({
  id: row.id,
  text: row.final_text,
  confirmedAt: row.confirmed_at.toISOString(),
  confirmedBy: { id: row.confirmed_by, displayName: row.display_name },
  summaryInputSetId: row.summary_input_set_id,
  initialDraft: row.draft_id
    ? {
      id: row.draft_id, text: row.draft_text!, provider: row.draft_provider!, model: row.draft_model!,
      requestedAt: row.draft_requested_at!.toISOString(), summaryInputSetId: row.draft_summary_input_set_id!,
    }
    : null,
});

/** Columns shared by every read of a confirmed summary row joined with its confirmer and optional initial draft. */
export const confirmedSummarySelect = `
  summary.id, summary.final_text, summary.confirmed_at, summary.confirmed_by, account.display_name, summary.summary_input_set_id,
  draft.id AS draft_id, draft.draft_text AS draft_text, draft.provider AS draft_provider, draft.model AS draft_model,
  draft.requested_at AS draft_requested_at, draft.summary_input_set_id AS draft_summary_input_set_id`;

export const confirmedSummaryJoins = `
  JOIN identity_accounts account ON account.id = summary.confirmed_by
  LEFT JOIN summary_ai_drafts draft ON draft.id = summary.initial_draft_id`;

/**
 * The confirmed summary of a submission, or null. This is the only gate Stories 10.4 and 11.x may use to treat a
 * summary as approved. Read only.
 */
export async function getConfirmedSummary(client: Pool | PoolClient, submissionId: string): Promise<ConfirmedSummary | null> {
  const result = await client.query<ConfirmedSummaryRow>(
    `SELECT ${confirmedSummarySelect} FROM confirmed_summaries summary ${confirmedSummaryJoins} WHERE summary.submission_id = $1`,
    [submissionId],
  );
  return result.rows[0] ? toConfirmedSummary(result.rows[0]) : null;
}

/** True when a confirmed summary exists for the submission. Used by the lock on insight, decision and draft changes. */
export async function isSummaryConfirmed(client: Pool | PoolClient, submissionId: string): Promise<boolean> {
  const result = await client.query("SELECT 1 FROM confirmed_summaries WHERE submission_id = $1", [submissionId]);
  return result.rows.length > 0;
}

/**
 * Takes the per-task transaction lock that serializes confirmation against insight, decision and draft changes.
 * Released at commit or rollback.
 */
export async function lockTaskSummary(transaction: PoolClient, taskId: string): Promise<void> {
  await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended('summary:' || $1::text, 0))", [taskId]);
}
