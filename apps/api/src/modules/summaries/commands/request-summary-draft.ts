import { createHash } from "node:crypto";
import { buildSummaryInputSet, buildSummaryPrompt, canonicalJson, collectRetainedInsights, summaryInputSetPlainObject } from "@cetem-qc/domain";
import type { Pool } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { AI_REQUEST_TIMEOUT_MS, SummaryProviderError } from "../../ai/index.js";
import type { SummaryDraftProvider, SummaryFailureClass } from "../../ai/index.js";
import { evaluateProposalsForSnapshot, isConsistentSnapshot, reviewCommandTestSeams } from "../../audits/commands/record-review-access.js";
import { getAcceptedSubmissionForReview } from "../../audits/queries/accepted-submission.js";
import { getCurrentInsightDecisions } from "../../audits/queries/insight-decisions.js";
import { getManualInsights } from "../../audits/queries/manual-insights.js";

export interface SummaryAiDraft {
  id: string;
  status: "generated";
  text: string;
  provider: string;
  model: string;
  requestedAt: string;
  requestedBy: { id: string; displayName: string };
  summaryInputSetId: string;
}

export type RequestSummaryDraftOutcome =
  | { type: "generated"; draft: SummaryAiDraft; durationMs: number }
  | { type: "failed"; failureClass: SummaryFailureClass; provider: string; durationMs: number }
  | { type: "not-found" }
  | { type: "inconsistent" };

/** Test-only seams: replace the provider the route uses, or observe the moment just before the provider call. Never set in production. */
export const summaryCommandTestSeams: {
  provider?: SummaryDraftProvider;
  beforeProviderCall?: (prompt: string) => Promise<void> | void;
  timeoutMs?: number;
} = {};

interface DraftRow {
  id: string;
  text: string | null;
  requested_at: Date;
  requested_by: string;
  display_name: string;
}

/** Runs the provider with a hard time bound; a provider that ignores the signal is still cut off. */
async function callProvider(provider: SummaryDraftProvider, prompt: string): Promise<{ text: string } | { failureClass: SummaryFailureClass }> {
  const signal = AbortSignal.timeout(summaryCommandTestSeams.timeoutMs ?? AI_REQUEST_TIMEOUT_MS);
  const cutOff = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new SummaryProviderError("timeout")), { once: true });
  });
  try {
    const text = await Promise.race([provider.generate(prompt, { signal }), cutOff]);
    if (typeof text !== "string" || text.trim() === "") return { failureClass: "empty-output" };
    return { text: text.trim() };
  } catch (error) {
    // Only the fixed class is kept: never the provider's message.
    return { failureClass: error instanceof SummaryProviderError ? error.failureClass : "provider-error" };
  }
}

/**
 * Requests one AI summary draft for the accepted snapshot of an own-team task. The server alone builds the input set
 * from the stored snapshot and the retained insights as of now. The provider is called outside any transaction and
 * exactly one insert-only row records the attempt, successful or failed.
 */
export async function requestSummaryDraft(
  pool: Pool, provider: SummaryDraftProvider, responsableId: string, taskId: string,
): Promise<RequestSummaryDraftOutcome> {
  const prepared = await withTransaction(pool, async (transaction) => {
    const stored = await getAcceptedSubmissionForReview(transaction, responsableId, taskId);
    if (!stored) return { type: "not-found" as const };
    const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
    if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" as const };
    const proposals = evaluateProposalsForSnapshot(evidence);
    const decisions = await getCurrentInsightDecisions(transaction, evidence.submissionId);
    const manualInsights = await getManualInsights(transaction, evidence.submissionId);
    const retained = collectRetainedInsights(proposals.proposals, decisions, manualInsights);
    const inputSet = buildSummaryInputSet({ identity: evidence.identity, values: evidence.payload.values, results: evidence.results }, retained);
    return { type: "ready" as const, evidence, inputSet, summaryInputSetId: createHash("sha256").update(canonicalJson(inputSet)).digest("hex") };
  });
  if (prepared.type !== "ready") return prepared;

  const { evidence, inputSet, summaryInputSetId } = prepared;
  const prompt = buildSummaryPrompt(inputSet);
  await summaryCommandTestSeams.beforeProviderCall?.(prompt);
  const started = Date.now();
  const result = await callProvider(provider, prompt);
  const durationMs = Date.now() - started;

  const status = "text" in result ? "generated" : "failed";
  const row = await withTransaction(pool, async (transaction) => {
    const inserted = await transaction.query<DraftRow>(
      `WITH inserted AS (
         INSERT INTO summary_ai_drafts (requested_by, task_id, audit_id, submission_id, revision, revision_identity, summary_input_set_id, input_set, provider, model, status, failure_class, draft_text)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12, $13)
         RETURNING id, draft_text AS text, requested_at, requested_by
       )
       SELECT inserted.id, inserted.text, inserted.requested_at, inserted.requested_by, account.display_name
       FROM inserted JOIN identity_accounts account ON account.id = inserted.requested_by`,
      [
        responsableId, evidence.taskId, evidence.auditId, evidence.submissionId, evidence.revision, JSON.stringify(evidence.identity),
        summaryInputSetId, JSON.stringify(summaryInputSetPlainObject(inputSet)), provider.name, provider.model, status,
        "text" in result ? null : result.failureClass, "text" in result ? result.text : null,
      ],
    );
    return inserted.rows[0]!;
  });
  if (!("text" in result)) return { type: "failed", failureClass: result.failureClass, provider: provider.name, durationMs };
  return {
    type: "generated",
    durationMs,
    draft: {
      id: row.id, status: "generated", text: result.text, provider: provider.name, model: provider.model,
      requestedAt: row.requested_at.toISOString(), requestedBy: { id: row.requested_by, displayName: row.display_name }, summaryInputSetId,
    },
  };
}
