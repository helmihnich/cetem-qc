-- Story 9.3: the Responsable's retain/discard decision on each proposed insight. Insert-only history: the latest
-- row per (submission_id, proposal_id) is the current decision. Each row keeps the proposal snapshot it applies to.
-- No existing table, constraint or trigger changes.
CREATE TABLE audit_insight_decisions (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  revision_identity jsonb NOT NULL,
  proposal_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('retained', 'discarded')),
  proposal jsonb NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_insight_decisions_submission_idx ON audit_insight_decisions (submission_id, proposal_id, seq);
CREATE TRIGGER audit_insight_decisions_history_only BEFORE UPDATE OR DELETE ON audit_insight_decisions
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER audit_insight_decisions_no_truncate BEFORE TRUNCATE ON audit_insight_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
