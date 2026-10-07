-- Story 8.4: preserve assignment history and create typed, immutable provenance for new recovery work.
ALTER TABLE task_assignments ADD COLUMN assignment_version bigint NOT NULL DEFAULT 1 CHECK (assignment_version >= 1);

CREATE TABLE task_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL REFERENCES identity_teams(id) ON DELETE RESTRICT,
  previous_employee_id uuid REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  new_employee_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN ('baseline-assignment', 'task-created', 'deactivated-assignee-recovery')),
  created_at timestamptz NOT NULL,
  CHECK (previous_employee_id IS NULL OR previous_employee_id <> new_employee_id)
);
CREATE INDEX task_assignment_history_task_idx ON task_assignment_history(task_id, created_at, id);

-- Existing assignments get a baseline event with the best persisted actor/time; no previous assignee is invented.
INSERT INTO task_assignment_history
  (task_id, team_id, previous_employee_id, new_employee_id, actor_id, reason, created_at)
SELECT assignment.task_id, assignment.team_id, NULL, assignment.employee_id, task.created_by,
       'baseline-assignment', assignment.assigned_at
FROM task_assignments assignment JOIN tasks task ON task.id = assignment.task_id;

CREATE TRIGGER task_assignment_history_insert_only BEFORE UPDATE OR DELETE ON task_assignment_history
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER task_assignment_history_no_truncate BEFORE TRUNCATE ON task_assignment_history
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();

-- Recovery seeds are new immutable drafts. Their revision has no employee sync operation ID.
ALTER TABLE audits ADD CONSTRAINT audits_id_task_pair_unique UNIQUE (id, task_id);
ALTER TABLE audit_revisions DROP CONSTRAINT audit_revisions_kind_check;
ALTER TABLE audit_revisions ADD CONSTRAINT audit_revisions_kind_check
  CHECK (kind IN ('draft-sync', 'submission', 'deactivated-assignee-recovery'));
ALTER TABLE audit_revisions ALTER COLUMN operation_id DROP NOT NULL;
ALTER TABLE audit_revisions ADD CONSTRAINT audit_revisions_recovery_operation_check
  CHECK ((kind = 'deactivated-assignee-recovery') = (operation_id IS NULL));

CREATE TABLE audit_deactivated_assignee_recovery_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type text NOT NULL CHECK (link_type = 'deactivated-assignee-recovery'),
  source_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  source_audit_id uuid NOT NULL,
  source_revision integer NOT NULL,
  successor_task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
  successor_audit_id uuid NOT NULL,
  successor_revision integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_task_id, source_audit_id, source_revision),
  FOREIGN KEY (source_audit_id, source_task_id) REFERENCES audits(id, task_id) ON DELETE RESTRICT,
  FOREIGN KEY (successor_audit_id, successor_task_id) REFERENCES audits(id, task_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_audit_id, source_revision) REFERENCES audit_revisions(audit_id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (successor_audit_id, successor_revision) REFERENCES audit_revisions(audit_id, revision) ON DELETE RESTRICT,
  CHECK (source_task_id <> successor_task_id)
);

CREATE TABLE audit_recovery_field_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_link_id uuid NOT NULL REFERENCES audit_deactivated_assignee_recovery_links(id) ON DELETE RESTRICT,
  destination_field text NOT NULL,
  source_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  source_audit_id uuid NOT NULL,
  source_revision integer NOT NULL,
  source_field text NOT NULL,
  origin text NOT NULL CHECK (origin = 'copied-from-recovery-source'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recovery_link_id, destination_field),
  FOREIGN KEY (source_audit_id, source_task_id) REFERENCES audits(id, task_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_audit_id, source_revision) REFERENCES audit_revisions(audit_id, revision) ON DELETE RESTRICT
);

CREATE TRIGGER audit_deactivated_recovery_links_history_only BEFORE UPDATE OR DELETE ON audit_deactivated_assignee_recovery_links
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER audit_deactivated_recovery_links_no_truncate BEFORE TRUNCATE ON audit_deactivated_assignee_recovery_links
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
CREATE TRIGGER audit_recovery_field_provenance_history_only BEFORE UPDATE OR DELETE ON audit_recovery_field_provenance
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER audit_recovery_field_provenance_no_truncate BEFORE TRUNCATE ON audit_recovery_field_provenance
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
