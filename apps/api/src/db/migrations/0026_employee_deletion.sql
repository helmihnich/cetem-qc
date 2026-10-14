-- A deleted Technicien keeps its row (history references it) but leaves the team list and frees its email:
-- the address is replaced by a unique placeholder so the Responsable can create a new account with it.
ALTER TABLE identity_accounts ADD COLUMN deleted_at timestamptz;
ALTER TABLE identity_accounts ADD CONSTRAINT identity_accounts_deleted_inactive_check
  CHECK (deleted_at IS NULL OR (role = 'employe' AND is_active = false));
