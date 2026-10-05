# Correction model (CAP-2, CAP-3)

## Local schema v4 → v5

`initializeDraftDatabase` gets a `versionInside < 5` step inside the existing exclusive migration transaction. The step changes no existing row. At version 5 the startup check also requires the new table and column. A version above 5 is still refused, and nothing is deleted.

```sql
ALTER TABLE outbox_operations ADD COLUMN correction_operation_id TEXT;  -- correction lineage: the refused submit this item corrects
CREATE TABLE correction_drafts (
  correction_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  rejected_operation_id TEXT NOT NULL UNIQUE,  -- a refused submit is corrected at most once
  rejected_snapshot_id TEXT NOT NULL,          -- the preserved snapshot, never deleted
  rejected_at INTEGER NOT NULL,                -- resolved_at of the refused item, for the link line
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),  -- the local revision the correction created
  created_at INTEGER NOT NULL
);
CREATE TRIGGER correction_drafts_no_update BEFORE UPDATE ON correction_drafts
  BEGIN SELECT RAISE(ABORT, 'correction_drafts is insert-only'); END;
PRAGMA user_version = 5;
```

The table is insert-only. As in 8.1, there is an `UPDATE` trigger and no code path deletes, so the upgrade issues no `DELETE`. Column names may be adjusted, but the constraints must stay.

`OutboxItem` gains `correctionOperationId?: string | null`, which the store always sets. New type:

```ts
type CorrectionDraft = {
  correctionId: string; employeeId: string; taskId: string;
  rejectedOperationId: string; rejectedSnapshotId: string; rejectedAt: number;
  draftRevision: number; createdAt: number;
};
```

## Qualifying refusal

A task's **open refusal** is its `submit` item with the highest `sequence`, when all three hold:
- the item is resolved `rejected`;
- its `outcomeMetadata.detail.code` is not `AUDIT_ALREADY_SUBMITTED`;
- no `correction_drafts` row names it.

A missing or unreadable `detail` still qualifies. The UI then shows the generic message (correction-ui.md).

## Repository (`apps/mobile/local-drafts/model.ts`, adapter)

New method, a single exclusive transaction behind the per-scope queue, exposed through `createAuthorizedDrafts`:

```ts
createCorrectionDraft(employeeId, taskId, input: { rejectedOperationId: string }):
  Promise<{ draft: LocalDraft; correction: CorrectionDraft }>;
listCorrectionDrafts(employeeId): Promise<CorrectionDraft[]>;
```

The method refuses with `CorrectionDraftError(reason)` and writes nothing when:

| Reason | Condition (checked inside the transaction) |
|---|---|
| `stale` | `rejectedOperationId` is not the task's open refusal (another submit exists, it is already corrected, or its code is `AUDIT_ALREADY_SUBMITTED`) |
| `open-conflict` | The task has an open conflict (8.1) |
| `unresolved` | The task has an unresolved item |
| `snapshot-unavailable` | The refused snapshot is missing, fails `parseLocalDraft`, has another scope, or has legacy content |

Steps, in the same transaction:
1. Insert the `correction_drafts` row. `rejected_at` is the refused item's `resolved_at`, and `draft_revision` is the new local revision.
2. Upsert `local_drafts`: the payload is the snapshot payload; the revision is `previous.revision + 1`, or 1 when no row exists; `id` and `createdAt` are kept when the row exists; `savedAt = max(now, previous.savedAt)`. This is a write even when the payload equals the current draft, so the correction is a distinct revision.
3. Insert no snapshot and no outbox item. Leave `task_sync_state` unchanged.

**Stamping.** `save` and `requestSubmission` set `correction_operation_id` on every new item when the task has an **unlinked correction**. An unlinked correction is the latest correction of the task, while no outbox item carrying its `rejected_operation_id` is resolved `accepted`. A superseding item inherits the value from the never-attempted item it replaces. Other refusals and rules of `save`, `requestSubmission`, `delete` and `deleteUnreadable` are unchanged.

**Preservation.** The rules of outbox-model.md and conflict-model.md stay. Creation deletes nothing.

## Engine (`apps/mobile/sync/sync-engine.ts`) and adapter

- `SyncRequest` gains `correctionOfOperationId?: string`, copied from the item when it is set. The 7.3 adapter adds it to the envelope only when it is set.
- The engine's handling of a `rejected` outcome is unchanged. It records the outcome, and the run continues.

## Derivation (`apps/mobile/sync/task-sync-state.ts`)

The signature becomes `deriveTaskSyncState(items, resolutions, corrections = [])`. It stays the single place that maps rows to state. The result gains two fields:

```ts
rejection: { operationId: string; code: string | null; issues: { path: string; code: string }[]; canCorrect: boolean } | null;
correction: { rejectedOperationId: string; rejectedAt: number } | null;
```

The rules run in this order. Every 8.1 rule comes first and is unchanged.

| Condition | `lifecycle` | `locked` | `canSubmit` | `rejection` / `correction` |
|---|---|---|---|---|
| Open conflict (8.1) | as 8.1 | as 8.1 | no | `null` / as below |
| The latest submit is resolved `rejected` and not corrected | `acceptance-blocked` | yes | no | `rejection` set. `canCorrect` is true unless the code is `AUDIT_ALREADY_SUBMITTED` or an item is unresolved. |
| Otherwise | 7.2/8.1 rules, computed **without corrected refused submits** | as 7.2 | as 7.2/8.1 | `rejection: null` |

`correction` holds the latest correction of the task while no `submit` item has a higher `sequence` than its refused item. The refused item was the latest submit at creation, so any later submit has a higher sequence. Otherwise `correction` is null. `canRetry` is unchanged.
