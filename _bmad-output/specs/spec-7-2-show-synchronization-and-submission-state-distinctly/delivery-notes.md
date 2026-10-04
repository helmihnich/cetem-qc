# Delivery notes and hand-offs

## Files expected to change

- `apps/mobile/sync/task-sync-state.ts` and its test (new): the pure state derivation.
- `apps/mobile/sync/app-sync-transport.ts` (new): `createAppSyncTransport()` returns `null` in 7.2.
- `apps/mobile/App.tsx`: engine wiring, outbox refresh, Soumettre and confirmation, lock, retry, and list and detail labels.
- `apps/mobile/App.render.test.tsx`: the R-tests. The outbox double may need to support `listOutbox` reads of resolved rows and the `requestSubmission` statements.
- `packages/i18n/src/fr.ts`: the new strings.
- The mobile `test` script needs no change: `sync/**/*.test.{ts,tsx}` is already included.

## Hand-offs

- **Story 7.3.** Implement `createAppSyncTransport()` as the HTTP adapter, mapping responses to the `SyncResult` union. Add the automatic triggers (app start, reconnect, foreground, after save) next to the 7.2 triggers. Return the server acceptance date and actor so that the Submitted label can show « à [heure] ».
- **Story 8.1 / 8.2.** Unlock `conflict` and `acceptance-blocked` only through the explicit recovery actions. `deriveTaskSyncState` is the single place to extend.
- **Unassigned server draft-sync command** (7.1 deferred-work): until it exists, `sync-draft` items stay « En attente de synchronisation ».

## Implementation notes (build, 2026-10-04)

- **Code.** `sync/task-sync-state.ts` (pure derivation), `sync/app-sync-transport.ts` (returns `null`), `App.tsx` (outbox state, engine, Soumettre with confirmation, lock, retry, list and detail labels), `packages/i18n/src/fr.ts` (new strings; the unused `employeeTasks.synchronizedNotSubmitted` is removed). No change to the 7.1 repository, schema or engine.
- **"online-authorized" check.** `authorization.evaluate()` never returns `online-authorized`: for a valid stored grant it returns `offline-authorized`. Only `establishOnlineAuthorization` and `confirmServerAuthorization` (the server revalidation) produce `online-authorized`, and the App keeps that result in its `authorization` state. So the run precondition is: the device is online, the App's authorization state is `online-authorized` for this employee (the server revalidated this session), and a fresh `evaluate(employeeId)` still returns a valid grant (`offline-authorized`, so not expired, logged out or locked). The engine's `isAuthorized` uses the same check before every attempt. If the check fails while online, retry shows `fr.auth.reauthenticateOnline`. If the device is offline, it shows `fr.auth.offlineUnavailable`.
- **Refresh.** `refreshOutbox` runs inside `refreshLocalDrafts` (sign-in, save, delete, leave), before each task open reads its draft (so the lock is known before the form becomes editable), after a submission request and after every run. A failed read keeps the previous state.
- **Busy state.** While a run is active, an unresolved transfer reads « Synchronisation en cours… ». A draft with nothing unresolved keeps its own label.
- **Fallback panel.** The resume panel shown when no task is presented applies the same lock and shows « État ». Soumettre appears only in the task detail.
- **Tests.** `sync/task-sync-state.test.ts` (S1–S4), `sync/app-sync-transport.test.ts` (the real module returns `null`) and `App.render.test.tsx` « Story 7.2 R1–R10 ». The App render double now handles the engine's outbox `UPDATE` statements. R4 waits about 15 s in real time for the engine's technical retry waits.
