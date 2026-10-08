import { createHash } from "node:crypto";
import { buildSummaryInputSet, canonicalJson, collectRetainedInsights } from "@cetem-qc/domain";
import type { SummaryInputSet } from "@cetem-qc/domain";
import type { PoolClient } from "pg";
import { evaluateProposalsForSnapshot } from "../audits/commands/record-review-access.js";
import type { AcceptedSubmissionSnapshot } from "../audits/queries/accepted-submission.js";
import { getCurrentInsightDecisions } from "../audits/queries/insight-decisions.js";
import { getManualInsights } from "../audits/queries/manual-insights.js";

/**
 * The single place the summary input set and its SHA-256 identity are built: from the stored snapshot and the insights
 * retained as of now. Used by the draft request and by the confirmation so the two cannot diverge.
 */
export async function buildInputSetForSnapshot(
  transaction: PoolClient, evidence: AcceptedSubmissionSnapshot,
): Promise<{ inputSet: SummaryInputSet; summaryInputSetId: string }> {
  const proposals = evaluateProposalsForSnapshot(evidence);
  const decisions = await getCurrentInsightDecisions(transaction, evidence.submissionId);
  const manualInsights = await getManualInsights(transaction, evidence.submissionId);
  const retained = collectRetainedInsights(proposals.proposals, decisions, manualInsights);
  const inputSet = buildSummaryInputSet({ identity: evidence.identity, values: evidence.payload.values, results: evidence.results }, retained);
  return { inputSet, summaryInputSetId: createHash("sha256").update(canonicalJson(inputSet)).digest("hex") };
}
