-- Typed, insert-only lineage between an accepted audit revision and the stored operation outcome it
-- resolves. Story 8.1 records only `sync-conflict-revision` (keep-local after a synchronization conflict);
-- later stories extend the link type in their own migrations.
CREATE TABLE audit_lineage_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type text NOT NULL CHECK (link_type IN ('sync-conflict-revision')),
  audit_id uuid NOT NULL,
  revision integer NOT NULL,
  -- A stored outcome is the predecessor of at most one link.
  predecessor_operation_id uuid NOT NULL UNIQUE REFERENCES sync_operation_outcomes(operation_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (audit_id, revision) REFERENCES audit_revisions(audit_id, revision) ON DELETE RESTRICT
);

CREATE TRIGGER audit_lineage_links_history_only BEFORE UPDATE OR DELETE ON audit_lineage_links
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER audit_lineage_links_no_truncate BEFORE TRUNCATE ON audit_lineage_links
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
