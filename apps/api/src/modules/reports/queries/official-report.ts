import type { Pool, PoolClient } from "pg";
import { getAcceptedSubmissionForReview } from "../../audits/queries/accepted-submission.js";
import { getConformityOutcomes } from "../../conformity/index.js";
import type { ConformityOutcome } from "../../conformity/index.js";
import type { ReportOrigin } from "./report-candidates.js";

export interface OfficialReport {
  id: string;
  candidateId: string;
  origin: ReportOrigin;
  designatedAt: string;
  designatedBy: { id: string; displayName: string };
  taskId: string;
  auditId: string;
  auditRevision: number;
  submissionId: string;
  bindings: { summaryId: string; summaryVersion: number; conformityDecisionId: string; conformityOutcome: ConformityOutcome };
  template: { id: string; version: string } | null;
  source: { fileId: string } | null;
  file: { name: string; byteSize: number; sha256: string };
}

interface OfficialRow {
  id: string;
  candidate_id: string;
  origin: ReportOrigin;
  designated_at: Date;
  designated_by: string;
  display_name: string;
  task_id: string;
  audit_id: string;
  audit_revision: number;
  submission_id: string;
  confirmed_summary_id: string;
  summary_version: number;
  conformity_decision_id: string;
  template_id: string | null;
  template_version: string | null;
  stored_file_id: string | null;
  file_name: string;
  byte_size: number;
  sha256: string;
}

/** The official report row of a task joined to its candidate and the file metadata the candidate outcome retained. */
export async function readOfficialReport(client: Pool | PoolClient, taskId: string): Promise<OfficialReport | undefined> {
  const result = await client.query<OfficialRow>(
    `SELECT official.id, official.candidate_id, candidate.origin, official.designated_at, official.designated_by, account.display_name,
            official.task_id, candidate.audit_id, candidate.audit_revision, official.submission_id,
            candidate.confirmed_summary_id, candidate.summary_version, candidate.conformity_decision_id,
            candidate.template_id, candidate.template_version, candidate.stored_file_id,
            outcome.file_name, outcome.byte_size, outcome.sha256
     FROM official_reports official
     JOIN report_candidates candidate ON candidate.id = official.candidate_id
     JOIN report_candidate_outcomes outcome ON outcome.candidate_id = candidate.id
     JOIN identity_accounts account ON account.id = official.designated_by
     WHERE official.task_id = $1`,
    [taskId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const outcomes = await getConformityOutcomes(client, [row.conformity_decision_id]);
  return {
    id: row.id,
    candidateId: row.candidate_id,
    origin: row.origin,
    designatedAt: row.designated_at.toISOString(),
    designatedBy: { id: row.designated_by, displayName: row.display_name },
    taskId: row.task_id,
    auditId: row.audit_id,
    auditRevision: row.audit_revision,
    submissionId: row.submission_id,
    bindings: {
      summaryId: row.confirmed_summary_id, summaryVersion: row.summary_version,
      conformityDecisionId: row.conformity_decision_id, conformityOutcome: outcomes.get(row.conformity_decision_id)!,
    },
    template: row.template_id !== null ? { id: row.template_id, version: row.template_version! } : null,
    source: row.stored_file_id !== null ? { fileId: row.stored_file_id } : null,
    file: { name: row.file_name, byteSize: row.byte_size, sha256: row.sha256 },
  };
}

/** The official report of an owned task with an accepted submission, or undefined for anything else. Read only. */
export async function getOfficialReport(client: Pool | PoolClient, responsableId: string, taskId: string): Promise<OfficialReport | undefined> {
  const snapshot = await getAcceptedSubmissionForReview(client, responsableId, taskId);
  if (!snapshot) return undefined;
  return readOfficialReport(client, snapshot.taskId);
}

/** True when the task (optionally for the given submission) has an official report. */
export async function hasOfficialReport(client: Pool | PoolClient, taskId: string, submissionId?: string): Promise<boolean> {
  const result = submissionId === undefined
    ? await client.query("SELECT 1 FROM official_reports WHERE task_id = $1", [taskId])
    : await client.query("SELECT 1 FROM official_reports WHERE task_id = $1 AND submission_id = $2", [taskId, submissionId]);
  return result.rows.length > 0;
}
