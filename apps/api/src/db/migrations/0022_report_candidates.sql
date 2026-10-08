-- Story 11.1: Word report candidates. Insert-only: a candidate and its outcome are never rewritten or lost.
-- The binary lives in private object storage; PostgreSQL holds metadata, an opaque storage reference, the size and the
-- SHA-256 only. A candidate is bound immutably to the audit revision, the confirmed summary and the conformity decision.
-- Nothing here designates or marks a report official (Story 11.4). No existing table changes.
CREATE TABLE report_candidates (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  attempt_id uuid NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  audit_revision integer NOT NULL,
  confirmed_summary_id uuid NOT NULL REFERENCES confirmed_summaries(id) ON DELETE RESTRICT,
  summary_version integer NOT NULL,
  conformity_decision_id uuid NOT NULL REFERENCES conformity_decisions(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK (origin IN ('generated-word')),
  template_id text NOT NULL,
  template_version text NOT NULL,
  requested_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_candidates_task_idx ON report_candidates (task_id, seq DESC);
CREATE TRIGGER report_candidates_history_only BEFORE UPDATE OR DELETE ON report_candidates
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER report_candidates_no_truncate BEFORE TRUNCATE ON report_candidates
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();

CREATE TABLE report_candidate_outcomes (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id uuid NOT NULL UNIQUE REFERENCES report_candidates(id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN ('ready', 'failed', 'outdated')),
  storage_ref text,
  file_name text,
  byte_size integer,
  sha256 text,
  failure_class text CHECK (failure_class IN ('generation-failed', 'storage-failed')),
  completed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (outcome IN ('ready', 'outdated') AND storage_ref IS NOT NULL AND file_name IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL AND failure_class IS NULL)
    OR (outcome = 'failed' AND failure_class IS NOT NULL AND storage_ref IS NULL AND file_name IS NULL AND byte_size IS NULL AND sha256 IS NULL)
  )
);
CREATE TRIGGER report_candidate_outcomes_history_only BEFORE UPDATE OR DELETE ON report_candidate_outcomes
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER report_candidate_outcomes_no_truncate BEFORE TRUNCATE ON report_candidate_outcomes
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
