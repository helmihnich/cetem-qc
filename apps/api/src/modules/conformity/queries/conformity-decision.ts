import type { Pool, PoolClient } from "pg";
import { getConfirmedSummary, getConfirmedSummaryVersion } from "../../summaries/index.js";

export type ConformityOutcome = "machine-conforme" | "machine-non-conforme";

export interface ConformityDecision {
  id: string;
  outcome: ConformityOutcome;
  decidedAt: string;
  decidedBy: { id: string; displayName: string };
  summaryId: string;
  summaryVersion: number;
}

export interface ConformityHistoryItem extends ConformityDecision {
  invalidatedAt: string | null;
}

interface DecisionRow {
  id: string;
  outcome: ConformityOutcome;
  decided_at: Date;
  decided_by: string;
  display_name: string;
  confirmed_summary_id: string;
  invalidated_at: Date | null;
}

const decisionSelect = `
  SELECT decision.id, decision.outcome, decision.decided_at, decision.decided_by, account.display_name,
         decision.confirmed_summary_id, invalidation.invalidated_at
  FROM conformity_decisions decision
  JOIN identity_accounts account ON account.id = decision.decided_by
  LEFT JOIN conformity_decision_invalidations invalidation ON invalidation.decision_id = decision.id`;

const toDecision = (row: DecisionRow, summaryVersion: number): ConformityDecision => ({
  id: row.id,
  outcome: row.outcome,
  decidedAt: row.decided_at.toISOString(),
  decidedBy: { id: row.decided_by, displayName: row.display_name },
  summaryId: row.confirmed_summary_id,
  summaryVersion,
});

/**
 * The decision bound to the current confirmed summary, or null. Currentness is by binding: the invalidation row is
 * not consulted, so a decision of an older summary can never be returned as current. Read only.
 */
export async function getCurrentConformityDecision(client: Pool | PoolClient, submissionId: string): Promise<ConformityDecision | null> {
  const summary = await getConfirmedSummary(client, submissionId);
  if (!summary) return null;
  const result = await client.query<DecisionRow>(`${decisionSelect} WHERE decision.confirmed_summary_id = $1`, [summary.id]);
  const row = result.rows[0];
  return row ? toDecision(row, summary.version) : null;
}

/** The outcome of each given decision, by decision id (current or historical). Read only. */
export async function getConformityOutcomes(client: Pool | PoolClient, decisionIds: readonly string[]): Promise<Map<string, ConformityOutcome>> {
  if (decisionIds.length === 0) return new Map();
  const result = await client.query<{ id: string; outcome: ConformityOutcome }>(
    "SELECT id, outcome FROM conformity_decisions WHERE id = ANY($1::uuid[])", [decisionIds],
  );
  return new Map(result.rows.map((row) => [row.id, row.outcome]));
}

/** Decisions that are not current (bound to a replaced summary), newest first. Read only. */
export async function getConformityHistory(client: Pool | PoolClient, submissionId: string): Promise<ConformityHistoryItem[]> {
  const current = await getConfirmedSummary(client, submissionId);
  const result = await client.query<DecisionRow>(
    `${decisionSelect} WHERE decision.submission_id = $1 AND ($2::uuid IS NULL OR decision.confirmed_summary_id <> $2::uuid)
     ORDER BY decision.seq DESC`,
    [submissionId, current?.id ?? null],
  );
  const items: ConformityHistoryItem[] = [];
  for (const row of result.rows) {
    const version = await getConfirmedSummaryVersion(client, row.confirmed_summary_id);
    items.push({ ...toDecision(row, version ?? 1), invalidatedAt: row.invalidated_at ? row.invalidated_at.toISOString() : null });
  }
  return items;
}
