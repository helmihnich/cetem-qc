-- Story 8.3: a Responsable-only replacement control of a server-accepted audit is recorded as typed,
-- insert-only lineage between the original task (its accepted audit and submission) and the new task.
-- The replacement's own audit is created by its first accepted synchronization and resolves through
-- `audits.task_id = replacement_task_id`. No existing table, constraint or trigger changes.
CREATE TABLE audit_replacement_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type text NOT NULL CHECK (link_type = 'replacement-control'),
  -- One replacement per original (technical cardinality; a later migration may lift it).
  original_task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
  original_audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  original_submission_id uuid NOT NULL UNIQUE REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  replacement_task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (original_task_id <> replacement_task_id)
);

CREATE TRIGGER audit_replacement_links_history_only BEFORE UPDATE OR DELETE ON audit_replacement_links
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER audit_replacement_links_no_truncate BEFORE TRUNCATE ON audit_replacement_links
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
