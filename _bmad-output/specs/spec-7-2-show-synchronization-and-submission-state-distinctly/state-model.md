# State model (CAP-1, CAP-3, CAP-5, CAP-6)

New pure module `apps/mobile/sync/task-sync-state.ts`, with no React, no I/O and no i18n import:

```ts
type TaskLifecycle = "draft" | "submission-pending" | "submitted" | "acceptance-blocked" | "conflict";
type TransferState = "none" | "queued" | "in-flight" | "retry-paused" | "blocked"
  | "draft-synchronized" | "draft-rejected" | "draft-conflict";
type TaskSyncState = { lifecycle: TaskLifecycle; transfer: TransferState; locked: boolean; canRetry: boolean };
function deriveTaskSyncState(items: readonly OutboxItem[]): TaskSyncState; // items of one employee+task, any order
```

## Lifecycle (status-badge, « État »)

`S` is the task's `submit` item with the highest `sequence`.

| Condition | `lifecycle` | French label |
|---|---|---|
| No `submit` item | `draft` | Brouillon |
| `S` unresolved (`queued`, `in-flight`, `retry-paused`, `blocked`) | `submission-pending` | Soumission en attente de synchronisation |
| `S` resolved `accepted` | `submitted` | Soumis — accepté par le serveur |
| `S` resolved `rejected` | `acceptance-blocked` | Soumission bloquée — non acceptée par le serveur |
| `S` resolved `conflict` | `conflict` | Conflit de synchronisation |

`locked = lifecycle !== "draft"`.

## Transfer (sync-status, « Synchronisation »)

The relevant item depends on the lifecycle:

- `submission-pending`: `S`.
- `draft`: the unresolved `sync-draft` item with the lowest `sequence`.
- Any other lifecycle: none, so `transfer = "none"`.

| Relevant item / history | `transfer` | French label | Role |
|---|---|---|---|
| `in-flight` | `in-flight` | Synchronisation en cours… | summary |
| `queued` | `queued` | En attente de synchronisation — conservé sur cet appareil | summary |
| `retry-paused` | `retry-paused` | Échec du transfert — vos données sont conservées sur cet appareil | alert |
| `blocked` | `blocked` | Synchronisation bloquée — vos données sont conservées sur cet appareil | alert |
| Draft, nothing unresolved, latest resolved `sync-draft` `accepted` | `draft-synchronized` | Brouillon synchronisé — non soumis | summary |
| Draft, nothing unresolved, latest resolved `sync-draft` `rejected` | `draft-rejected` | Synchronisation du brouillon refusée par le serveur — brouillon conservé sur cet appareil | alert |
| Draft, nothing unresolved, latest resolved `sync-draft` `conflict` | `draft-conflict` | Conflit de synchronisation | alert |
| Draft, no item at all | `none` | Non synchronisé | summary |

`canRetry = transfer is "retry-paused" or "blocked"`. The retry button label is « Réessayer la synchronisation ».

When `lifecycle` is not `draft`, the « Synchronisation » line shows the transfer label for `submission-pending`. For `submitted`, `acceptance-blocked` and `conflict`, the line is not rendered, because the lifecycle label already says it all.

## Other lines (unchanged sources)

- « Connectivité »: En ligne / Hors ligne (existing).
- « Enregistrement local »: existing `draftSaveState` labels. While `locked`, it shows the last saved state and never « Enregistrement en cours… ».

## New French strings (`fr.employeeTasks`)

| Key (suggested) | Text |
|---|---|
| `submit` | Soumettre |
| `confirmSubmit` | Soumettre ce contrôle ? Après la demande, les mesures et commentaires ne pourront plus être modifiés sur cet appareil. |
| `submissionPending` | Soumission en attente de synchronisation |
| `submitted` | Soumis — accepté par le serveur |
| `acceptanceBlocked` | Soumission bloquée — non acceptée par le serveur |
| `syncConflict` | Conflit de synchronisation |
| `retrySync` | Réessayer la synchronisation |
| `syncInFlight` | Synchronisation en cours… |
| `syncQueued` | En attente de synchronisation — conservé sur cet appareil |
| `syncFailed` | Échec du transfert — vos données sont conservées sur cet appareil |
| `syncBlocked` | Synchronisation bloquée — vos données sont conservées sur cet appareil |
| `draftSynchronized` | Brouillon synchronisé — non soumis |
| `draftSyncRejected` | Synchronisation du brouillon refusée par le serveur — brouillon conservé sur cet appareil |
| `notSynchronized` | Non synchronisé |
| `submissionNotAllowed` | Ce brouillon ne peut pas être soumis depuis cet appareil. |
| `submissionFailed` | La demande de soumission n’a pas pu être enregistrée. Le brouillon local est conservé. |
| `readOnlyPending` | Lecture seule : la soumission a été demandée. |

The keys may be renamed. The texts may change only toward EXPERIENCE.md wording. `synchronizedNotSubmitted` is no longer rendered. Remove it if nothing else uses it.

## App behaviour

- **Refresh.** After open, save, submission request, delete and every run, the App re-reads `listOutbox(employeeId)` through `createAuthorizedDrafts`. It derives the state per task from that list. A read failure keeps the previous state and does not fall back to « Brouillon ».
- **Soumettre.** The button is visible only when `draftHydration === "ready"`, the lifecycle is `draft`, and no delete or submission is in progress. Confirming does five things. It clears the autosave timer. It chains onto `draftSaveQueueRef`, so the request runs after pending saves. It calls `requestSubmission(employeeId, taskId, currentPayload, currentRevision)`. It updates the revision refs from the returned draft. It refreshes the outbox and starts a run if the run preconditions hold. A busy flag disables the button until the request settles. `PendingSubmissionError` refreshes the state, which is then already pending. `SubmissionNotAllowedError` shows `submissionNotAllowed`. Any other error shows `submissionFailed` and calls `redactDraftIfAuthorizationLost`.
- **Lock.** `changeFormField`, `changeDraftContent`, `saveDraft` and the autosave effect return early while `locked`. `editable` props include `!locked`. The delete and Soumettre buttons are hidden while `locked`. `leaveTaskDetail` and `signOut` do not try to save a locked task.
- **Retry.** `canRetry` shows the alert line and « Réessayer la synchronisation ». Pressing it calls `engine.run(user.id)`, but only when online, `evaluate` is `online-authorized` and the transport is not null. Otherwise it shows the existing `fr.auth.offlineUnavailable` or `reauthenticateOnline` message and does not run. While the run is active, the line reads « Synchronisation en cours… ». When it ends, the App refreshes.
- **Engine instance.** It is created once per App with `createSyncEngine({ store: draftsRef.current, transport, now: Date.now, sleep, isAuthorized })`. `sleep` is a `setTimeout` promise. `isAuthorized` checks connectivity and `online-authorized`. When the transport is null, no engine run is started.
