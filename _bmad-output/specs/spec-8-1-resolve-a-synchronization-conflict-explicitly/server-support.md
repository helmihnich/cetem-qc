# Server support (CAP-5)

## Current version — `getEmployeeTaskAuditVersion`

`GET /api/v1/employee/tasks/{taskId}/audit-version` sends `Cache-Control: no-store`, like every route under `/employee/tasks`.

Check order (same as the 7.3 routes; nothing is written):
1. Session: 401 `AUTHENTICATION_FAILED`.
2. Role `employe`: otherwise 403 `FORBIDDEN` « Accès réservé à l’Employé. ».
3. `taskId` is a UUID assigned to the caller (public `tasks` query): otherwise 404 `TASK_NOT_FOUND` « Tâche introuvable. ».

200 body `EmployeeTaskAuditVersion` (strict):

```ts
{
  revision: number;                       // current_revision, 0 when the task has no audit
  state: "draft" | "submitted";           // "draft" when no audit
  lastChangedAt: string | null;           // ISO 8601 UTC, null when no audit
  lastChangedBy: { id: string; displayName: string } | null;
  payload: GraphieDraftPayload | null;    // payload of the current revision, unchanged; null when no audit
}
```

The query is `audits/queries/current-audit-version.ts` → `getCurrentAuditVersion(pool, taskId)`. It reads `audits` joined to `audit_revisions` at `current_revision` and to `identity_accounts`. No task lock is needed, because the read is a single statement. The metadata matches what a 409 would report at that instant. Errors give 500 `INTERNAL_ERROR` « La version du serveur n’a pas pu être chargée. », without values. The 7.4 route inventory test (F6) lists mutating routes only, so this GET leaves it unchanged.

Typed client: `getEmployeeTaskAuditVersion(taskId, { signal? })` returns the parsed body. It throws `ApiRequestError` on any other status or an invalid body, like the existing client methods. The device aborts after 30 s, the same technical limit as the 7.3 adapter.

## Envelope field — `conflictOperationId`

`SyncOperationRequest` gains the optional `conflictOperationId: string` (UUID). It is accepted on both sync routes. When it is absent, the 7.3 behaviour is byte-identical.

**Fingerprint.** `requestFingerprint` adds `conflictOperationId` to the canonical object **only when it is present**. Stored fingerprints of earlier requests therefore stay valid, and their replays are unchanged.

**Check order.** One step is inserted into the 7.3 transaction, between step 5.4 (base-revision conflict) and step 5.5 (payload validation):

5.4b. When `conflictOperationId` is present, look up `sync_operation_outcomes` by `operation_id`. It must be a row with `outcome = 'conflict'`, the same `actor_id`, the same `task_id`, and no existing `audit_lineage_links` row for it as predecessor. Otherwise the outcome is rejected `INVALID_CONFLICT_REFERENCE` « La référence du conflit de synchronisation est invalide. ». It is stored, with issue path `conflictOperationId`.

On acceptance (step 5.6), the `audits` command inserts the lineage row in the same transaction, after the revision insert.

`SyncOperationRejected.code` gains `INVALID_CONFLICT_REFERENCE`. The mobile adapter already maps every 422 `rejected` body to `rejected`. Such an item then shows the existing 7.2 rejected labels. Its recovery is the 8.2 flow, and it is not labelled a conflict.

## Lineage table — migration `0011_audit_lineage.sql`

```sql
CREATE TABLE audit_lineage_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type text NOT NULL CHECK (link_type IN ('sync-conflict-revision')),
  audit_id uuid NOT NULL,
  revision integer NOT NULL,
  predecessor_operation_id uuid NOT NULL UNIQUE REFERENCES sync_operation_outcomes(operation_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (audit_id, revision) REFERENCES audit_revisions(audit_id, revision) ON DELETE RESTRICT
);
```

- It uses the 0009 insert-only trigger function (`BEFORE UPDATE OR DELETE` raises) and the 0010 TRUNCATE refusal.
- `link_type` holds only `sync-conflict-revision`. Stories 8.2 and 8.3 extend the CHECK in their own migrations, with their own columns if needed.
- `audits` owns the table, the insert (`audits/commands/`) and the « already linked » read, which `sync` calls inside the transaction. `sync` reads the outcome row it owns and passes the validated reference to the `audits` command.
- The migration test uses `migrateThrough`: 0010 → 0011 on a database with audits keeps every row, and the triggers refuse UPDATE, DELETE and TRUNCATE.
