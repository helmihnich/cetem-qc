import { calculateGraphieResults } from "@cetem-qc/domain";
import type { CalculationContext, ValidatedGraphiePayload } from "@cetem-qc/domain";
import type { QueryResultRow } from "pg";
import type { Transaction } from "../../../db/transaction.js";

export type AuditActor = { id: string; displayName: string };

/** The task's current audit version; revision 0 and state `draft` when no operation was accepted yet. */
export type CurrentAudit = {
  auditId: string | null;
  revision: number;
  state: "draft" | "submitted";
  lastChangedAt: string | null;
  lastChangedBy: AuditActor | null;
};

export type AcceptOperationInput = {
  audit: CurrentAudit;
  taskId: string;
  actor: AuditActor;
  operationId: string;
  payload: ValidatedGraphiePayload;
  localDraftRevision: number;
  clientSavedAt: string;
  /** A validated, not yet linked conflict outcome this revision resolves (keep-local): recorded as lineage. */
  conflictOperationId?: string;
};

export type AcceptedOperation = { serverRevision: number; acceptedAt: string; submissionId?: string };

export class AuditIdentityMismatchError extends Error {
  constructor() {
    super("Server calculation results do not carry the revision identity.");
    this.name = "AuditIdentityMismatchError";
  }
}

/** Test-only seams: failure injection after the revision insert and a replaced calculation. Never set in production. */
export const auditCommandTestSeams: {
  afterRevisionInsert?: () => Promise<void> | void;
  calculate?: typeof calculateGraphieResults;
} = {};

interface AuditRow extends QueryResultRow {
  id: string;
  state: "draft" | "submitted";
  current_revision: number;
  updated_at: Date;
  updated_by: string;
  updated_by_name: string;
}

/**
 * Serializes every operation on one task for the rest of the transaction, then reads its audit.
 * Must run before the idempotency lookup so concurrent duplicates see each other's stored outcome.
 */
export async function lockAndReadTaskAudit(transaction: Transaction, taskId: string): Promise<CurrentAudit> {
  await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended('audit:' || $1::text, 0))", [taskId]);
  const result = await transaction.query<AuditRow>(
    `SELECT audit.id, audit.state, audit.current_revision, audit.updated_at, audit.updated_by,
            account.display_name AS updated_by_name
     FROM audits audit
     JOIN identity_accounts account ON account.id = audit.updated_by
     WHERE audit.task_id = $1`,
    [taskId],
  );
  const row = result.rows[0];
  if (!row) return { auditId: null, revision: 0, state: "draft", lastChangedAt: null, lastChangedBy: null };
  return {
    auditId: row.id,
    revision: row.current_revision,
    state: row.state,
    lastChangedAt: row.updated_at.toISOString(),
    lastChangedBy: { id: row.updated_by, displayName: row.updated_by_name },
  };
}

/** Records an accepted draft synchronization as revision `current + 1`. */
export async function applyDraftSync(transaction: Transaction, input: AcceptOperationInput): Promise<AcceptedOperation> {
  const { auditId, revision, acceptedAt } = await advanceAudit(transaction, input, "draft");
  await insertRevision(transaction, input, auditId, revision, "draft-sync", null);
  await insertConflictLineage(transaction, input, auditId, revision);
  await auditCommandTestSeams.afterRevisionInsert?.();
  return { serverRevision: revision, acceptedAt };
}

/** True when the stored outcome is already the predecessor of a lineage link; read inside the operation's transaction. */
export async function isLineagePredecessor(transaction: Transaction, operationId: string): Promise<boolean> {
  const result = await transaction.query("SELECT 1 FROM audit_lineage_links WHERE predecessor_operation_id = $1", [operationId]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Records the accepted submission: revision `current + 1` with the server's own calculation results,
 * and the single accepted-submission row with the submitting actor and the server date.
 */
export async function acceptSubmission(transaction: Transaction, input: AcceptOperationInput): Promise<AcceptedOperation> {
  const identity: CalculationContext = {
    catalogueId: input.payload.catalogueId,
    catalogueVersion: input.payload.catalogueVersion,
    schemaVersion: input.payload.schemaVersion,
    ruleId: input.payload.ruleId,
    ruleVersion: input.payload.ruleVersion,
  };
  const calculate = auditCommandTestSeams.calculate ?? calculateGraphieResults;
  const results = calculate(identity, input.payload.values);
  // The stored results must have been computed under the identity the revision is stored with.
  for (const result of Object.values(results) as unknown as Array<Record<string, unknown>>) {
    if (result.catalogueId !== identity.catalogueId || result.catalogueVersion !== identity.catalogueVersion
      || result.schemaVersion !== identity.schemaVersion || result.ruleId !== identity.ruleId
      || result.ruleVersion !== identity.ruleVersion) throw new AuditIdentityMismatchError();
  }
  const { auditId, revision, acceptedAt } = await advanceAudit(transaction, input, "submitted");
  await insertRevision(transaction, input, auditId, revision, "submission", results);
  await insertConflictLineage(transaction, input, auditId, revision);
  await auditCommandTestSeams.afterRevisionInsert?.();
  const submission = await transaction.query<{ id: string }>(
    `INSERT INTO audit_submissions (audit_id, revision, submitted_by, accepted_at, operation_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [auditId, revision, input.actor.id, acceptedAt, input.operationId],
  );
  return { serverRevision: revision, acceptedAt, submissionId: submission.rows[0]!.id };
}

async function advanceAudit(transaction: Transaction, input: AcceptOperationInput, state: "draft" | "submitted") {
  // The transaction's now(), truncated to the millisecond so the stored date equals the response date.
  const clock = await transaction.query<{ now: Date }>("SELECT date_trunc('milliseconds', now()) AS now");
  const acceptedAt = clock.rows[0]!.now.toISOString();
  const revision = input.audit.revision + 1;
  if (input.audit.auditId === null) {
    const inserted = await transaction.query<{ id: string }>(
      `INSERT INTO audits (task_id, state, current_revision, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.taskId, state, revision, acceptedAt, input.actor.id],
    );
    return { auditId: inserted.rows[0]!.id, revision, acceptedAt };
  }
  const updated = await transaction.query(
    `UPDATE audits SET state = $2, current_revision = $3, updated_at = $4, updated_by = $5
     WHERE id = $1 AND current_revision = $6`,
    [input.audit.auditId, state, revision, acceptedAt, input.actor.id, input.audit.revision],
  );
  if (updated.rowCount !== 1) throw new Error("Audit revision changed while the task lock was held.");
  return { auditId: input.audit.auditId, revision, acceptedAt };
}

async function insertConflictLineage(transaction: Transaction, input: AcceptOperationInput, auditId: string, revision: number) {
  if (input.conflictOperationId === undefined) return;
  await transaction.query(
    `INSERT INTO audit_lineage_links (link_type, audit_id, revision, predecessor_operation_id, actor_id)
     VALUES ('sync-conflict-revision', $1, $2, $3, $4)`,
    [auditId, revision, input.conflictOperationId, input.actor.id],
  );
}

async function insertRevision(
  transaction: Transaction,
  input: AcceptOperationInput,
  auditId: string,
  revision: number,
  kind: "draft-sync" | "submission",
  results: unknown,
) {
  const { payload } = input;
  await transaction.query(
    `INSERT INTO audit_revisions (audit_id, revision, kind, operation_id, actor_id, catalogue_id, catalogue_version,
       schema_version, rule_id, rule_version, payload, results, local_draft_revision, client_saved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [auditId, revision, kind, input.operationId, input.actor.id, payload.catalogueId, payload.catalogueVersion,
      payload.schemaVersion, payload.ruleId, payload.ruleVersion, JSON.stringify(payload),
      results === null ? null : JSON.stringify(results), input.localDraftRevision, input.clientSavedAt],
  );
}
