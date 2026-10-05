# Mobile transport, triggers and acceptance line (CAP-7, CAP-8)

## Typed client (`packages/api-client/src/v1.ts`)

`syncEmployeeTaskDraft(taskId, body, { signal? })` and `submitEmployeeTaskAudit(taskId, body, { signal? })` send the envelope with the session token. They return a discriminated result:

```ts
type SyncOperationResponse =
  | { status: 200; body: SyncOperationAccepted }
  | { status: 409; body: SyncOperationConflict }
  | { status: 422; body: SyncOperationRejected };
```

Any other status, an `ApiError` 422 (`IDEMPOTENCY_KEY_REUSED`), or a 200/409/422 body that fails its schema throws `ApiRequestError(status, code)`. An unparseable body gets the code `UNEXPECTED_API_RESPONSE`. Network failures and aborts propagate as thrown errors.

## Adapter (`apps/mobile/sync/app-sync-transport.ts`)

`createAppSyncTransport(api: ApiClient): SyncTransport` builds the envelope from the `SyncRequest`. It picks the route from `kind`, maps `snapshot.payload`, maps `snapshot.revision` to `localDraftRevision`, and maps `snapshot.savedAt` to an ISO `clientSavedAt`. The App passes its single `ApiClient`, so the token is the signed-in one.

| Response | `SyncResult` |
|---|---|
| 200 | `{ type: "accepted", serverRevision, detail: { acceptedAt, submissionId?, acceptedBy } }` |
| 409 | `{ type: "conflict", serverRevision, detail: body.current }` |
| 422 with `outcome: "rejected"` | `{ type: "rejected", detail: { code, issues } }` |
| Network error, abort after **30 s**, HTTP 408, 429, 5xx | `{ type: "retryable", code }` (`network-error`, `timeout` or `HTTP_<status>`) |
| 400, 401, 403, 404, 413, 422 `IDEMPOTENCY_KEY_REUSED`, unexpected body or status | `{ type: "blocking", code }` (the `ApiError` code, or `HTTP_<status>`) |

The adapter never returns `accepted` without a schema-valid 200 body. `detail` holds no payload values.

## Engine changes (`apps/mobile/sync/sync-engine.ts`)

- **Task-level blocking.** `TASK_LEVEL_BLOCKING_CODES = ["TASK_NOT_FOUND"]`. For such a code the item is recorded `blocked` (as today), only that task stops, and the run continues with the next task. Every other blocking code still stops the whole run.
- **Follow-up run.** If `run(employeeId)` is called while a run for the same employee is active, the engine sets a flag. When the active run ends, it starts exactly one new run, and the caller's promise resolves after that run. Several calls during one run give one follow-up run. The 7.1 rules (one run at a time, other employees queued after) are unchanged.

## App triggers (`apps/mobile/App.tsx`)

Each trigger calls the existing `runSync(user.id)`, which checks `isSyncAuthorized` (online, `online-authorized`, valid stored grant) and the engine.

1. Online authorization is established or confirmed for the signed-in employee (sign-in, server revalidation).
2. Connectivity changes from offline to online.
3. `AppState` changes to `active`.
4. A save that created a revision (not an unchanged save) succeeds.
5. The existing 7.2 triggers: explicit retry, and after a submission request.

`createAppSyncTransport(api)` is created once per App, as in 7.2. The `null` path is removed.

## Acceptance line (CAP-8)

When the task's latest `submit` item is resolved `accepted` and `outcomeMetadata.detail.acceptedAt` is a valid ISO date, the detail shows this under « État »:

« Soumission acceptée par le serveur le JJ/MM/AAAA à HH:MM. »

The date and time come from the device's local time (`getDate`, `getMonth`, `getFullYear`, `getHours`, `getMinutes`, zero-padded), through a pure formatter in `apps/mobile/sync/`. The template lives in `packages/i18n` (`fr.employeeTasks.submittedAt`). The line has role `summary`. It is not shown when `acceptedAt` is missing or invalid, and nothing else changes.
