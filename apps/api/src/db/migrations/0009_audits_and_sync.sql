-- One audit per task, created on its first accepted synchronization operation. `audits` is the
-- current-state pointer; revisions, accepted submissions and stored operation outcomes are history.
CREATE TABLE audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('draft', 'submitted')),
  current_revision integer NOT NULL CHECK (current_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT
);

CREATE TABLE audit_revisions (
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision >= 1),
  kind text NOT NULL CHECK (kind IN ('draft-sync', 'submission')),
  operation_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  catalogue_id text NOT NULL,
  catalogue_version text NOT NULL,
  schema_version integer NOT NULL,
  rule_id text NOT NULL,
  rule_version text NOT NULL,
  -- The validated payload, raw strings unchanged.
  payload jsonb NOT NULL,
  -- The server's calculateGraphieResults output; submissions only.
  results jsonb,
  local_draft_revision integer NOT NULL CHECK (local_draft_revision >= 1),
  client_saved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_id, revision),
  CHECK ((kind = 'submission') = (results IS NOT NULL))
);

CREATE TABLE audit_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Exactly one accepted submission per audit.
  audit_id uuid NOT NULL UNIQUE REFERENCES audits(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  submitted_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL,
  operation_id uuid NOT NULL UNIQUE,
  FOREIGN KEY (audit_id, revision) REFERENCES audit_revisions(audit_id, revision) ON DELETE RESTRICT
);

CREATE TABLE sync_operation_outcomes (
  idempotency_key uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('sync-draft', 'submit')),
  request_fingerprint text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'conflict')),
  http_status integer NOT NULL CHECK (http_status IN (200, 409, 422)),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION refuse_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'History rows in % are insert-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_revisions_insert_only BEFORE UPDATE OR DELETE ON audit_revisions
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER audit_submissions_insert_only BEFORE UPDATE OR DELETE ON audit_submissions
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER sync_operation_outcomes_insert_only BEFORE UPDATE OR DELETE ON sync_operation_outcomes
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
