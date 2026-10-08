import type { InsightProposalSet, ManualInsight } from "@cetem-qc/domain";
import type { Pool } from "pg";
import { evaluateProposalsForSnapshot, isConsistentSnapshot, reviewCommandTestSeams } from "../commands/record-review-access.js";
import { getAcceptedSubmissionByTask } from "./accepted-submission.js";
import type { AcceptedSubmissionSnapshot } from "./accepted-submission.js";
import { getCurrentInsightDecisions } from "./insight-decisions.js";
import type { EvidenceInsightDecision } from "./insight-decisions.js";
import { getManualInsights } from "./manual-insights.js";

export type CompletedEvidenceOutcome =
  | { type: "read"; evidence: AcceptedSubmissionSnapshot; insights: InsightProposalSet; insightDecisions: EvidenceInsightDecision[]; manualInsights: ManualInsight[] }
  | { type: "not-found" }
  | { type: "inconsistent" };

/**
 * The accepted evidence of a task the caller has already authorized (history, Story 11.5). Read only: unlike the W4
 * review it inserts no access row, and it re-decides nothing. An inconsistent snapshot returns nothing.
 */
export async function readCompletedEvidence(pool: Pool, authorizedTaskId: string): Promise<CompletedEvidenceOutcome> {
  const stored = await getAcceptedSubmissionByTask(pool, authorizedTaskId);
  if (!stored) return { type: "not-found" };
  const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
  if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" };
  const insights = evaluateProposalsForSnapshot(evidence);
  const insightDecisions = await getCurrentInsightDecisions(pool, evidence.submissionId);
  const manualInsights = await getManualInsights(pool, evidence.submissionId);
  return { type: "read", evidence, insights, insightDecisions, manualInsights };
}
