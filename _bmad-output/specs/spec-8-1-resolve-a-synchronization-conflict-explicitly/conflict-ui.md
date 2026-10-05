# Conflict UI and sync wiring (CAP-2, CAP-3, CAP-4, CAP-6)

## Sync wiring extraction (CAP-6, done first)

- Move the following out of `App.tsx` into `apps/mobile/sync/`:
  - engine creation (`createSyncEngine` with `createAppSyncTransport(api)`);
  - `isSyncAuthorized`, `runSync(employeeId, automatic)` and `refreshOutbox`;
  - the outbox and resolution state;
  - the automatic triggers (online authorization, offline → online, `AppState` active, after a changed save).
- Split it into a non-React controller (for example `task-sync-controller.ts`), which is unit-tested with a fake store and transport, and a thin hook (for example `use-task-sync.ts`).
- Behaviour is unchanged. The 7.2/7.3 App render tests pass with no edit.
- The new folder files are covered by the existing `sync/**/*.test.{ts,tsx}` glob. Check it, and do not add a glob that skips them.

## Conflict panel (`apps/mobile/sync/`, rendered in the task detail)

The panel shows when `deriveTaskSyncState(...).conflict` is non-null. It uses `alert-message`, so a toast is never the only channel. It replaces the retry line for that task.

1. **Header:** `conflictTitle`, then `conflictExplanation`.
2. **Local version:** `conflictLocalVersion`, with the local revision and the local save date/time (JJ/MM/AAAA, HH:MM, device time). When `hasPendingSnapshot` is true, `conflictPendingKept` is added. When the local draft is missing or unreadable, `conflictLocalUnavailable` is shown.
3. **Server version at conflict time:** from the stored 409 `detail`, labelled `conflictServerAtConflict` (revision, date, author). `null` values are rendered as `conflictServerNone`.
4. **Current server version:** fetched when the panel opens and on « Réessayer ». It runs only when online and `online-authorized`. Otherwise `fr.auth.offlineUnavailable` / `reauthenticateOnline` is shown and nothing is fetched.
   - While the fetch runs: `conflictLoadingServer`.
   - On failure: `conflictServerUnavailable`, plus a « Réessayer » button (`conflictRetryFetch`).
   - On success: `conflictServerVersion` (revision, state label, date, author).
5. **Differences:** a pure function `diffGraphieValues(local, server)` returns the field IDs whose raw string differs, with a missing value counted as `""`. It runs in catalogue order. The panel lists `section labelFr › field labelFr`, or `conflictNoDifference` when the list is empty. The choice is still required. Values are not shown.
6. **Actions**, enabled only after a successful fetch in this panel, and disabled while an action runs:
   - `conflictKeepLocal`. It is hidden when the server state is `submitted` or the local draft is unavailable. It needs no extra confirmation, because the button is the explicit action. On success, the panel closes, the form becomes editable, the outbox refreshes and `runSync(employeeId)` starts (the « separately authorized sync attempt »).
   - `conflictDiscardLocal` opens a `confirmation-dialog` with `conflictConfirmDiscard` and `conflictConfirmDiscardAction` / cancel. Cancel or dismiss changes nothing. On confirm, the form shows the reloaded values. It is editable for a `draft` server version, and shows « Soumis — accepté par le serveur », read-only, for a `submitted` one.
   - A failure (`ConflictResolutionError`, a storage error or an authorization loss) shows `conflictResolutionFailed`, keeps the panel and changes nothing. A stale panel (the open set changed) refreshes and fetches again.
7. Soumettre, Supprimer and « Réessayer la synchronisation » are not rendered while the task is in conflict. For a draft conflict the form stays editable, and saves show the normal local-save states.

## French strings (`fr.employeeTasks`)

| Key (suggested) | Text |
|---|---|
| `conflictTitle` | Conflit de synchronisation |
| `conflictExplanation` | Versions différentes. Vos données locales sont conservées. Synchronisation suspendue. |
| `conflictLocalVersion` | Version locale : révision {revision}, enregistrée le {date} à {time} |
| `conflictPendingKept` | La soumission demandée est conservée sur cet appareil, en lecture seule. |
| `conflictLocalUnavailable` | La version locale ne peut pas être lue par cette version de l’application. |
| `conflictServerAtConflict` | Version du serveur au moment du conflit : révision {revision}, modifiée le {date} à {time} par {author} |
| `conflictServerVersion` | Version actuelle du serveur : révision {revision} ({state}), modifiée le {date} à {time} par {author} |
| `conflictServerNone` | Aucune version enregistrée sur le serveur |
| `conflictLoadingServer` | Chargement de la version du serveur… |
| `conflictServerUnavailable` | La version du serveur n’a pas pu être chargée. Aucune donnée n’a été modifiée. |
| `conflictRetryFetch` | Réessayer |
| `conflictDifferences` | Champs différents : |
| `conflictNoDifference` | Aucune différence de valeurs détectée. Un choix reste nécessaire. |
| `conflictKeepLocal` | Conserver ma version locale comme nouvelle révision |
| `conflictDiscardLocal` | Abandonner ma version locale et recharger la version du serveur |
| `conflictConfirmDiscard` | Abandonner votre version locale ? Les modifications locales non synchronisées de ce contrôle seront remplacées par la version du serveur sur cet appareil. |
| `conflictConfirmDiscardAction` | Abandonner et recharger |
| `conflictResolutionFailed` | Le conflit n’a pas pu être résolu. Vos données locales sont conservées. |
| `conflictResolutionStale` | La situation a changé. La version du serveur est rechargée. |

The `{state}` value uses the existing labels `draft` (Brouillon) and `submitted` (Soumis — accepté par le serveur). Keys may be renamed. Texts may change only toward EXPERIENCE.md wording. This is UI copy, not a CETEM rule.
