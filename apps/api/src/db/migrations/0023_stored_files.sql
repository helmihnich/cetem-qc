-- Story 11.2: manually prepared PDF files. Insert-only: a stored file and its checks are never rewritten or lost.
-- The binary lives in private object storage; PostgreSQL holds metadata, an opaque storage reference, the size, the
-- SHA-256 and the validation, storage and scan results only. The status is derived from the checks on every read.
-- Nothing here creates a report candidate or designates a file official (Stories 11.3, 11.4). No existing table changes.
CREATE TABLE stored_files (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  attempt_id uuid NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('manual-pdf')),
  display_name text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  storage_ref text,
  uploaded_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stored_files_task_idx ON stored_files (task_id, seq DESC);
CREATE TRIGGER stored_files_history_only BEFORE UPDATE OR DELETE ON stored_files
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER stored_files_no_truncate BEFORE TRUNCATE ON stored_files
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();

CREATE TABLE stored_file_checks (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES stored_files(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('validation', 'storage', 'scan')),
  result text NOT NULL CHECK (result IN ('passed', 'rejected', 'quarantined', 'failed', 'clean', 'threat', 'unavailable', 'not-performed')),
  failure_class text,
  scanner text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (stage = 'validation' AND result IN ('passed', 'rejected', 'quarantined'))
    OR (stage = 'storage' AND result IN ('passed', 'failed'))
    OR (stage = 'scan' AND result IN ('clean', 'threat', 'unavailable', 'not-performed') AND scanner IS NOT NULL)
  )
);
CREATE INDEX stored_file_checks_file_idx ON stored_file_checks (file_id, seq);
CREATE TRIGGER stored_file_checks_history_only BEFORE UPDATE OR DELETE ON stored_file_checks
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER stored_file_checks_no_truncate BEFORE TRUNCATE ON stored_file_checks
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
