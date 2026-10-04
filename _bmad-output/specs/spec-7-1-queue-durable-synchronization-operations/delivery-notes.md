# Delivery notes and hand-offs

## Files expected to change

- `apps/mobile/local-drafts/sqlite-draft-schema.ts`: v3 migration.
- `apps/mobile/local-drafts/model.ts` and `sqlite-draft-database.ts`: outbox writes and reads, `requestSubmission`, and the guards.
- `apps/mobile/local-drafts/authorized-drafts.ts`: wraps the new methods.
- `apps/mobile/sync/*`: the engine and transport port (new).
- Tests next to each file. `App.tsx` changes only if saving needs the new return value. Its behaviour stays the same.

## Hand-offs

- **Story 7.2.** Add the Soumettre action (with confirmation), calling `requestSubmission`. Make the form read-only while `hasPendingSubmission` is true. Render the distinct French states with `listOutbox` / `getTaskSyncStatus`. Add the explicit retry trigger.
- **Story 7.3.** Build the HTTP `SyncTransport` adapter and the server command. Persist server idempotency outcomes, check the base revision, and recalculate through `calculateGraphieResults` (retro item 15). Wire the App triggers (start, reconnect, foreground, after save).
- **Unassigned: server draft-sync command.** FR-021 and AD-5 require saved drafts to synchronize, but no story in `epics.md` owns the server endpoint for `sync-draft` operations. Until one exists, `sync-draft` items stay `queued` on the device, which is correct and loses nothing. The 7.3 author or the Product Owner should place it in 7.3 or in a new story.
- **Story 8.1/8.2.** Resolved `conflict` and `rejected` outcomes keep their metadata and snapshot for the recovery flows.

## Implementation notes (build, 2026-10-04)

- **Code.** `local-drafts/model.ts` (outbox types, typed errors, `requestSubmission`, outbox reads and transitions, pending-submission guard), `sqlite-draft-database.ts` (all outbox writes inside the existing exclusive transactions), `sqlite-draft-schema.ts` (v3 tables plus a `BEFORE UPDATE` trigger that makes `audit_snapshots` insert-only), `authorized-drafts.ts` (wraps the five new methods), `sync/sync-engine.ts` (transport port and engine). `App.tsx` is unchanged: every changed save already creates its `sync-draft` item through the repository.
- **Legacy content.** `requestSubmission` refuses a payload with `legacyContent` and the opaque Story 5.3 `{ content }` payload (also legacy content). It refuses a stored draft that `parseLocalDraft` rejects. No other validation exists.
- **Time.** The engine records attempt and outcome times with its injected `now`. The repository's `now` still stamps saves and snapshots.
- **Unreadable snapshot.** If a snapshot cannot be parsed, the engine marks the item `blocked` (`snapshot-unreadable`), keeps the row and moves on to the next task. It does not stop the whole run, because this is a local problem, not an authorization one.
- **Tests.** `test-support/sqlite-test-double.ts` runs a real SQLite engine (`node:sqlite`) behind the expo-sqlite methods. It is test-only and excluded from `tsc` like the test files. The mobile `test` script now also picks up `sync/**/*.test.{ts,tsx}`. The App render double got minimal outbox tables for P3.
- **Existing tests adjusted to the new schema.** The migration test now expects version 3. M4 now asserts that the only `local_drafts` statement is the scoped `DELETE` and that nothing `SELECT`s from `local_drafts`. The old check used a regex with literal backspace characters, so it could never match. The new check is stricter.
