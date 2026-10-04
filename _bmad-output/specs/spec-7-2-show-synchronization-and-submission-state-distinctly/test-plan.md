# Test plan

All tests use `node:test`, the existing App render double (`App.render.test.tsx` outbox globals) or the SQLite test double, and fake transports. Synthetic task names only.

## Unit — `apps/mobile/sync/task-sync-state.test.ts` (CAP-1, CAP-5)

- S1: Every row of both tables in [state-model.md](state-model.md) returns the expected `lifecycle`, `transfer`, `locked` and `canRetry`.
- S2: Several `submit` items exist (an older resolved one and a newer unresolved one). The newest by `sequence` decides. The order of the input array does not matter.
- S3: A draft has an attempted unresolved `sync-draft` item and a newer queued one. The transfer state comes from the lowest `sequence`.
- S4: A pending submit coexists with a resolved `accepted` `sync-draft`. The result is still `submission-pending`, never `draft-synchronized` or `submitted`.

## App render — `apps/mobile/App.render.test.tsx` (CAP-1 to CAP-6)

- R1: Seed outbox rows for each lifecycle and open the task. Each lifecycle label, transfer label and the four separate lines render. The text « Dernier état serveur : synchronisé » never renders.
- R2: Open a draft offline, tap Soumettre and cancel. Nothing is written. Tap Soumettre and confirm. Exactly one `submit` row exists, and the state is « Soumission en attente de synchronisation ». Fields are not editable, Enregistrer and Supprimer do nothing or are hidden, and Soumettre is hidden. Unmount and remount the App (restart), reopen the task: it is still pending and read-only.
- R3: A double tap on confirm, or two quick confirmations, creates one `submit` row.
- R4: Mock `./sync/app-sync-transport` with a fake transport that returns `retryable` five times. After the submission run, the alert « Échec du transfert… » and « Réessayer la synchronisation » are shown, and the snapshot row is unchanged. Switch the fake to `accepted` and press retry. The same `idempotencyKey` is sent, and the state becomes « Soumis — accepté par le serveur », read-only.
- R5: A fake transport returns `{ ok: true }` and then throws. The task stays « Soumission en attente de synchronisation ». Online connectivity alone does not change it.
- R6: Retry while offline or while not `online-authorized`: no `send` call, and the French message is shown.
- R7: With the real module (transport `null`), confirming Soumettre starts no run and the item stays `queued` (« En attente de synchronisation — conservé sur cet appareil »).
- R8: The task list shows the derived lifecycle label per row for a pending, an accepted and a plain draft task.
- R9: A `legacy content` draft: Soumettre shows « Ce brouillon ne peut pas être soumis depuis cet appareil. », and no row is written.
- R10: Autosave after the lock: a field change attempted through the handler while locked writes no `local_drafts` revision and no outbox row, and shows no save-failure alert.

## Regression

- Every existing mobile, local-drafts, outbox and sync-engine test passes unchanged.
- `pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.
