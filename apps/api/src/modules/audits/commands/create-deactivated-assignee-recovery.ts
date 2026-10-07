import type { ValidatedGraphiePayload } from "@cetem-qc/domain";
import type { QueryResultRow } from "pg";
import type { Pool } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import { insertAssignedTask, TaskAssigneeUnavailableError } from "../../tasks/commands/insert-assigned-task.js";

export type CreateDeactivatedAssigneeRecoveryOutcome =
  | { type: "created"; task: { id: string; establishment: string; service: string; type: "graphie_mobile"; assigneeId: string; creatorId: string; createdAt: string; state: "draft" }; source: { taskId: string; auditId: string; revision: number }; recoveryId: string; recoveryKind: "synchronized-draft" | "correction-draft" }
  | { type: "not-found" | "not-recoverable" | "stale" | "already-recovered" | "assignee-unavailable" | "responsable-inactive" };

/** Test-only failure seam proving every seed/link/provenance write rolls back together. */
export const deactivatedRecoveryTestSeams: { afterSeedInsert?: () => Promise<void> | void } = {};

export async function createDeactivatedAssigneeRecovery(
  pool: Pool,
  input: { responsableId: string; sourceTaskId: string; sourceRevision: number; expectedAssignmentVersion: number; successorId: string },
): Promise<CreateDeactivatedAssigneeRecoveryOutcome> {
  try {
    return await withTransaction(pool, async (transaction): Promise<CreateDeactivatedAssigneeRecoveryOutcome> => {
      const actor = await transaction.query<{ id: string }>(
        `SELECT id FROM identity_accounts WHERE id = $1 AND role = 'responsable' AND is_active = true FOR SHARE`,
        [input.responsableId],
      );
      if (!actor.rows[0]) return { type: "responsable-inactive" };

      const sourceTask = await transaction.query<{ task_id: string; team_id: string; employee_id: string; assignee_active: boolean; assignment_version: string; establishment: string; service: string } & QueryResultRow>(
        `SELECT task.id AS task_id, assignment.team_id, assignment.employee_id, employee.is_active AS assignee_active,
                assignment.assignment_version::text, task.establishment, task.service
         FROM tasks task
         JOIN task_assignments assignment ON assignment.task_id = task.id
         JOIN identity_teams team ON team.id = assignment.team_id AND team.responsable_account_id = $1
         JOIN identity_accounts employee ON employee.id = assignment.employee_id
           AND employee.team_id = assignment.team_id AND employee.role = 'employe'
         WHERE task.id = $2
         FOR UPDATE OF task, assignment, employee`,
        [input.responsableId, input.sourceTaskId],
      );
      const source = sourceTask.rows[0];
      if (!source) return { type: "not-found" };
      if (Number(source.assignment_version) !== input.expectedAssignmentVersion || source.assignee_active) return { type: "stale" };

      const auditResult = await transaction.query<{ id: string; current_revision: number; state: "draft" | "submitted"; payload: ValidatedGraphiePayload; kind: string } & QueryResultRow>(
        `SELECT audit.id, audit.current_revision, audit.state, revision.payload, revision.kind
         FROM audits audit
         JOIN audit_revisions revision ON revision.audit_id = audit.id AND revision.revision = audit.current_revision
         WHERE audit.task_id = $1
         FOR UPDATE OF audit`,
        [input.sourceTaskId],
      );
      const audit = auditResult.rows[0];
      if (!audit || audit.state !== "draft" || audit.current_revision !== input.sourceRevision || audit.kind !== "draft-sync") return { type: "not-recoverable" };

      const states = await transaction.query<{ open_conflict: boolean; open_rejection: boolean; is_correction_revision: boolean } & QueryResultRow>(
        `SELECT
          EXISTS (
            SELECT 1 FROM sync_operation_outcomes outcome
            WHERE outcome.task_id = $1 AND outcome.outcome = 'conflict'
              AND NOT EXISTS (SELECT 1 FROM audit_lineage_links link WHERE link.predecessor_operation_id = outcome.operation_id)
          ) AS open_conflict,
          EXISTS (
            SELECT 1 FROM sync_operation_outcomes outcome
            WHERE outcome.task_id = $1 AND outcome.kind = 'submit' AND outcome.outcome = 'rejected'
              AND outcome.response->>'code' <> 'AUDIT_ALREADY_SUBMITTED'
              AND NOT EXISTS (SELECT 1 FROM audit_lineage_links link WHERE link.predecessor_operation_id = outcome.operation_id)
          ) AS open_rejection,
          EXISTS (
            SELECT 1 FROM audit_lineage_links link
            WHERE link.audit_id = $2 AND link.revision = $3 AND link.link_type = 'rejected-submission-correction'
          ) AS is_correction_revision`,
        [input.sourceTaskId, audit.id, audit.current_revision],
      );
      const state = states.rows[0]!;
      if (state.open_conflict || state.open_rejection) return { type: "not-recoverable" };
      const already = await transaction.query("SELECT 1 FROM audit_deactivated_assignee_recovery_links WHERE source_task_id = $1 AND source_audit_id = $2 AND source_revision = $3", [input.sourceTaskId, audit.id, audit.current_revision]);
      if (already.rows.length) return { type: "already-recovered" };

      const successor = await insertAssignedTask(transaction, input.responsableId, {
        establishment: source.establishment, service: source.service, type: "graphie_mobile", assigneeId: input.successorId,
      }, { assignmentReason: "deactivated-assignee-recovery" });
      const timestamp = await transaction.query<{ created_at: Date }>("SELECT date_trunc('milliseconds', now()) AS created_at");
      const createdAt = timestamp.rows[0]!.created_at;
      const auditInsert = await transaction.query<{ id: string }>(
        `INSERT INTO audits (task_id, state, current_revision, updated_at, updated_by)
         VALUES ($1, 'draft', 1, $2, $3) RETURNING id`,
        [successor.id, createdAt, input.responsableId],
      );
      const successorAuditId = auditInsert.rows[0]!.id;
      await transaction.query(
        `INSERT INTO audit_revisions (audit_id, revision, kind, operation_id, actor_id, catalogue_id, catalogue_version,
           schema_version, rule_id, rule_version, payload, results, local_draft_revision, client_saved_at)
         VALUES ($1, 1, 'deactivated-assignee-recovery', NULL, $2, $3, $4, $5, $6, $7, $8, NULL, 1, $9)`,
        [successorAuditId, input.responsableId, audit.payload.catalogueId, audit.payload.catalogueVersion,
          audit.payload.schemaVersion, audit.payload.ruleId, audit.payload.ruleVersion, JSON.stringify(audit.payload), createdAt],
      );
      const link = await transaction.query<{ id: string }>(
        `INSERT INTO audit_deactivated_assignee_recovery_links
          (link_type, source_task_id, source_audit_id, source_revision, successor_task_id, successor_audit_id, successor_revision, actor_id, created_at)
         VALUES ('deactivated-assignee-recovery', $1, $2, $3, $4, $5, 1, $6, $7) RETURNING id`,
        [input.sourceTaskId, audit.id, audit.current_revision, successor.id, successorAuditId, input.responsableId, createdAt],
      );
      const recoveryId = link.rows[0]!.id;
      for (const field of Object.keys(audit.payload.values)) {
        await transaction.query(
          `INSERT INTO audit_recovery_field_provenance
            (recovery_link_id, destination_field, source_task_id, source_audit_id, source_revision, source_field, origin, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'copied-from-recovery-source', $7)`,
          [recoveryId, `values.${field}`, input.sourceTaskId, audit.id, audit.current_revision, `values.${field}`, createdAt],
        );
      }
      if (audit.payload.legacyContent !== undefined) {
        await transaction.query(
          `INSERT INTO audit_recovery_field_provenance
            (recovery_link_id, destination_field, source_task_id, source_audit_id, source_revision, source_field, origin, created_at)
           VALUES ($1, 'legacyContent', $2, $3, $4, 'legacyContent', 'copied-from-recovery-source', $5)`,
          [recoveryId, input.sourceTaskId, audit.id, audit.current_revision, createdAt],
        );
      }
      await deactivatedRecoveryTestSeams.afterSeedInsert?.();
      return {
        type: "created", task: successor,
        source: { taskId: input.sourceTaskId, auditId: audit.id, revision: audit.current_revision }, recoveryId,
        recoveryKind: state.is_correction_revision ? "correction-draft" : "synchronized-draft",
      };
    });
  } catch (error) {
    if (error instanceof TaskAssigneeUnavailableError) return { type: "assignee-unavailable" };
    const pgError = error as { code?: unknown; table?: unknown } | null;
    if (pgError?.code === "23505" && pgError.table === "audit_deactivated_assignee_recovery_links") return { type: "already-recovered" };
    throw error;
  }
}
