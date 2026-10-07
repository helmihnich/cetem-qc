-- Story 9.4: manual insights the Responsable adds to an accepted audit. Insert-only: never rewritten or lost.
-- Each row keeps who wrote it, when, and which audit version (submission, revision and identity) it concerns.
-- No existing table, constraint or trigger changes.
CREATE TABLE audit_manual_insights (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  author_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  revision_identity jsonb NOT NULL,
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type = 'manual'),
  insight_text text NOT NULL CHECK (char_length(insight_text) BETWEEN 1 AND 1000),
  justification text CHECK (justification IS NULL OR char_length(justification) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_manual_insights_submission_idx ON audit_manual_insights (submission_id, seq);
CREATE TRIGGER audit_manual_insights_history_only BEFORE UPDATE OR DELETE ON audit_manual_insights
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER audit_manual_insights_no_truncate BEFORE TRUNCATE ON audit_manual_insights
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
