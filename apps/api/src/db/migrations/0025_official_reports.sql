-- Story 11.4: the single official report of a control. Insert-only: a designation is never changed, replaced or removed.
-- Linkage (audit, revision, summary, decision, origin, file) is read from the candidate by join and never copied, so it
-- cannot diverge. UNIQUE (task_id) is the database backstop for « exactly one official report ». No existing table changes.
CREATE TABLE official_reports (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL UNIQUE REFERENCES report_candidates(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  designated_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  designated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER official_reports_history_only BEFORE UPDATE OR DELETE ON official_reports
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER official_reports_no_truncate BEFORE TRUNCATE ON official_reports
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
