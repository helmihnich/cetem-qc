CREATE TABLE identity_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  responsable_account_id uuid NOT NULL UNIQUE REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE identity_accounts
  ADD COLUMN team_id uuid REFERENCES identity_teams(id) ON DELETE RESTRICT,
  ADD COLUMN first_name text,
  ADD COLUMN surname text;

ALTER TABLE identity_accounts
  ADD CONSTRAINT identity_employee_profile_check CHECK (
    role = 'responsable' OR (first_name IS NOT NULL AND surname IS NOT NULL)
  );

INSERT INTO identity_teams (responsable_account_id)
SELECT id FROM identity_accounts
WHERE role = 'responsable'
ON CONFLICT (responsable_account_id) DO NOTHING;

CREATE INDEX identity_accounts_team_membership_idx ON identity_accounts(team_id, role, surname, first_name);
