import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { isConsistentSnapshot, reviewCommandTestSeams } from "../../audits/commands/record-review-access.js";
import { getAcceptedSubmissionForReview } from "../../audits/queries/accepted-submission.js";
import { getCurrentConformityDecision } from "../../conformity/index.js";
import { getReadyFile, getStoredFileStatus } from "../../files/index.js";
import { getSummaryState, lockTaskSummary } from "../../summaries/index.js";
import { hasOfficialReport } from "../queries/official-report.js";
import { candidateSelect, presentCandidateRows } from "../queries/report-candidates.js";
import type { CandidateRow, ReportCandidate } from "../queries/report-candidates.js";

export interface AttachPdfReportCandidateDeps {
  pool: Pool;
}

export type AttachPdfReportCandidateOutcome =
  | { type: "attached"; candidate: ReportCandidate }
  | { type: "replayed"; candidate: ReportCandidate }
  | { type: "not-found" }
  | { type: "official-designated" }
  | { type: "not-confirmed" }
  | { type: "not-decided" }
  | { type: "file-not-ready" }
  | { type: "already-attached" }
  | { type: "attempt-conflict" }
  | { type: "inconsistent" };

async function readCandidates(client: PoolClient, where: string, params: unknown[]): Promise<CandidateRow[]> {
  return (await client.query<CandidateRow>(`${candidateSelect} WHERE ${where}`, params)).rows;
}

/**
 * Attaches a `ready` stored PDF as a report candidate (AD-8, AD-9). One transaction under the per-task lock: the candidate
 * is bound to the audit revision, the confirmed summary and the conformity decision, and its `ready` outcome is recorded
 * with a copy of the file's name, size and SHA-256. Reports keep no storage key; the binary stays behind `files`.
 * Writes only the two insert-only report tables.
 */
export async function attachPdfReportCandidate(
  deps: AttachPdfReportCandidateDeps, responsableId: string, taskId: string, fileId: string, attemptId: string,
): Promise<AttachPdfReportCandidateOutcome> {
  return withTransaction(deps.pool, async (transaction): Promise<AttachPdfReportCandidateOutcome> => {
    await lockTaskSummary(transaction, taskId);
    const stored = await getAcceptedSubmissionForReview(transaction, responsableId, taskId);
    if (!stored) return { type: "not-found" };
    const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
    if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" };

    const replay = async (): Promise<AttachPdfReportCandidateOutcome | undefined> => {
      const [found] = await readCandidates(transaction, "candidate.attempt_id = $1", [attemptId]);
      if (!found) return undefined;
      if (found.task_id !== evidence.taskId || found.stored_file_id !== fileId) return { type: "attempt-conflict" };
      const [candidate] = await presentCandidateRows(transaction, [found], evidence.submissionId);
      return { type: "replayed", candidate: candidate! };
    };
    const replayed = await replay();
    if (replayed) return replayed;

    if (await hasOfficialReport(transaction, evidence.taskId)) return { type: "official-designated" };
    const status = await getStoredFileStatus(transaction, { taskId: evidence.taskId, fileId });
    if (!status) return { type: "not-found" };
    const state = await getSummaryState(transaction, evidence.submissionId);
    if (state.state !== "confirmed") return { type: "not-confirmed" };
    const decision = await getCurrentConformityDecision(transaction, evidence.submissionId);
    if (!decision) return { type: "not-decided" };
    const file = status === "ready" ? await getReadyFile(transaction, { taskId: evidence.taskId, fileId }) : undefined;
    if (!file) return { type: "file-not-ready" };

    const [same] = await readCandidates(transaction, "candidate.stored_file_id = $1 AND candidate.confirmed_summary_id = $2 AND candidate.conformity_decision_id = $3", [fileId, state.summary.id, decision.id]);
    if (same) return { type: "already-attached" };

    const inserted = await transaction.query<{ id: string }>(
      `INSERT INTO report_candidates (attempt_id, task_id, audit_id, submission_id, audit_revision, confirmed_summary_id, summary_version,
                                      conformity_decision_id, origin, stored_file_id, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded-pdf', $9, $10)
       ON CONFLICT DO NOTHING RETURNING id`,
      [attemptId, evidence.taskId, evidence.auditId, evidence.submissionId, evidence.revision, state.summary.id, state.summary.version,
        decision.id, file.id, responsableId],
    );
    const id = inserted.rows[0]?.id;
    // A concurrent request inserted first: describe what it stored instead of creating a second candidate.
    if (!id) return (await replay()) ?? { type: "already-attached" };
    await transaction.query(
      `INSERT INTO report_candidate_outcomes (candidate_id, outcome, storage_ref, file_name, byte_size, sha256)
       VALUES ($1, 'ready', NULL, $2, $3, $4)`,
      [id, file.fileName, file.byteSize, file.sha256],
    );
    const [row] = await readCandidates(transaction, "candidate.id = $1", [id]);
    const [candidate] = await presentCandidateRows(transaction, [row!], evidence.submissionId);
    return { type: "attached", candidate: candidate! };
  });
}
