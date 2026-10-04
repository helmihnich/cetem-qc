# Sync engine (CAP-3, CAP-4)

New module `apps/mobile/sync/` (for example `sync-engine.ts`), which depends on the local-drafts store, with no React and no network imports.

## Transport port

```ts
type SyncRequest = { operationId: string; idempotencyKey: string; kind: "sync-draft" | "submit";
  employeeId: string; taskId: string; baseRevision: number; snapshot: LocalDraft };
type SyncResult =
  | { type: "accepted"; serverRevision: number; detail?: unknown }
  | { type: "rejected"; detail: unknown }
  | { type: "conflict"; serverRevision: number; detail: unknown }
  | { type: "retryable"; code: string }   // network error, timeout, no response, HTTP 408/429/5xx
  | { type: "blocking"; code: string };   // 401, 403 (incl. ACCOUNT_DEACTIVATED, TASK_NOT_ASSIGNED), anything unexpected
interface SyncTransport { send(request: SyncRequest): Promise<SyncResult> }
```

If the transport throws, the result counts as `retryable`. Only `accepted`, `rejected` and `conflict` are definitive. An unknown response is never treated as definitive. The 7.3 HTTP adapter maps its responses to this union.

## Run

`createSyncEngine({ store, transport, now, sleep, isAuthorized })` exposes `run(employeeId): Promise<RunSummary>`.

1. If `isAuthorized(employeeId)` is false, return without sending.
2. Load the unresolved items of the employee (`queued`, `in-flight`, `retry-paused`, `blocked`). Group them by task and order them by `sequence`.
3. For each task, take the oldest unresolved item. Record the attempt start, send it, and record the result in its own transaction.
   - Definitive: resolve it and continue with the next item of that task.
   - Retryable: wait (1 s, 2 s, 4 s, 8 s) and try again, up to **5 attempts per item per run**. Then mark it `retry-paused` and stop this task for the run. Later items of the task wait, to keep the order.
   - Blocking: mark it `blocked` and stop the whole run (authorization problem).
4. Only one run per engine at a time. A second `run` call while one is active returns the active run's promise.

Each new trigger starts a new run (app start, reconnect, return to foreground, after save, explicit retry in 7.2). The triggers are wired in a later story. `attempt_count` keeps counting across runs. The operation ID and idempotency key never change.

The 5 attempts and the waits are technical settings, not CETEM rules. Tests inject `sleep` so they never really wait.

## Guarantees to prove

- After a lost response (the transport records the request, then throws), the next attempt sends the same `operationId` and `idempotencyKey`. A single `accepted` outcome is stored.
- A crash between "attempt start" and "outcome" leaves the item unresolved (`in-flight`). The next run sends it again with the same key.
- If recording the outcome fails, the item stays unresolved, so a definitive outcome is never assumed.
- When an item is accepted, later items of the task that had the same base move to the new server revision.
- Items of employee B are never loaded or sent in a run for employee A.
