import { GRAPHIE_CALCULATION_IDENTITY, INSIGHT_RULE_REGISTRY, evaluateInsightProposals } from "@cetem-qc/domain";
import type { CalculationContext, GraphieCalculationIdentity, GraphieCalculationResults, InsightProposalSet, InsightRule } from "@cetem-qc/domain";
import { fr } from "@cetem-qc/i18n";
import type { Pool } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { getOwnTeamTaskSummary } from "../../tasks/queries/own-team-task.js";
import type { OwnTeamTaskSummary } from "../../tasks/queries/own-team-task.js";
import { getAcceptedSubmissionForReview } from "../queries/accepted-submission.js";
import type { AcceptedSubmissionSnapshot } from "../queries/accepted-submission.js";
import { getCurrentInsightDecisions } from "../queries/insight-decisions.js";
import type { EvidenceInsightDecision } from "../queries/insight-decisions.js";

export type OpenAcceptedEvidenceOutcome =
  | { type: "opened"; evidence: AcceptedSubmissionSnapshot; task: OwnTeamTaskSummary; insights: InsightProposalSet; insightDecisions: EvidenceInsightDecision[] }
  | { type: "not-found" }
  | { type: "inconsistent" };

/** Test-only seams: reshape the read snapshot, fail the access insert, or supply a synthetic insight registry. Never set in production. */
export const reviewCommandTestSeams: {
  snapshot?: (snapshot: AcceptedSubmissionSnapshot) => AcceptedSubmissionSnapshot;
  beforeAccessInsert?: () => Promise<void> | void;
  insightRegistry?: { rules: readonly InsightRule[]; templates: Readonly<Record<string, string>> };
} = {};

const testNames = ["voltageAccuracy", "voltageRepeatability", "outputRepeatability", "outputLinearity", "lightFieldCorrespondence"] as const;

const isSupportedIdentity = (identity: CalculationContext) =>
  (Object.keys(GRAPHIE_CALCULATION_IDENTITY) as Array<keyof CalculationContext>).every((key) => identity[key] === GRAPHIE_CALCULATION_IDENTITY[key]);

/**
 * True when the stored results were calculated under the revision's own rule identity. Reads the identity fields
 * the stored results already carry; it never recalculates and never calls a formula.
 */
export function isConsistentSnapshot(identity: CalculationContext, results: GraphieCalculationResults): boolean {
  return testNames.every((name) => {
    const result = results[name] as { formulaSource?: unknown; ruleId?: unknown; ruleVersion?: unknown } | null | undefined;
    if (!result || typeof result !== "object") return false;
    if (result.formulaSource) return result.ruleId === identity.ruleId && result.ruleVersion === identity.ruleVersion;
    return !isSupportedIdentity(identity);
  });
}

/**
 * Reads the accepted snapshot of an own-team task and records one insert-only access row, in one transaction.
 * If the record cannot be written the error propagates and nothing is returned.
 */
export async function openAcceptedEvidenceForReview(pool: Pool, responsableId: string, taskId: string): Promise<OpenAcceptedEvidenceOutcome> {
  return withTransaction(pool, async (transaction): Promise<OpenAcceptedEvidenceOutcome> => {
    const stored = await getAcceptedSubmissionForReview(transaction, responsableId, taskId);
    if (!stored) return { type: "not-found" };
    const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
    if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" };
    const task = await getOwnTeamTaskSummary(transaction, responsableId, evidence.taskId);
    if (!task) return { type: "not-found" };
    // Stateless and read only: a throw here fails the request before the access row is inserted.
    const insights = evaluateProposalsForSnapshot(evidence);
    await reviewCommandTestSeams.beforeAccessInsert?.();
    await transaction.query(
      "INSERT INTO audit_review_accesses (actor_id, task_id, audit_id, submission_id) VALUES ($1, $2, $3, $4)",
      [responsableId, evidence.taskId, evidence.auditId, evidence.submissionId],
    );
    const insightDecisions = await getCurrentInsightDecisions(transaction, evidence.submissionId);
    return { type: "opened", evidence, task, insights, insightDecisions };
  });
}

/** The single place proposals are evaluated for a snapshot, so opening and deciding cannot diverge. */
export function evaluateProposalsForSnapshot(evidence: AcceptedSubmissionSnapshot): InsightProposalSet {
  const seam = reviewCommandTestSeams.insightRegistry;
  return evaluateInsightProposals(
    { submissionId: evidence.submissionId, identity: evidence.identity as GraphieCalculationIdentity, values: evidence.payload.values, results: evidence.results },
    seam ? seam.rules : INSIGHT_RULE_REGISTRY,
    seam ? seam.templates : fr.insights.rules,
  );
}
