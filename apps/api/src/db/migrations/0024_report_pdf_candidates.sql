-- Story 11.3: a ready manual PDF can be a report candidate. Additive: Word rows stay valid. The binary stays behind the
-- files module; reports keeps only the opaque stored_file_id and copies of the display name, size and SHA-256.
ALTER TABLE report_candidates DROP CONSTRAINT report_candidates_origin_check;
ALTER TABLE report_candidates ADD CONSTRAINT report_candidates_origin_check CHECK (origin IN ('generated-word', 'uploaded-pdf'));
ALTER TABLE report_candidates ALTER COLUMN template_id DROP NOT NULL;
ALTER TABLE report_candidates ALTER COLUMN template_version DROP NOT NULL;
ALTER TABLE report_candidates ADD COLUMN stored_file_id uuid REFERENCES stored_files(id) ON DELETE RESTRICT;
ALTER TABLE report_candidates ADD CONSTRAINT report_candidates_origin_shape CHECK (
  (origin = 'generated-word' AND stored_file_id IS NULL AND template_id IS NOT NULL AND template_version IS NOT NULL)
  OR (origin = 'uploaded-pdf' AND stored_file_id IS NOT NULL AND template_id IS NULL AND template_version IS NULL));
CREATE UNIQUE INDEX report_candidates_file_bindings_uidx
  ON report_candidates (stored_file_id, confirmed_summary_id, conformity_decision_id) WHERE stored_file_id IS NOT NULL;

ALTER TABLE report_candidate_outcomes DROP CONSTRAINT report_candidate_outcomes_check;
ALTER TABLE report_candidate_outcomes ADD CONSTRAINT report_candidate_outcomes_check CHECK (
  (outcome IN ('ready', 'outdated') AND file_name IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL AND failure_class IS NULL)
  OR (outcome = 'failed' AND failure_class IS NOT NULL AND storage_ref IS NULL AND file_name IS NULL AND byte_size IS NULL AND sha256 IS NULL));
