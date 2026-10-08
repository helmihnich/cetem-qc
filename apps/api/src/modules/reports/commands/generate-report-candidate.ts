import { createHash } from "node:crypto";
import { buildReportDocument } from "@cetem-qc/i18n/report-document";
import type { ReportDocumentInput } from "@cetem-qc/i18n/report-document";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { isConsistentSnapshot, reviewCommandTestSeams } from "../../audits/commands/record-review-access.js";
import { getAcceptedSubmissionForReview } from "../../audits/queries/accepted-submission.js";
import { getCurrentConformityDecision } from "../../conformity/index.js";
import type { ObjectStorage } from "../../files/index.js";
import { getSummaryState, lockTaskSummary } from "../../summaries/index.js";
import type { ReportDocumentGenerator } from "../ports/report-document-generator.js";
import { candidateSelect, getCurrentBindings, presentCandidateRows } from "../queries/report-candidates.js";
import type { CandidateRow, ReportCandidate, ReportFailureClass } from "../queries/report-candidates.js";

export interface GenerateReportCandidateDeps {
  pool: Pool;
  storage: ObjectStorage;
  generator: ReportDocumentGenerator;
}

export type GenerateReportCandidateOutcome =
  | { type: "ready"; candidate: ReportCandidate }
  | { type: "replayed-ready"; candidate: ReportCandidate }
  | { type: "failed"; candidate: ReportCandidate; failureClass: ReportFailureClass }
  | { type: "replayed-failed"; candidate: ReportCandidate; failureClass: ReportFailureClass }
  | { type: "inputs-changed"; candidate: ReportCandidate }
  | { type: "not-found" }
  | { type: "not-confirmed" }
  | { type: "not-decided" }
  | { type: "attempt-conflict" }
  | { type: "inconsistent" };

/** Test-only seams: the production wiring supplies the configured storage and the Word generator. Never set in production. */
export const reportCommandTestSeams: { storage?: ObjectStorage; generator?: ReportDocumentGenerator } = {};

type Bound = { candidateId: string; summaryId: string; decisionId: string };
type FirstTransaction =
  | { type: "insert"; bound: Bound; input: ReportDocumentInput; requestedAt: Date; row: CandidateRow }
  | { type: "replay"; candidate: ReportCandidate; stored: CandidateRow["outcome"]; failureClass: ReportFailureClass | null }
  | Exclude<GenerateReportCandidateOutcome, { type: "ready" | "replayed-ready" | "failed" | "replayed-failed" | "inputs-changed" }>;

const fileNameOf = (candidateId: string, requestedAt: Date): string =>
  `Rapport-LCQ-candidat-${requestedAt.toISOString().slice(0, 10).replaceAll("-", "")}-${candidateId.replaceAll("-", "").slice(0, 8)}.docx`;

/**
 * Generates a Word report candidate (AD-8 insert-then-complete). Transaction A binds the candidate to the audit
 * revision, the confirmed summary and the conformity decision; the document is generated and stored outside any
 * transaction; transaction B takes the per-task lock again, rechecks that the bound summary and decision are still
 * current and records the outcome. Writes only the two insert-only report tables and one stored object.
 */
export async function generateReportCandidate(
  deps: GenerateReportCandidateDeps, responsableId: string, taskId: string, attemptId: string,
): Promise<GenerateReportCandidateOutcome> {
  const { pool, storage, generator } = deps;
  const first = await withTransaction(pool, (transaction) => bindCandidate(transaction, generator, responsableId, taskId, attemptId));
  if (first.type === "replay") {
    if (first.stored === "failed") return { type: "replayed-failed", candidate: first.candidate, failureClass: first.failureClass! };
    if (first.stored === "outdated") return { type: "inputs-changed", candidate: first.candidate };
    return { type: "replayed-ready", candidate: first.candidate };
  }
  if (first.type !== "insert") return first;

  const { bound, input, requestedAt, row } = first;
  const storageRef = `reports/${bound.candidateId}.docx`;
  let bytes: Uint8Array | undefined;
  let failureClass: ReportFailureClass | undefined;
  try {
    bytes = (await generator.generate(buildReportDocument(input))).bytes;
  } catch {
    failureClass = "generation-failed";
  }
  if (bytes) {
    try {
      await storage.put(storageRef, bytes);
    } catch {
      failureClass = "storage-failed";
      await storage.remove(storageRef).catch(() => undefined);
    }
  }

  try {
    return await withTransaction(pool, async (transaction): Promise<GenerateReportCandidateOutcome> => {
      await lockTaskSummary(transaction, taskId);
      if (failureClass || !bytes) {
        const failed = failureClass ?? "generation-failed";
        await transaction.query(
          "INSERT INTO report_candidate_outcomes (candidate_id, outcome, failure_class) VALUES ($1, 'failed', $2)", [bound.candidateId, failed],
        );
        const [candidate] = await presentCandidateRows(transaction, await readCandidate(transaction, bound.candidateId), row.submission_id);
        return { type: "failed", candidate: candidate!, failureClass: failed };
      }
      const current = await getCurrentBindings(transaction, row.submission_id);
      const stillCurrent = current.summaryId === bound.summaryId && current.decisionId === bound.decisionId;
      const fileName = fileNameOf(bound.candidateId, requestedAt);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await transaction.query(
        `INSERT INTO report_candidate_outcomes (candidate_id, outcome, storage_ref, file_name, byte_size, sha256)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bound.candidateId, stillCurrent ? "ready" : "outdated", storageRef, fileName, bytes.length, sha256],
      );
      const [candidate] = await presentCandidateRows(transaction, await readCandidate(transaction, bound.candidateId), row.submission_id);
      return stillCurrent ? { type: "ready", candidate: candidate! } : { type: "inputs-changed", candidate: candidate! };
    });
  } catch (error) {
    // The outcome could not be recorded: the candidate stays without outcome and the object is never referenced.
    if (bytes && !failureClass) await storage.remove(storageRef).catch(() => undefined);
    throw error;
  }
}

async function readCandidate(client: PoolClient, candidateId: string): Promise<CandidateRow[]> {
  return (await client.query<CandidateRow>(`${candidateSelect} WHERE candidate.id = $1`, [candidateId])).rows;
}

async function bindCandidate(
  transaction: PoolClient, generator: ReportDocumentGenerator, responsableId: string, taskId: string, attemptId: string,
): Promise<FirstTransaction> {
  await lockTaskSummary(transaction, taskId);
  const stored = await getAcceptedSubmissionForReview(transaction, responsableId, taskId);
  if (!stored) return { type: "not-found" };
  const evidence = reviewCommandTestSeams.snapshot ? reviewCommandTestSeams.snapshot(stored) : stored;
  if (!isConsistentSnapshot(evidence.identity, evidence.results)) return { type: "inconsistent" };

  const replay = async (): Promise<FirstTransaction | undefined> => {
    const existing = await transaction.query<CandidateRow>(`${candidateSelect} WHERE candidate.attempt_id = $1`, [attemptId]);
    const found = existing.rows[0];
    if (!found) return undefined;
    if (found.task_id !== evidence.taskId) return { type: "attempt-conflict" };
    const [candidate] = await presentCandidateRows(transaction, [found], evidence.submissionId);
    return { type: "replay", candidate: candidate!, stored: found.outcome, failureClass: found.failure_class };
  };
  const replayed = await replay();
  if (replayed) return replayed;

  const state = await getSummaryState(transaction, evidence.submissionId);
  if (state.state !== "confirmed") return { type: "not-confirmed" };
  const decision = await getCurrentConformityDecision(transaction, evidence.submissionId);
  if (!decision) return { type: "not-decided" };

  const inserted = await transaction.query<{ id: string }>(
    `INSERT INTO report_candidates (attempt_id, task_id, audit_id, submission_id, audit_revision, confirmed_summary_id, summary_version,
                                    conformity_decision_id, origin, template_id, template_version, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'generated-word', $9, $10, $11)
     ON CONFLICT (attempt_id) DO NOTHING RETURNING id`,
    [attemptId, evidence.taskId, evidence.auditId, evidence.submissionId, evidence.revision, state.summary.id, state.summary.version,
      decision.id, generator.templateId, generator.templateVersion, responsableId],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    // Another request inserted this attempt first: describe the stored candidate instead of creating a second one.
    return (await replay()) ?? { type: "attempt-conflict" };
  }
  const row = (await readCandidate(transaction, id))[0]!;
  const input: ReportDocumentInput = {
    values: evidence.payload.values, results: evidence.results, identity: evidence.identity,
    summary: { text: state.summary.text }, decision: { outcome: decision.outcome },
  };
  return { type: "insert", bound: { candidateId: id, summaryId: state.summary.id, decisionId: decision.id }, input, requestedAt: row.requested_at, row };
}
