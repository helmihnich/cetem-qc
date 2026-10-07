import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import type { CalculationContext, GraphieCalculationResults } from "@cetem-qc/domain";
import type { Pool } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { getOwnTeamTaskSummary } from "../../tasks/queries/own-team-task.js";
import type { OwnTeamTaskSummary } from "../../tasks/queries/own-team-task.js";
import { getAcceptedSubmissionForReview } from "../queries/accepted-submission.js";
import type { AcceptedSubmissionSnapshot } from "../queries/accepted-submission.js";

export type OpenAcceptedEvidenceOutcome =
  | { type: "opened"; evidence: AcceptedSubmissionSnapshot; task: OwnTeamTaskSummary }
  | { type: "not-found" }
  | { type: "inconsistent" };

/** Test-only seams: reshape the read snapshot, or fail the access insert. Never set in production. */
export const reviewCommandTestSeams: {
  snapshot?: (snapshot: AcceptedSubmissionSnapshot) => AcceptedSubmissionSnapshot;
  beforeAccessInsert?: () => Promise<void> | void;
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
    await reviewCommandTestSeams.beforeAccessInsert?.();
    await transaction.query(
      "INSERT INTO audit_review_accesses (actor_id, task_id, audit_id, submission_id) VALUES ($1, $2, $3, $4)",
      [responsableId, evidence.taskId, evidence.auditId, evidence.submissionId],
    );
    return { type: "opened", evidence, task };
  });
}
