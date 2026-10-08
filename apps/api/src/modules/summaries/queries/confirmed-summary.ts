import type { Pool, PoolClient, QueryResultRow } from "pg";

export interface ConfirmedSummary {
  id: string;
  version: number;
  text: string;
  confirmedAt: string;
  confirmedBy: { id: string; displayName: string };
  summaryInputSetId: string;
  initialDraft: { id: string; text: string; provider: string; model: string; requestedAt: string; summaryInputSetId: string } | null;
}

export interface ConfirmedSummaryRow extends QueryResultRow {
  id: string;
  version: number;
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
  version: row.version,
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
  summary.id, summary.version, summary.final_text, summary.confirmed_at, summary.confirmed_by, account.display_name, summary.summary_input_set_id,
  draft.id AS draft_id, draft.draft_text AS draft_text, draft.provider AS draft_provider, draft.model AS draft_model,
  draft.requested_at AS draft_requested_at, draft.summary_input_set_id AS draft_summary_input_set_id`;

export const confirmedSummaryJoins = `
  JOIN identity_accounts account ON account.id = summary.confirmed_by
  LEFT JOIN summary_ai_drafts draft ON draft.id = summary.initial_draft_id`;

export type SummaryState =
  | { state: "confirmed"; summary: ConfirmedSummary }
  | { state: "open"; nextVersion: number };

/**
 * The current state of the summary of a submission: the highest-version confirmed row is current while it has no
 * reopening row; otherwise the summary is open and the next confirmation takes `nextVersion`. Read only.
 */
export async function getSummaryState(client: Pool | PoolClient, submissionId: string): Promise<SummaryState> {
  const result = await client.query<ConfirmedSummaryRow & { reopened: boolean }>(
    `SELECT ${confirmedSummarySelect},
            EXISTS (SELECT 1 FROM summary_reopenings reopening WHERE reopening.confirmed_summary_id = summary.id) AS reopened
     FROM confirmed_summaries summary ${confirmedSummaryJoins}
     WHERE summary.submission_id = $1 ORDER BY summary.version DESC LIMIT 1`,
    [submissionId],
  );
  const row = result.rows[0];
  if (!row) return { state: "open", nextVersion: 1 };
  if (row.reopened) return { state: "open", nextVersion: row.version + 1 };
  return { state: "confirmed", summary: toConfirmedSummary(row) };
}

/**
 * The current confirmed summary of a submission, or null (never confirmed, or reopened and not yet confirmed again).
 * This is the only gate Stories 10.4 and 11.x may use to treat a summary as approved: their records bind to its `id`
 * and are current only while it equals this value. Read only.
 */
export async function getConfirmedSummary(client: Pool | PoolClient, submissionId: string): Promise<ConfirmedSummary | null> {
  const state = await getSummaryState(client, submissionId);
  return state.state === "confirmed" ? state.summary : null;
}

/** True when the submission has a current confirmed summary. Used by the lock on insight, decision and draft changes. */
export async function isSummaryConfirmed(client: Pool | PoolClient, submissionId: string): Promise<boolean> {
  return (await getSummaryState(client, submissionId)).state === "confirmed";
}

export interface SummaryHistoryEntry {
  version: number;
  text: string;
  confirmedAt: string;
  confirmedBy: { id: string; displayName: string };
  reopenedAt: string;
  reopenedBy: { id: string; displayName: string };
  initialDraft: ConfirmedSummary["initialDraft"];
}

/** Earlier versions that were reopened, newest first. Read only. */
export async function getSummaryHistory(client: Pool | PoolClient, submissionId: string): Promise<SummaryHistoryEntry[]> {
  const result = await client.query<ConfirmedSummaryRow & { reopened_at: Date; reopened_by: string; reopener_name: string }>(
    `SELECT ${confirmedSummarySelect}, reopening.reopened_at, reopening.reopened_by, reopener.display_name AS reopener_name
     FROM confirmed_summaries summary ${confirmedSummaryJoins}
     JOIN summary_reopenings reopening ON reopening.confirmed_summary_id = summary.id
     JOIN identity_accounts reopener ON reopener.id = reopening.reopened_by
     WHERE summary.submission_id = $1 ORDER BY summary.version DESC`,
    [submissionId],
  );
  return result.rows.map((row) => {
    const summary = toConfirmedSummary(row);
    return {
      version: summary.version, text: summary.text, confirmedAt: summary.confirmedAt, confirmedBy: summary.confirmedBy,
      reopenedAt: row.reopened_at.toISOString(), reopenedBy: { id: row.reopened_by, displayName: row.reopener_name },
      initialDraft: summary.initialDraft,
    };
  });
}

/**
 * Takes the per-task transaction lock that serializes confirmation against insight, decision and draft changes.
 * Released at commit or rollback.
 */
export async function lockTaskSummary(transaction: PoolClient, taskId: string): Promise<void> {
  await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended('summary:' || $1::text, 0))", [taskId]);
}
