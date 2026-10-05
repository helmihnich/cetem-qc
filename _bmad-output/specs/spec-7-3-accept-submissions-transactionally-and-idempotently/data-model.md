# Data model (CAP-2, CAP-3, CAP-4, CAP-6)

New migration `apps/api/src/db/migrations/0009_audits_and_sync.sql`, applied by the existing runner. Column names may be adjusted, but the constraints must stay.

```sql
CREATE TABLE audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('draft','submitted')),
  current_revision integer NOT NULL CHECK (current_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT
);

CREATE TABLE audit_revisions (
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision >= 1),
  kind text NOT NULL CHECK (kind IN ('draft-sync','submission')),
  operation_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  catalogue_id text NOT NULL, catalogue_version text NOT NULL, schema_version integer NOT NULL,
  rule_id text NOT NULL, rule_version text NOT NULL,
  payload jsonb NOT NULL,                 -- validated payload, raw strings unchanged
  results jsonb,                          -- server calculateGraphieResults output (submission only)
  local_draft_revision integer NOT NULL CHECK (local_draft_revision >= 1),
  client_saved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_id, revision),
  CHECK ((kind = 'submission') = (results IS NOT NULL))
);

CREATE TABLE audit_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL UNIQUE,          -- exactly one accepted submission per audit
  revision integer NOT NULL,
  submitted_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL,
  operation_id uuid NOT NULL UNIQUE,
  FOREIGN KEY (audit_id, revision) REFERENCES audit_revisions(audit_id, revision) ON DELETE RESTRICT
);

CREATE TABLE sync_operation_outcomes (
  idempotency_key uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('sync-draft','submit')),
  request_fingerprint text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted','rejected','conflict')),
  http_status integer NOT NULL CHECK (http_status IN (200, 409, 422)),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Plus one `BEFORE UPDATE OR DELETE` trigger function that raises an exception, attached to `audit_revisions`, `audit_submissions` and `sync_operation_outcomes`. `audits` stays updatable: it is the current-state pointer.

## Writes on acceptance (one transaction, after the task lock)

| Kind | Rows |
|---|---|
| `sync-draft` | Insert `audits` (state `draft`, revision 1) if absent, otherwise update `current_revision`, `updated_at`, `updated_by`. Insert `audit_revisions` (`draft-sync`, `results` NULL). Insert the outcome. |
| `submit` | Same audit upsert, with state `submitted`. Insert `audit_revisions` (`submission`, `results` set). Insert `audit_submissions` (`accepted_at` = the transaction's `now()`, which is also the response's `acceptedAt`). Insert the outcome. |

`serverRevision` in the response is the new `current_revision`. A rejection or conflict inserts only the outcome row.

## Conflict metadata source

`current.revision` = `current_revision`, or `0` with no audit. `current.state` = `state`, or `draft`. `lastChangedAt` and `lastChangedBy` come from `updated_at` and `updated_by` joined to `identity_accounts.display_name`, or `null` with no audit.

## Migration test

Add the staged-upgrade check used for earlier migrations (`migrateThrough`). Migrating 0008 → 0009 on a database that has tasks keeps every row. The triggers refuse `UPDATE` and `DELETE` on the three history tables.
