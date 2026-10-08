import type { Pool } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { isConsistentSnapshot, reviewCommandTestSeams } from "../../audits/commands/record-review-access.js";
import { getAcceptedSubmissionForReview } from "../../audits/queries/accepted-submission.js";
import { getCurrentConformityDecision } from "../../conformity/index.js";
import { getStoredFileStatus } from "../../files/index.js";
import { getSummaryState, lockTaskSummary } from "../../summaries/index.js";
import { readOfficialReport } from "../queries/official-report.js";
import type { OfficialReport } from "../queries/official-report.js";
import { candidateSelect } from "../queries/report-candidates.js";
import type { CandidateRow } from "../queries/report-candidates.js";

export interface DesignateReportCandidateDeps {
  pool: Pool;
}

export type DesignateReportCandidateOutcome =
  | { type: "designated"; official: OfficialReport }
  | { type: "replayed"; official: OfficialReport }
  | { type: "not-found" }
  | { type: "not-ready" }
  | { type: "outdated" }
  | { type: "already-official" }
  | { type: "inconsistent" };

/**
 * Designates one ready, current candidate as the official report of the task (AD-8). One transaction under the per-task
 * lock rechecks the bindings and, for a PDF, the stored file, then inserts the single insert-only `official_reports` row.
 * Calls no storage, scanner or generator and writes nothing else. Check order: not-found, already-official/replay,
 * not-ready, outdated.
 */
export async function designateReportCandidate(
  deps: DesignateReportCandidateDeps, responsableId: string, taskId: string, candidateId: string,
): Promise<DesignateReportCandidateOutcome> {
  return withTransaction(deps.pool, async (transaction): Promise<DesignateReportCandidateOutcome> => {
    await lockTaskSummary(transaction, taskId);
    const stored = await getAcceptedSubmissionForReview(transaction, responsableId, taskId);
    if (!stored) return { type: "not-found" };
    const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
    if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" };

    const found = (await transaction.query<CandidateRow>(`${candidateSelect} WHERE candidate.id = $1 AND candidate.task_id = $2`, [candidateId, evidence.taskId])).rows[0];
    if (!found) return { type: "not-found" };

    const existing = await readOfficialReport(transaction, evidence.taskId);
    if (existing) return existing.candidateId === found.id ? { type: "replayed", official: existing } : { type: "already-official" };

    if (found.outcome === null || found.outcome === "failed") return { type: "not-ready" };

    const state = await getSummaryState(transaction, evidence.submissionId);
    const decision = await getCurrentConformityDecision(transaction, evidence.submissionId);
    const fresh = found.outcome === "ready"
      && state.state === "confirmed" && found.confirmed_summary_id === state.summary.id
      && decision != null && found.conformity_decision_id === decision.id
      && found.submission_id === evidence.submissionId && found.audit_revision === evidence.revision;
    if (!fresh) return { type: "outdated" };

    if (found.origin === "uploaded-pdf") {
      const fileStatus = await getStoredFileStatus(transaction, { taskId: evidence.taskId, fileId: found.stored_file_id! });
      if (fileStatus !== "ready") return { type: "outdated" };
    }

    const inserted = await transaction.query(
      `INSERT INTO official_reports (task_id, candidate_id, submission_id, designated_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
      [evidence.taskId, found.id, evidence.submissionId, responsableId],
    );
    const official = await readOfficialReport(transaction, evidence.taskId);
    if (!official) return { type: "inconsistent" };
    if (inserted.rows.length > 0) return { type: "designated", official };
    // The per-task lock serializes designations, so a conflict means a row appeared meanwhile: describe it.
    return official.candidateId === found.id ? { type: "replayed", official } : { type: "already-official" };
  });
}
