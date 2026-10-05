# Conflict model (CAP-1, CAP-3, CAP-4)

## Local schema v3 → v4

`initializeDraftDatabase` gets a `versionInside < 4` step inside the existing exclusive migration transaction. The step changes no existing row. At version 4 the startup check also requires the new tables and column. A version above 4 is still refused, and nothing is deleted.

```sql
ALTER TABLE outbox_operations ADD COLUMN conflict_operation_id TEXT;  -- keep-local lineage: the conflicted operation this item resolves
CREATE TABLE conflict_resolutions (
  resolution_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('keep-local','discard-local')),
  server_revision INTEGER NOT NULL CHECK (server_revision >= 0),   -- from the successful fetch
  server_state TEXT NOT NULL CHECK (server_state IN ('draft','submitted')),
  new_operation_id TEXT,                                           -- keep-local: the new sync-draft item
  created_at INTEGER NOT NULL,
  CHECK ((choice = 'keep-local') = (new_operation_id IS NOT NULL))
);
CREATE TABLE conflict_resolution_items (
  operation_id TEXT PRIMARY KEY,              -- an item is covered by at most one resolution
  resolution_id TEXT NOT NULL REFERENCES conflict_resolutions(resolution_id),
  employee_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('conflict','withdrawn')),
  kind TEXT NOT NULL CHECK (kind IN ('sync-draft','submit')),
  snapshot_id TEXT NOT NULL                    -- the preserved snapshot, never deleted
);
PRAGMA user_version = 4;
```

Both new tables are insert-only: no code path updates or deletes them. Column names may be adjusted, but the constraints must stay. `OutboxItem` gains `conflictOperationId: string | null` and `conflictResolutionId: string | null`. The second field is joined from `conflict_resolution_items` for `conflict` items.

## Open conflict

An item is an **open conflict** when `outcome = 'conflict'` and `conflictResolutionId` is null. A task with at least one open conflict is **in conflict**. When several conflicts are open (data from before 8.1), one resolution covers all of them. Its lineage references the one with the highest `sequence`.

## Repository changes (`apps/mobile/local-drafts/model.ts`, adapter)

New typed error: `OpenConflictError`. Every refusal leaves every row unchanged.

| Method | While the task is in conflict |
|---|---|
| `save` | Writes `local_drafts` with the existing revision guard. Creates **no** snapshot and **no** outbox item. Refused (`PendingSubmissionError`) when the task also has an unresolved `submit` item, as today. |
| `requestSubmission`, `delete`, `deleteUnreadable` | Refused with `OpenConflictError`. |
| Supersession (save or `requestSubmission` outside a conflict) | Unchanged, except that the new item inherits `conflict_operation_id` from the never-attempted item it supersedes. |

New methods. Each one is a single exclusive transaction behind the per-scope queue, exposed through `createAuthorizedDrafts`:

```ts
resolveConflictKeepLocal(employeeId, taskId, input: {
  conflictOperationIds: string[];            // the open conflicts the panel showed
  server: { revision: number; state: "draft" }; // from the successful fetch
}): Promise<{ draft: LocalDraft; operation: OutboxItem }>;

resolveConflictDiscardLocal(employeeId, taskId, input: {
  conflictOperationIds: string[];
  server: { revision: number; state: "draft" | "submitted"; payload: GraphieDraftPayload | null };
}): Promise<{ draft: LocalDraft | null }>;

listConflictResolutions(employeeId): Promise<ConflictResolution[]>;
```

Common checks, which refuse with `ConflictResolutionError` and write nothing:
- the task's set of open conflicts equals `conflictOperationIds` (stale panel);
- no unresolved item of the task has `attempt_count > 0`.

| Step (same transaction) | Keep local | Discard local |
|---|---|---|
| Extra refusals | `server.state` is `submitted`. The local draft is missing or `parseLocalDraft` fails. (`legacyContent` is not refused: a draft-sync may carry it, as in 7.3.) | `server.payload` is non-null and a draft built from it fails `parseLocalDraft`. |
| Resolution row | `choice = 'keep-local'`, server revision and state, `new_operation_id` | `choice = 'discard-local'`, server revision and state |
| Resolution items | One `conflict` row per open conflict, and one `withdrawn` row per unresolved item of the task. Each row records `snapshot_id` and `kind`. | Same |
| Withdrawn items | Delete their `outbox_operations` rows. **Keep their snapshots.** | Same |
| Local draft | Unchanged. It is the preserved local version. | Payload non-null: upsert a new local revision (`previous.revision + 1`, or 1) with the server payload. Payload null: delete the row. |
| Outbox | Insert a `sync-draft` snapshot of the local draft, and an item with new IDs, `base_revision = server.revision` and `conflict_operation_id` = the open conflict with the highest sequence | Nothing |
| `task_sync_state` | Upsert `server_revision = server.revision` | Same |

The preservation rules of outbox-model.md stay, with one addition. A confirmed conflict resolution may delete **never-attempted unresolved** items of its own task, and it records each one in `conflict_resolution_items`. Snapshots are never deleted.

## Engine (`apps/mobile/sync/sync-engine.ts`)

- When it loads a task, the engine skips the task if it has an open conflict. This applies to every run, `retryBlocked` included.
- After it records a `conflict` outcome, the engine stops that task for the run (it does not continue with the next item).
- `SyncRequest` gains `conflictOperationId?: string`, copied from the item. The 7.3 adapter adds it to the envelope only when it is set.
- All other 7.1/7.3 engine rules are unchanged.

## Derivation (`apps/mobile/sync/task-sync-state.ts`)

The signature becomes `deriveTaskSyncState(items, resolutions)`, for one employee and task. It stays the single place that maps rows to state (7.2 hand-off). The result gains `conflict: OpenConflictSummary | null` and `canSubmit: boolean`.

Rules, in order. A **closed conflict** is a `conflict` item with a resolution.

| Condition | `lifecycle` | `transfer` | `locked` | `canSubmit` |
|---|---|---|---|---|
| Open conflict, and its item is a `submit` or the task has an unresolved `submit` | `conflict` | `none` | yes | no |
| Open conflict otherwise (draft conflict) | `draft` | `draft-conflict` | no | no |
| Latest resolution is `discard-local` with `server_state = 'submitted'`, and no `submit` item was created after it | `submitted` | `none` | yes | no |
| Otherwise | The 7.2 rules, computed **without closed conflict items**. If the latest resolution is `discard-local` and no item was created after it, `transfer = 'draft-synchronized'`. | | as 7.2 | `lifecycle = draft` and no unresolved `submit` |

`canRetry` is false whenever the task is in conflict. `OpenConflictSummary` holds:
- the open conflict items (operation ID, kind, sequence);
- the stored 409 `detail` (`current` metadata);
- `hasPendingSnapshot` (a conflicted or unresolved `submit` exists).
