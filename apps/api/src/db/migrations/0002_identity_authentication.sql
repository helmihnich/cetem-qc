ALTER TABLE identity_accounts
  DROP CONSTRAINT identity_accounts_role_check,
  ADD CONSTRAINT identity_accounts_role_check CHECK (role IN ('responsable', 'employe')),
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;
