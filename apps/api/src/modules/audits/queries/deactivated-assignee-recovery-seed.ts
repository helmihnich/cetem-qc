import type { GraphieDraftPayload } from "@cetem-qc/schemas/api/v1";
import type { Pool, QueryResultRow } from "pg";

export type DeactivatedAssigneeRecoverySeed = {
  recoveryId: string;
  source: { taskId: string; auditId: string; revision: number; employee: { id: string; displayName: string } };
  seed: { revision: number; payload: GraphieDraftPayload };
  provenance: Array<{
    destinationField: string; sourceField: string; sourceTaskId: string; sourceAuditId: string;
    sourceRevision: number; origin: "copied-from-recovery-source";
  }>;
};

/** The assigned successor alone may read the immutable recovery seed and its source attribution. */
export async function getDeactivatedAssigneeRecoverySeed(pool: Pool, employeeId: string, taskId: string): Promise<DeactivatedAssigneeRecoverySeed | null> {
  const seed = await pool.query<{
    recovery_id: string; source_task_id: string; source_audit_id: string; source_revision: number;
    source_employee_id: string; source_employee_name: string; seed_revision: number; payload: GraphieDraftPayload;
  } & QueryResultRow>(
    `SELECT recovery.id AS recovery_id, recovery.source_task_id, recovery.source_audit_id, recovery.source_revision,
            source_assignment.employee_id AS source_employee_id, source_employee.display_name AS source_employee_name,
            seed_revision.revision AS seed_revision, seed_revision.payload
     FROM task_assignments assignment
     JOIN audit_deactivated_assignee_recovery_links recovery ON recovery.successor_task_id = assignment.task_id
     JOIN audit_revisions seed_revision ON seed_revision.audit_id = recovery.successor_audit_id
       AND seed_revision.revision = recovery.successor_revision AND seed_revision.kind = 'deactivated-assignee-recovery'
     JOIN task_assignments source_assignment ON source_assignment.task_id = recovery.source_task_id
     JOIN identity_accounts source_employee ON source_employee.id = source_assignment.employee_id
     WHERE assignment.task_id = $1 AND assignment.employee_id = $2`,
    [taskId, employeeId],
  );
  const row = seed.rows[0];
  if (!row) return null;
  const provenance = await pool.query<{
    destination_field: string; source_field: string; source_task_id: string; source_audit_id: string;
    source_revision: number; origin: "copied-from-recovery-source";
  } & QueryResultRow>(
    `SELECT destination_field, source_field, source_task_id, source_audit_id, source_revision, origin
     FROM audit_recovery_field_provenance WHERE recovery_link_id = $1 ORDER BY destination_field`,
    [row.recovery_id],
  );
  return {
    recoveryId: row.recovery_id,
    source: { taskId: row.source_task_id, auditId: row.source_audit_id, revision: row.source_revision, employee: { id: row.source_employee_id, displayName: row.source_employee_name } },
    seed: { revision: row.seed_revision, payload: row.payload },
    provenance: provenance.rows.map((field) => ({ destinationField: field.destination_field, sourceField: field.source_field,
      sourceTaskId: field.source_task_id, sourceAuditId: field.source_audit_id, sourceRevision: field.source_revision, origin: field.origin })),
  };
}
