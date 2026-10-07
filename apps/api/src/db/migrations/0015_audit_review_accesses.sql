-- Story 9.1: every successful open of an accepted submission by its team's Responsable is recorded as one
-- insert-only access row (who, when, which task, audit and submission). It carries no evidence content.
-- No existing table, constraint or trigger changes.
CREATE TABLE audit_review_accesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_review_accesses_submission_idx ON audit_review_accesses (submission_id, accessed_at);
CREATE TRIGGER audit_review_accesses_history_only BEFORE UPDATE OR DELETE ON audit_review_accesses
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER audit_review_accesses_no_truncate BEFORE TRUNCATE ON audit_review_accesses
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
