-- Story 10.2: the summary the Responsable explicitly confirmed. Insert-only: never rewritten or lost.
-- Each row keeps who confirmed, when, which audit version (submission, revision and identity), the final text, the
-- optional link to the initial AI draft, and the actual input set rebuilt at confirmation with its identity (SHA-256).
-- PostgreSQL text cannot hold NUL, so the request schema refuses it before insert (no CHECK can test for it).
-- One confirmed summary per submission until Story 10.3 introduces reopening. No existing table changes.
CREATE TABLE confirmed_summaries (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  confirmed_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  revision_identity jsonb NOT NULL,
  initial_draft_id uuid REFERENCES summary_ai_drafts(id) ON DELETE RESTRICT,
  final_text text NOT NULL CHECK (char_length(final_text) BETWEEN 1 AND 5000),
  summary_input_set_id text NOT NULL CHECK (summary_input_set_id ~ '^[0-9a-f]{64}$'),
  input_set jsonb NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX confirmed_summaries_submission_idx ON confirmed_summaries (submission_id);
CREATE TRIGGER confirmed_summaries_history_only BEFORE UPDATE OR DELETE ON confirmed_summaries
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER confirmed_summaries_no_truncate BEFORE TRUNCATE ON confirmed_summaries
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
