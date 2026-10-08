-- Story 10.3: reopening of a confirmed summary before official designation. Insert-only: the reopened confirmed row is
-- never modified; the reopening is a separate record, so old text, confirmer and date stay as history.
-- The version is the confirmation count per submission. Existing rows get version 1 (ADD COLUMN applies the default
-- without firing the UPDATE trigger). One reopening per confirmed summary.
ALTER TABLE confirmed_summaries ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version >= 1);
DROP INDEX confirmed_summaries_submission_idx;
CREATE UNIQUE INDEX confirmed_summaries_submission_version_idx ON confirmed_summaries (submission_id, version);

CREATE TABLE summary_reopenings (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  confirmed_summary_id uuid NOT NULL UNIQUE REFERENCES confirmed_summaries(id) ON DELETE RESTRICT,
  reopened_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  reopened_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER summary_reopenings_history_only BEFORE UPDATE OR DELETE ON summary_reopenings
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER summary_reopenings_no_truncate BEFORE TRUNCATE ON summary_reopenings
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
