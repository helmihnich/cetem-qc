-- Story 10.1: every AI summary draft request, successful or failed. Insert-only: never rewritten or lost.
-- Each row keeps who asked, when, which audit version (submission, revision and identity), the exact input set sent
-- to the provider with its identity (SHA-256), the provider and model, and the draft text on success.
-- No existing table, constraint or trigger changes.
CREATE TABLE summary_ai_drafts (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  requested_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  revision_identity jsonb NOT NULL,
  summary_input_set_id text NOT NULL CHECK (summary_input_set_id ~ '^[0-9a-f]{64}$'),
  input_set jsonb NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('generated', 'failed')),
  failure_class text CHECK (failure_class IN ('not-configured', 'timeout', 'provider-error', 'empty-output')),
  draft_text text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'generated' AND draft_text IS NOT NULL AND char_length(draft_text) > 0 AND failure_class IS NULL)
      OR (status = 'failed' AND draft_text IS NULL AND failure_class IS NOT NULL))
);
CREATE INDEX summary_ai_drafts_submission_idx ON summary_ai_drafts (submission_id, seq);
CREATE TRIGGER summary_ai_drafts_history_only BEFORE UPDATE OR DELETE ON summary_ai_drafts
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER summary_ai_drafts_no_truncate BEFORE TRUNCATE ON summary_ai_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
