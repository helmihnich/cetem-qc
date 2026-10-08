-- Story 10.4: the explicit human machine-conformity decision. Insert-only: a decision is never rewritten or lost.
-- The outcome has no default and is never computed. One decision per confirmed summary; a reopening makes it
-- historical through a separate insert-only invalidation row. No existing table changes.
CREATE TABLE conformity_decisions (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  confirmed_summary_id uuid NOT NULL UNIQUE REFERENCES confirmed_summaries(id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN ('machine-conforme', 'machine-non-conforme')),
  decided_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER conformity_decisions_history_only BEFORE UPDATE OR DELETE ON conformity_decisions
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER conformity_decisions_no_truncate BEFORE TRUNCATE ON conformity_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();

CREATE TABLE conformity_decision_invalidations (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id uuid NOT NULL UNIQUE REFERENCES conformity_decisions(id) ON DELETE RESTRICT,
  reopened_summary_id uuid NOT NULL REFERENCES confirmed_summaries(id) ON DELETE RESTRICT,
  invalidated_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  invalidated_at timestamptz NOT NULL
);
CREATE TRIGGER conformity_decision_invalidations_history_only BEFORE UPDATE OR DELETE ON conformity_decision_invalidations
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER conformity_decision_invalidations_no_truncate BEFORE TRUNCATE ON conformity_decision_invalidations
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
