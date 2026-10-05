-- Story 8.2: a correction of a rejected submission is recorded as typed lineage to the refused operation.
-- Only the link type list changes; the insert-only triggers, the UNIQUE predecessor and the foreign keys stay.
ALTER TABLE audit_lineage_links DROP CONSTRAINT audit_lineage_links_link_type_check;
ALTER TABLE audit_lineage_links ADD CONSTRAINT audit_lineage_links_link_type_check
  CHECK (link_type IN ('sync-conflict-revision', 'rejected-submission-correction'));
