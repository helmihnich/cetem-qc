# Server commands (CAP-1 to CAP-6)

## Operations

| Operation ID (OpenAPI) | Route | Kind | Command |
|---|---|---|---|
| `syncEmployeeTaskDraft` | `POST /api/v1/employee/tasks/{taskId}/draft-syncs` | `sync-draft` | `SyncDraft` |
| `submitEmployeeTaskAudit` | `POST /api/v1/employee/tasks/{taskId}/submissions` | `submit` | `AcceptSubmission` |

Both routes set `Cache-Control: no-store` (they sit under `/employee/tasks`). They accept JSON bodies up to 256 kB. Every other route keeps the 32 kB limit.

## Request envelope (`SyncOperationRequest`, strict)

```ts
{
  operationId: string;        // UUID, from the outbox item
  idempotencyKey: string;     // UUID, from the outbox item, distinct from operationId
  baseRevision: number;       // safe integer >= 0
  localDraftRevision: number; // safe integer >= 1, the snapshot's local revision
  clientSavedAt: string;      // ISO 8601 date-time, the snapshot's savedAt
  payload: object;            // the snapshot payload, validated below
}
```

The actor is the session account. A body field naming an employee is an unknown key, so the request gets 400.

## Check order

Steps 1–4 run before the transaction and write nothing.

1. Session (`requireSession`). If it is missing, expired, revoked, deactivated or must change its password: 401 `AUTHENTICATION_FAILED`.
2. Role `employe`. Otherwise: 403 `FORBIDDEN` « Accès réservé à l’Employé. ».
3. `taskId` is a UUID and assigned to the caller, through the public `tasks` query. Otherwise: 404 `TASK_NOT_FOUND` « Tâche introuvable. ».
4. Envelope schema. Otherwise: 400 `VALIDATION_ERROR` with issue paths and no values.
5. Transaction:
   1. Take the task lock `pg_advisory_xact_lock(hashtextextended('audit:' || taskId, 0))`, then read the task's audit row (it may be absent, which means revision `0`). The audit row is created only on acceptance, so a rejection or conflict writes no audit data.
   2. Look up `sync_operation_outcomes` by `idempotency_key`, and by `operation_id`.
      - **Found, with the same actor, kind, task and fingerprint:** commit nothing new and return the stored `http_status` and `response`.
      - **Found, with anything different:** 422 `IDEMPOTENCY_KEY_REUSED` (an `ApiError`, not stored).
   3. If the audit state is `submitted`: rejected `AUDIT_ALREADY_SUBMITTED`.
   4. If `baseRevision ≠ current_revision`: conflict.
   5. Validate the payload ([below](#payload-validation)). If it fails: rejected.
   6. Accept. See [data-model.md](data-model.md) for the rows.
   7. Insert the outcome row (key, operation ID, actor, task, kind, fingerprint, outcome, status, body). Commit.

Steps 5.3 to 5.6 each produce one outcome, and step 5.7 stores it. If a unique violation on the outcome row happens (a concurrent duplicate that slipped past the lock), the transaction rolls back and is retried once from step 5. The retry then finds the stored outcome.

**Fingerprint.** It is the SHA-256 of the canonical JSON (keys sorted recursively) of `{ kind, taskId, operationId, baseRevision, localDraftRevision, clientSavedAt, payload }`.

## Payload validation

The validator is `validateGraphiePayload(payload, kind)` in `packages/domain`, next to the moved catalogue ([delivery-notes.md](delivery-notes.md)). Its result is `{ ok: true, payload } | { ok: false, code, issues: { path, code }[] }`.

| Condition | Code |
|---|---|
| Legacy Story 5.3 payload `{ content }` | `UNSUPPORTED_PAYLOAD` |
| `catalogueId`/`catalogueVersion`/`schemaVersion`/`ruleId`/`ruleVersion` not exactly `graphie-mobile-pov` / `2.0.0` / `3` / `cetem-paper-form` / `2.0.0` | `UNSUPPORTED_PAYLOAD_VERSION` |
| Unknown top-level key; `values` not a plain object; a non-string value; an unknown field ID; a non-empty choice value outside the field's options; a `\u0000` in any value or in `legacyContent` | `INVALID_PAYLOAD` |
| `legacyContent` present on a `submit` | `INVALID_PAYLOAD` (path `legacyContent`) |

These are exactly the rules of the current mobile `parseGraphiePayload`, plus NUL and the submit/legacy rule (mobile already refuses that locally). Blank, missing and unparseable readings are valid. **No other validation exists until CETEM approves DEP-01/02.**

## Responses

All bodies are strict schemas in OpenAPI. French `message` texts live in the API, as in the existing routes.

| Status | Body | Stored |
|---|---|---|
| 200 | `SyncOperationAccepted` `{ outcome: "accepted", operationId, kind, serverRevision, acceptedAt, acceptedBy: { id, displayName }, submissionId? }`. `submissionId` is present only for `submit` | yes |
| 409 | `SyncOperationConflict` `{ outcome: "conflict", operationId, kind, serverRevision, current: { revision, state: "draft" \| "submitted", lastChangedAt: string \| null, lastChangedBy: { id, displayName } \| null } }`. `serverRevision` = `current.revision` | yes |
| 422 | `SyncOperationRejected` `{ outcome: "rejected", operationId, kind, code, message, issues: { path, code }[] }` | yes |
| 422 | `ApiError` `IDEMPOTENCY_KEY_REUSED` | no |
| 400 / 401 / 403 / 404 / 500 | `ApiError` | no |
| 413 | `ApiError` `PAYLOAD_TOO_LARGE` « Les données envoyées sont trop volumineuses. » (body over 256 kB) | no |

`acceptedAt` and `lastChangedAt` are ISO 8601 UTC. Rejection messages: `UNSUPPORTED_PAYLOAD` / `UNSUPPORTED_PAYLOAD_VERSION` « Cette version du formulaire n’est pas prise en charge par le serveur. », `INVALID_PAYLOAD` « Les données du contrôle sont invalides. », `AUDIT_ALREADY_SUBMITTED` « Ce contrôle a déjà été soumis et accepté. ».

## Server recalculation (CAP-6)

On `submit`, before inserting the revision: `results = calculateGraphieResults(identity, payload.values)`, where `identity` is the five identity fields of the validated payload. Then every one of the five results must carry the same `catalogueId`, `catalogueVersion`, `schemaVersion`, `ruleId` and `ruleVersion` as the revision columns. Otherwise the command throws, the transaction rolls back, and the response is 500 with nothing stored. Results are stored as returned, with no rounding and no overall verdict.

## Module layout

- `apps/api/src/modules/audits/commands/` — `applyDraftSync(transaction, …)` and `acceptSubmission(transaction, …)`, plus the audit lock and read. Revision, submission and audit SQL lives only here.
- `apps/api/src/modules/sync/commands/process-sync-operation.ts` — steps 5.1–5.7: idempotency lookup and store, then a call to the `audits` command. It owns `sync_operation_outcomes`.
- `apps/api/src/modules/tasks/queries/` (or `index.ts`) — exposes `getAssignedEmployeeTask` publicly, so `sync` does not import `tasks.ts` internals.
- `apps/api/src/index.ts` — the two routes. The JSON parser is mounted per route, so the 256 kB limit applies only there.
