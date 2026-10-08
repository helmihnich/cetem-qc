import type { Pool, PoolClient } from "pg";
import { getAcceptedSubmissionForReview } from "../../audits/queries/accepted-submission.js";
import { getConformityOutcomes, getCurrentConformityDecision } from "../../conformity/index.js";
import type { ConformityOutcome } from "../../conformity/index.js";
import { getConfirmedSummary } from "../../summaries/index.js";

export type ReportCandidateStatus = "generating" | "ready" | "failed" | "outdated";
export type ReportFailureClass = "generation-failed" | "storage-failed";
export type StoredOutcome = "ready" | "failed" | "outdated";

export interface ReportCandidate {
  id: string;
  attemptId: string;
  origin: "generated-word";
  status: ReportCandidateStatus;
  requestedAt: string;
  requestedBy: { id: string; displayName: string };
  bindings: { auditRevision: number; summaryId: string; summaryVersion: number; conformityDecisionId: string; conformityOutcome: ConformityOutcome };
  template: { id: string; version: string };
  file: { name: string; byteSize: number; sha256: string } | null;
  failureClass: ReportFailureClass | null;
}

export interface CandidateRow {
  id: string;
  attempt_id: string;
  task_id: string;
  submission_id: string;
  audit_revision: number;
  confirmed_summary_id: string;
  summary_version: number;
  conformity_decision_id: string;
  template_id: string;
  template_version: string;
  requested_by: string;
  display_name: string;
  requested_at: Date;
  outcome: StoredOutcome | null;
  file_name: string | null;
  byte_size: number | null;
  sha256: string | null;
  failure_class: ReportFailureClass | null;
}

export const candidateSelect = `
  SELECT candidate.id, candidate.attempt_id, candidate.task_id, candidate.submission_id, candidate.audit_revision,
         candidate.confirmed_summary_id, candidate.summary_version, candidate.conformity_decision_id,
         candidate.template_id, candidate.template_version, candidate.requested_by, account.display_name, candidate.requested_at,
         outcome.outcome, outcome.file_name, outcome.byte_size, outcome.sha256, outcome.failure_class
  FROM report_candidates candidate
  JOIN identity_accounts account ON account.id = candidate.requested_by
  LEFT JOIN report_candidate_outcomes outcome ON outcome.candidate_id = candidate.id`;

/**
 * The status derived on every read: no outcome is `generating`; a `failed` outcome is `failed`; a `ready` outcome is
 * `ready` only while its bound summary and decision are still the current ones, otherwise (and for an `outdated`
 * outcome) it is `outdated`.
 */
export function deriveStatus(row: Pick<CandidateRow, "outcome" | "confirmed_summary_id" | "conformity_decision_id">, current: { summaryId: string | null; decisionId: string | null }): ReportCandidateStatus {
  if (row.outcome === null) return "generating";
  if (row.outcome === "failed") return "failed";
  if (row.outcome === "ready" && row.confirmed_summary_id === current.summaryId && row.conformity_decision_id === current.decisionId) return "ready";
  return "outdated";
}

export function toReportCandidate(row: CandidateRow, status: ReportCandidateStatus, conformityOutcome: ConformityOutcome): ReportCandidate {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    origin: "generated-word",
    status,
    requestedAt: row.requested_at.toISOString(),
    requestedBy: { id: row.requested_by, displayName: row.display_name },
    bindings: {
      auditRevision: row.audit_revision, summaryId: row.confirmed_summary_id, summaryVersion: row.summary_version,
      conformityDecisionId: row.conformity_decision_id, conformityOutcome,
    },
    template: { id: row.template_id, version: row.template_version },
    file: row.file_name !== null ? { name: row.file_name, byteSize: row.byte_size!, sha256: row.sha256! } : null,
    failureClass: row.failure_class,
  };
}

/** The ids of the current confirmed summary and current conformity decision of a submission. Read only. */
export async function getCurrentBindings(client: Pool | PoolClient, submissionId: string): Promise<{ summaryId: string | null; decisionId: string | null }> {
  const summary = await getConfirmedSummary(client, submissionId);
  const decision = await getCurrentConformityDecision(client, submissionId);
  return { summaryId: summary?.id ?? null, decisionId: decision?.id ?? null };
}

/** Maps candidate rows to contract candidates, deriving the status against the current bindings of the submission. */
export async function presentCandidateRows(client: Pool | PoolClient, rows: readonly CandidateRow[], currentSubmissionId: string): Promise<ReportCandidate[]> {
  const current = await getCurrentBindings(client, currentSubmissionId);
  const outcomes = await getConformityOutcomes(client, [...new Set(rows.map((row) => row.conformity_decision_id))]);
  return rows.map((row) => {
    const derived = deriveStatus(row, current);
    // A candidate of another submission can never be current.
    const status = derived === "ready" && row.submission_id !== currentSubmissionId ? "outdated" : derived;
    return toReportCandidate(row, status, outcomes.get(row.conformity_decision_id)!);
  });
}

/**
 * The report candidates of a task, newest first, for the Responsable who owns its team. Undefined for another team's
 * task, an unknown task or a task without accepted submission, without telling them apart. Read only.
 */
export async function listReportCandidates(client: Pool | PoolClient, responsableId: string, taskId: string): Promise<ReportCandidate[] | undefined> {
  const snapshot = await getAcceptedSubmissionForReview(client, responsableId, taskId);
  if (!snapshot) return undefined;
  const result = await client.query<CandidateRow>(`${candidateSelect} WHERE candidate.task_id = $1 ORDER BY candidate.seq DESC`, [snapshot.taskId]);
  return presentCandidateRows(client, result.rows, snapshot.submissionId);
}

export interface ReportCandidateFile {
  fileName: string;
  storageRef: string;
  byteSize: number;
  sha256: string;
}

/**
 * The stored file of a candidate whose outcome retained one (`ready` or `outdated`) on an owned task, or undefined for
 * anything else (failed, generating, unknown, another team's). Read only.
 */
export async function getReportCandidateFile(client: Pool | PoolClient, responsableId: string, taskId: string, candidateId: string): Promise<ReportCandidateFile | undefined> {
  const snapshot = await getAcceptedSubmissionForReview(client, responsableId, taskId);
  if (!snapshot) return undefined;
  const result = await client.query<{ storage_ref: string; file_name: string; byte_size: number; sha256: string }>(
    `SELECT outcome.storage_ref, outcome.file_name, outcome.byte_size, outcome.sha256
     FROM report_candidates candidate
     JOIN report_candidate_outcomes outcome ON outcome.candidate_id = candidate.id
     WHERE candidate.id = $1 AND candidate.task_id = $2 AND outcome.outcome IN ('ready', 'outdated')`,
    [candidateId, snapshot.taskId],
  );
  const row = result.rows[0];
  return row ? { fileName: row.file_name, storageRef: row.storage_ref, byteSize: row.byte_size, sha256: row.sha256 } : undefined;
}
