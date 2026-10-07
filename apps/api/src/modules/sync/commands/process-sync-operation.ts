import { createHash } from "node:crypto";
import { validateGraphiePayload } from "@cetem-qc/domain";
import { syncOperationAcceptedSchema, syncOperationConflictSchema, syncOperationRejectedSchema } from "@cetem-qc/schemas/api/v1";
import type { SyncOperationAccepted, SyncOperationConflict, SyncOperationRejected, SyncOperationRequest } from "@cetem-qc/schemas/api/v1";
import type { Pool, QueryResultRow } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import type { Transaction } from "../../../db/transaction.js";
import { acceptSubmission, applyDraftSync, isLineagePredecessor, lockAndReadTaskAudit, readLineageLinkOfPredecessor } from "../../audits/commands/audit-revisions.js";
import type { AuditActor } from "../../audits/commands/audit-revisions.js";

export type SyncOperationKind = "sync-draft" | "submit";

export type SyncOperationOutcome =
  | { type: "authorization-failed" }
  | { type: "task-not-assigned" }
  | { type: "stored"; httpStatus: 200; body: SyncOperationAccepted }
  | { type: "stored"; httpStatus: 409; body: SyncOperationConflict }
  | { type: "stored"; httpStatus: 422; body: SyncOperationRejected }
  /** The idempotency key or operation ID was already used for another request; nothing is disclosed or stored. */
  | { type: "key-reused" };

type StoredBody = SyncOperationAccepted | SyncOperationConflict | SyncOperationRejected;

const REJECTION_MESSAGES: Record<SyncOperationRejected["code"], string> = {
  UNSUPPORTED_PAYLOAD: "Cette version du formulaire n’est pas prise en charge par le serveur.",
  UNSUPPORTED_PAYLOAD_VERSION: "Cette version du formulaire n’est pas prise en charge par le serveur.",
  INVALID_PAYLOAD: "Les données du contrôle sont invalides.",
  AUDIT_ALREADY_SUBMITTED: "Ce contrôle a déjà été soumis et accepté.",
  INVALID_CONFLICT_REFERENCE: "La référence du conflit de synchronisation est invalide.",
  INVALID_CORRECTION_REFERENCE: "La référence de la soumission corrigée est invalide.",
};

interface StoredOutcomeRow extends QueryResultRow {
  idempotency_key: string;
  operation_id: string;
  actor_id: string;
  task_id: string;
  kind: SyncOperationKind;
  request_fingerprint: string;
  http_status: 200 | 409 | 422;
  response: StoredBody;
}

const uniqueViolation = "23505";

/**
 * Runs one draft-sync or submission operation for an assigned task in a single transaction: task lock,
 * idempotent replay, already-submitted check, base revision check, payload validation, acceptance and
 * storage of the outcome. Authorization and the envelope are checked by the caller before this runs.
 */
export async function processSyncOperation(
  pool: Pool,
  input: { kind: SyncOperationKind; taskId: string; actor: AuditActor; request: SyncOperationRequest },
): Promise<SyncOperationOutcome> {
  const fingerprint = requestFingerprint(input.kind, input.taskId, input.request);
  try {
    return await withTransaction(pool, (transaction) => runOnce(transaction, input, fingerprint));
  } catch (error) {
    // A concurrent duplicate that slipped past the task lock (same key on another task): retry once to find its outcome.
    if ((error as { code?: unknown } | null)?.code !== uniqueViolation) throw error;
    return withTransaction(pool, (transaction) => runOnce(transaction, input, fingerprint));
  }
}

async function runOnce(
  transaction: Transaction,
  input: { kind: SyncOperationKind; taskId: string; actor: AuditActor; request: SyncOperationRequest },
  fingerprint: string,
): Promise<SyncOperationOutcome> {
  const { kind, taskId, actor, request } = input;
  const authorization = await transaction.query<{ is_active: boolean }>(
    `SELECT account.is_active
     FROM tasks task
     JOIN task_assignments assignment ON assignment.task_id = task.id AND assignment.employee_id = $2
     JOIN identity_accounts account ON account.id = assignment.employee_id AND account.role = 'employe'
     WHERE task.id = $1
     FOR UPDATE OF task, assignment, account`,
    [taskId, actor.id],
  );
  if (!authorization.rows[0]) return { type: "task-not-assigned" };
  if (!authorization.rows[0].is_active) return { type: "authorization-failed" };
  const audit = await lockAndReadTaskAudit(transaction, taskId);

  const stored = await transaction.query<StoredOutcomeRow>(
    `SELECT idempotency_key, operation_id, actor_id, task_id, kind, request_fingerprint, http_status, response
     FROM sync_operation_outcomes WHERE idempotency_key = $1 OR operation_id = $2`,
    [request.idempotencyKey, request.operationId],
  );
  if (stored.rows.length) {
    const [row] = stored.rows;
    // PostgreSQL returns uuids in lower case; the envelope may carry them in upper case.
    const sameRequest = stored.rows.length === 1 && row
      && row.idempotency_key === request.idempotencyKey.toLowerCase() && row.operation_id === request.operationId.toLowerCase()
      && row.actor_id === actor.id && row.task_id === taskId && row.kind === kind
      && row.request_fingerprint === fingerprint;
    if (!sameRequest) return { type: "key-reused" };
    return { type: "stored", httpStatus: row.http_status, body: row.response } as SyncOperationOutcome;
  }

  const base = { operationId: request.operationId, kind };
  let outcome: { httpStatus: 200 | 409 | 422; body: StoredBody };
  if (audit.state === "submitted") {
    outcome = rejected(base, "AUDIT_ALREADY_SUBMITTED", []);
  } else if (request.baseRevision !== audit.revision) {
    outcome = {
      httpStatus: 409,
      body: syncOperationConflictSchema.parse({
        outcome: "conflict", ...base, serverRevision: audit.revision,
        current: { revision: audit.revision, state: audit.state, lastChangedAt: audit.lastChangedAt, lastChangedBy: audit.lastChangedBy },
      }),
    };
  } else if (request.conflictOperationId !== undefined
    && !await isValidConflictReference(transaction, request.conflictOperationId, actor.id, taskId)) {
    outcome = rejected(base, "INVALID_CONFLICT_REFERENCE", [{ path: "conflictOperationId", code: "invalid-reference" }]);
  } else {
    const correction = request.correctionOfOperationId === undefined
      ? undefined
      : await checkCorrectionReference(transaction, request.correctionOfOperationId.toLowerCase(), actor.id, taskId, audit.auditId);
    const validation = correction === "invalid" ? null : validateGraphiePayload(request.payload, kind);
    if (correction === "invalid" || validation === null) {
      outcome = rejected(base, "INVALID_CORRECTION_REFERENCE", [{ path: "correctionOfOperationId", code: "invalid-reference" }]);
    } else if (!validation.ok) {
      outcome = rejected(base, validation.code, validation.issues);
    } else {
      const acceptInput = {
        audit, taskId, actor, operationId: request.operationId, payload: validation.payload,
        localDraftRevision: request.localDraftRevision, clientSavedAt: request.clientSavedAt,
        ...(request.conflictOperationId !== undefined ? { conflictOperationId: request.conflictOperationId.toLowerCase() } : {}),
        ...(correction !== undefined ? { correction } : {}),
      };
      const accepted = kind === "submit" ? await acceptSubmission(transaction, acceptInput) : await applyDraftSync(transaction, acceptInput);
      outcome = {
        httpStatus: 200,
        body: syncOperationAcceptedSchema.parse({
          outcome: "accepted", ...base, serverRevision: accepted.serverRevision, acceptedAt: accepted.acceptedAt,
          acceptedBy: { id: actor.id, displayName: actor.displayName },
          ...(accepted.submissionId !== undefined ? { submissionId: accepted.submissionId } : {}),
        }),
      };
    }
  }

  // The body sent now is the stored jsonb read back, so a replay returns exactly the same bytes.
  const inserted = await transaction.query<{ response: StoredBody }>(
    `INSERT INTO sync_operation_outcomes (idempotency_key, operation_id, actor_id, task_id, kind, request_fingerprint,
       outcome, http_status, response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING response`,
    [request.idempotencyKey, request.operationId, actor.id, taskId, kind, fingerprint,
      outcome.body.outcome, outcome.httpStatus, JSON.stringify(outcome.body)],
  );
  return { type: "stored", httpStatus: outcome.httpStatus, body: inserted.rows[0]!.response } as SyncOperationOutcome;
}

/** The reference must be a stored conflict outcome of the same actor and task that no lineage link uses yet. */
async function isValidConflictReference(transaction: Transaction, operationId: string, actorId: string, taskId: string): Promise<boolean> {
  const referenced = await transaction.query<{ actor_id: string; task_id: string; outcome: string }>(
    "SELECT actor_id, task_id, outcome FROM sync_operation_outcomes WHERE operation_id = $1",
    [operationId],
  );
  const row = referenced.rows[0];
  if (!row || row.outcome !== "conflict" || row.actor_id !== actorId || row.task_id !== taskId) return false;
  return !await isLineagePredecessor(transaction, operationId);
}

/**
 * The reference must be a stored rejected submission of the same actor and task whose code is not
 * AUDIT_ALREADY_SUBMITTED, and either unlinked or already linked as a correction of this task's audit
 * (items queued before the first acceptance still carry it).
 */
async function checkCorrectionReference(
  transaction: Transaction,
  operationId: string,
  actorId: string,
  taskId: string,
  auditId: string | null,
): Promise<{ predecessorOperationId: string; alreadyLinked: boolean } | "invalid"> {
  const referenced = await transaction.query<{ actor_id: string; task_id: string; outcome: string; kind: string; code: string | null }>(
    "SELECT actor_id, task_id, outcome, kind, response->>'code' AS code FROM sync_operation_outcomes WHERE operation_id = $1",
    [operationId],
  );
  const row = referenced.rows[0];
  if (!row || row.outcome !== "rejected" || row.kind !== "submit" || row.actor_id !== actorId || row.task_id !== taskId
    || row.code === "AUDIT_ALREADY_SUBMITTED") return "invalid";
  const link = await readLineageLinkOfPredecessor(transaction, operationId);
  if (link === null) return { predecessorOperationId: operationId, alreadyLinked: false };
  if (link.linkType === "rejected-submission-correction" && link.auditId === auditId) return { predecessorOperationId: operationId, alreadyLinked: true };
  return "invalid";
}

function rejected(
  base: { operationId: string; kind: SyncOperationKind },
  code: SyncOperationRejected["code"],
  issues: SyncOperationRejected["issues"],
): { httpStatus: 422; body: SyncOperationRejected } {
  return {
    httpStatus: 422,
    body: syncOperationRejectedSchema.parse({ outcome: "rejected", ...base, code, message: REJECTION_MESSAGES[code], issues }),
  };
}

/**
 * SHA-256 of the canonical JSON (keys sorted recursively) of everything that defines the request.
 * The conflict and correction references enter only when present, so fingerprints of earlier requests stay valid.
 */
export function requestFingerprint(kind: SyncOperationKind, taskId: string, request: SyncOperationRequest): string {
  const { operationId, baseRevision, localDraftRevision, clientSavedAt, payload, conflictOperationId, correctionOfOperationId } = request;
  return createHash("sha256")
    .update(canonicalJson({
      kind, taskId, operationId, baseRevision, localDraftRevision, clientSavedAt, payload,
      ...(conflictOperationId !== undefined ? { conflictOperationId } : {}),
      ...(correctionOfOperationId !== undefined ? { correctionOfOperationId } : {}),
    }))
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
