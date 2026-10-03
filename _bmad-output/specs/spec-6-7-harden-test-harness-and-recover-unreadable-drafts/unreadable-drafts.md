# Unreadable local drafts (CAP-4, CAP-5)

## When the action is offered

A draft is *unreadable* when opening its task fails with `LocalDraftPayloadCompatibilityError` (envelope or tuple refused by `parseLocalDraft`) or `GraphiePayloadCompatibilityError` (refused by `parseGraphiePayload`). This covers catalogue `1.0.0` / schema `2` drafts and `2.0.0` / `3` drafts with rule `cetem-workbook-explicit-formulas` / `1.0.0`.

Both open paths in `apps/mobile/App.tsx` qualify: online `openTask` (shows `draftNotice`) and cached offline open (shows the same text via `error`). Show the action next to the compatibility message in both. Other failures (corrupt JSON, storage unavailable) keep `draftStorageUnavailable` and no delete action.

## Flow

| Step | UI (French, existing `fr.employeeTasks` keys) | Storage |
|---|---|---|
| Notice | `draftCompatibilityUnavailable` + button `deleteDraft` « Supprimer le brouillon local » | untouched |
| Press | `confirmDeleteDraft` « Supprimer ce brouillon local ? Cette action est définitive. » + `fr.common.cancel` / `fr.common.confirm` | untouched |
| Cancel | back to notice | bytes unchanged |
| Confirm, success | `draftDeleted` « Brouillon local supprimé. »; hydration `ready`; form = `createNewGraphieDraftValues()`; Save enabled; no `activeDraft` | row for (employee, task) deleted |
| Confirm, failure | `draftDeleteFailed`; hydration stays `failed`; notice and action remain | bytes unchanged |
| Authorization lost while pending | existing `redactDraftIfAuthorizationLost` behaviour | row kept |

The confirmation captures employee and task. It is dropped if the user, screen or task changes before confirming (same rule as `confirmDraftDelete`).

## Storage operation

- New method on `DraftDatabase`, `DraftRepository` and `createAuthorizedDrafts`, e.g. `deleteUnreadable(employeeId, taskId)`.
- SQLite: `DELETE FROM local_drafts WHERE employee_id = ? AND task_id = ?` in an exclusive transaction. No `SELECT`/parse, no revision check. Zero rows deleted counts as success (the row is already gone).
- Repository: runs in the same per-scope `serialize` queue as `save`/`delete`. Authorized wrapper: same `authorize(employeeId, …)` as `delete`, so it works offline only while offline access is authorized.
- Never touches `synchronized_tasks` or other employees' and tasks' rows.

## Reset after any explicit delete (CAP-5)

On success of either `confirmDraftDelete` or the unreadable delete, while the scope is still active, set `formValues`/`formValuesRef` to `createNewGraphieDraftValues()`, `legacyContentMode`/ref to `false` and `draftContent`/ref to `""`. This closes deferred-work entry « After an explicit draft delete, the form keeps the deleted draft's values ».
