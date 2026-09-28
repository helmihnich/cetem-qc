CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment text NOT NULL CHECK (length(btrim(establishment)) BETWEEN 1 AND 200),
  service text NOT NULL CHECK (length(service) <= 200),
  task_type text NOT NULL CHECK (task_type = 'graphie_mobile'),
  created_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'draft' CHECK (state = 'draft'),
  UNIQUE (id, created_by)
);

CREATE TABLE task_assignments (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL REFERENCES identity_teams(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, team_id, employee_id)
);

CREATE INDEX task_assignments_team_employee_idx ON task_assignments(team_id, employee_id);
