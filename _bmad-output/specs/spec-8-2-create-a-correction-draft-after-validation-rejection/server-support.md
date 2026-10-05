# Server support (CAP-4, CAP-6 server side)

## Envelope field — `correctionOfOperationId`

`SyncOperationRequest` gains the optional field `correctionOfOperationId: string` (UUID). Both sync routes (`…/draft-syncs`, `…/submissions`) accept it. When the field is absent, the 7.3/8.1 behaviour does not change at all, byte for byte.

**Fingerprint.** `requestFingerprint` adds `correctionOfOperationId` to the canonical object **only when it is present**. Stored fingerprints therefore stay valid, and replays do not change.

**Check order.** One step is added to the 8.1 transaction, right after step 5.4b (the conflict reference) and before step 5.5 (payload validation):

5.4c. When `correctionOfOperationId` is present, look up `sync_operation_outcomes` by `operation_id` (lower-cased). The reference is **valid** when the row exists with `outcome = 'rejected'`, `kind = 'submit'`, the same `actor_id`, the same `task_id` and a stored `response.code` other than `AUDIT_ALREADY_SUBMITTED`, and when one of these also holds:
- no `audit_lineage_links` row uses it as predecessor (**unlinked**);
- the only such row is a `rejected-submission-correction` link to this task's audit (**already linked**).

Otherwise the outcome is rejected with `INVALID_CORRECTION_REFERENCE` « La référence de la soumission corrigée est invalide. ». It is stored with the issue `{ path: "correctionOfOperationId", code: "invalid-reference" }`.

**On acceptance** (step 5.6), the `audits` command inserts `('rejected-submission-correction', audit_id, revision, predecessor, actor)` after the revision insert, in the same transaction, only for an **unlinked** reference. If the operation also carries a valid `conflictOperationId`, its 8.1 row is inserted too.

`SyncOperationRejected.code` gains `INVALID_CORRECTION_REFERENCE`. The mobile adapter already maps every 422 `rejected` body to `rejected`. A refused `submit` with this code is itself a qualifying refusal (correction-model.md), so the Employé can correct again.

## Migration `0012_correction_lineage.sql`

```sql
ALTER TABLE audit_lineage_links DROP CONSTRAINT audit_lineage_links_link_type_check;
ALTER TABLE audit_lineage_links ADD CONSTRAINT audit_lineage_links_link_type_check
  CHECK (link_type IN ('sync-conflict-revision', 'rejected-submission-correction'));
```

- Use the actual constraint name from 0011 (the PostgreSQL default is shown). The triggers, the UNIQUE predecessor and the foreign keys stay as they are.
- `audits` owns the insert (`audits/commands/`) and the « link of this predecessor » read, which `sync` calls inside the transaction. `sync` reads the outcome row it owns and passes the validated reference, with its linked or unlinked status, to the `audits` command.
- `replacement-control` is not added. It belongs to 8.3.
- The migration test uses `migrateThrough`: 0011 → 0012 on a database with audits and an 8.1 link keeps every row. The triggers still refuse UPDATE, DELETE and TRUNCATE. An unknown `link_type` is still refused.

## Validation (CAP-6)

`validateGraphiePayload` gains the unpaired-surrogate rule (payload-validation.md). The rejection is a stored 422 `INVALID_PAYLOAD` with the issue code `unpaired-surrogate`. Issue paths keep the existing sanitizing. The value is never echoed.
