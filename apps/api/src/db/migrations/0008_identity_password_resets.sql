CREATE TABLE identity_password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  reset_by_account_id uuid REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('responsable', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((channel = 'responsable') = (reset_by_account_id IS NOT NULL))
);
CREATE INDEX identity_password_resets_account_idx ON identity_password_resets(account_id, created_at);
