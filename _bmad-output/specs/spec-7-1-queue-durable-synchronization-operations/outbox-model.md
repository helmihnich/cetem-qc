# Outbox model (CAP-1, CAP-2, CAP-3, CAP-5)

## Schema upgrade v2 → v3

`initializeDraftDatabase` gets a `versionInside < 3` step inside the existing exclusive migration transaction. The step only creates tables, so no existing row is touched. At version 3 the startup check also requires the three new tables. A version above 3 is still refused, and nothing is deleted.

```sql
CREATE TABLE audit_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sync-draft','submit')),
  draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
  payload_json TEXT NOT NULL,          -- JSON.stringify(LocalDraft) as saved
  created_at INTEGER NOT NULL
);
CREATE TABLE outbox_operations (
  operation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  employee_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,           -- per-device monotonic, gives FIFO order
  kind TEXT NOT NULL CHECK (kind IN ('sync-draft','submit')),
  snapshot_id TEXT NOT NULL UNIQUE REFERENCES audit_snapshots(snapshot_id),
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  status TEXT NOT NULL CHECK (status IN ('queued','in-flight','retry-paused','blocked','resolved')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,                     -- technical code only, no payload
  outcome TEXT CHECK (outcome IN ('accepted','rejected','conflict')),
  outcome_json TEXT,                   -- server revision / rejection / conflict metadata
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  CHECK ((status = 'resolved') = (outcome IS NOT NULL))
);
CREATE INDEX outbox_employee_task_seq ON outbox_operations(employee_id, task_id, sequence);
CREATE TABLE task_sync_state (
  employee_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  server_revision INTEGER NOT NULL CHECK (server_revision >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (employee_id, task_id)
);
PRAGMA user_version = 3;
```

Column names may be adjusted, but the constraints must stay: a snapshot is never updated, every row is scoped by employee, a resolved item always has an outcome, and the idempotency key is unique.

## Writes (one exclusive transaction each)

| Operation | In the same transaction |
|---|---|
| `save` (draft changed) | Refuse if the task has an unresolved `submit` item. Upsert `local_drafts` with the existing revision guard. Delete the never-attempted (`attempt_count = 0`) unresolved `sync-draft` item and its snapshot, if any. Insert a snapshot (`sync-draft`) and an item with `base_revision` = `task_sync_state.server_revision` or `0`. |
| `save` (no change, same payload) | Nothing is written, as today, and no item is created. |
| `requestSubmission` | Refuse if the task has an unresolved `submit` item, if the payload has `legacyContent`, or if the stored draft cannot be parsed. Save the payload as above, but create no `sync-draft` item. Supersede never-attempted `sync-draft` items. Insert a `submit` snapshot and item. Return the saved draft and the item. |
| `delete(expectedRevision)` / `deleteUnreadable` | Refuse if the task has an unresolved `submit` item. Delete the draft row (existing rules), then the task's unresolved `sync-draft` items and their snapshots. |
| record attempt start | Item → `in-flight`, `attempt_count + 1`. |
| record retryable result | Item → `queued` while the run may retry, otherwise `retry-paused`. Set `last_error`. |
| record blocking result | Item → `blocked`, set `last_error`. A later run retries it. |
| record definitive outcome | Item → `resolved` with `outcome`, `outcome_json` and `resolved_at`. For `accepted`, upsert `task_sync_state.server_revision` and move later unresolved items of the task whose `base_revision` equals this item's base to the new revision. |

On start, an `in-flight` item left by a crash counts as unresolved and its outcome is unknown. The next run sends it again with the same key.

Refusals throw a typed error (`PendingSubmissionError`, `SubmissionNotAllowedError`) and leave every row unchanged.

## Reads (repository API, through `createAuthorizedDrafts`)

- `listOutbox(employeeId)` returns every item for the employee (resolved ones too), in `sequence` order, without payloads.
- `getTaskSyncStatus(employeeId, taskId)` returns `{ hasPendingSubmission, unresolvedCount, lastOutcome }`, for 7.2 and the guards.

## Preservation rules (CAP-5)

- No code path deletes an unresolved item except explicit `delete`/`deleteUnreadable` (unresolved `sync-draft` items only) and supersession (never-attempted `sync-draft` items only).
- `signOut`, offline-authorization expiry or lock, a deactivation response, revocation of a cached task (`revokeCachedSynchronizedTask`), transport failure and migration leave every outbox item and snapshot untouched.
- Unparseable snapshot rows are never deleted automatically.
