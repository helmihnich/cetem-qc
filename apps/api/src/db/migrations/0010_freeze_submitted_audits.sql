-- Once an audit is submitted, its current-state pointer is frozen together with its history.
-- A draft audit stays updatable so draft synchronizations and the submission itself still apply.
-- Audits are never deleted. Messages carry no payload values.
CREATE FUNCTION refuse_submitted_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audits are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state = 'submitted' THEN
    RAISE EXCEPTION 'Submitted audits are frozen' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audits_freeze_submitted BEFORE UPDATE OR DELETE ON audits
  FOR EACH ROW EXECUTE FUNCTION refuse_submitted_audit_change();

-- Row triggers do not cover TRUNCATE; refuse it on every evidence table.
CREATE FUNCTION refuse_evidence_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evidence table % cannot be truncated', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audits_no_truncate BEFORE TRUNCATE ON audits
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
CREATE TRIGGER audit_revisions_no_truncate BEFORE TRUNCATE ON audit_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
CREATE TRIGGER audit_submissions_no_truncate BEFORE TRUNCATE ON audit_submissions
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
CREATE TRIGGER sync_operation_outcomes_no_truncate BEFORE TRUNCATE ON sync_operation_outcomes
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
