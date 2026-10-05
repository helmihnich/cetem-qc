# Test plan

All tests use `node:test`. API tests run through `withPostgresTestSchema` against the local Docker PostgreSQL, with zero skipped tests. Mobile tests use the SQLite test double (`node:sqlite`), fake transports, fake `fetch` and the App render double. Names are synthetic (« Employé Test », « Établissement A »).

## Contracts — `packages/schemas`, `packages/api-client` (CAP-5)

- K1: `SyncOperationRequest` accepts an optional UUID `conflictOperationId`, and rejects a non-UUID value or `null`. `EmployeeTaskAuditVersion` parses the no-audit body (`0`, `draft`, `null`, `null`, `null`) and a full body. It rejects extra keys.
- K2: `getEmployeeTaskAuditVersion` returns the body on 200. It throws `ApiRequestError` on 401, 403, 404, 500 and an invalid body. It sends the bearer token and the route.
- `pnpm contracts:check` passes with the regenerated types.

## API PostgreSQL — `apps/api/src/conflict-routes.postgres.test.ts` (CAP-5)

| ID | Scenario | Expected |
|---|---|---|
| S1 | Assigned Employé, no audit | 200 `{ revision: 0, state: "draft", lastChangedAt: null, lastChangedBy: null, payload: null }` |
| S2 | After draft-syncs to revision 2 | 200, revision 2, the revision-2 payload byte-equal, author and date equal to the `audits` row |
| S3 | After an accepted submission | 200, `state: "submitted"`, the submission payload |
| S4 | No session / Responsable / another employee's task / unknown / non-UUID | 401 / 403 / 404 / 404 / 404; no task data; row counts unchanged |
| L1 | Base 0 → 409 conflict C (server at 1). Then `sync-draft` base 1 with `conflictOperationId = C` | 200, revision 2, exactly one `audit_lineage_links` row (`sync-conflict-revision`, revision 2, predecessor C, actor) |
| L2 | Replay of L1 | stored body byte-equal; still one lineage row |
| L3 | Reference unknown; reference to an accepted outcome; to another actor's conflict; to a conflict on another task; reference already linked | 422 `rejected` `INVALID_CONFLICT_REFERENCE` (stored, path `conflictOperationId`); no revision or lineage row |
| L4 | Valid reference but stale base | 409 conflict; no lineage row; the reference stays usable |
| L5 | Valid reference on a submitted audit | 422 `AUDIT_ALREADY_SUBMITTED`; no lineage row |
| L6 | Fingerprint: a request without the field gives the same fingerprint as the 7.3 function did. An outcome stored before the change replays byte-equal | equal |
| L7 | Failure injected after the lineage insert (existing audits test seam) | 500; zero new rows in revisions, lineage and outcomes |
| L8 | `UPDATE` / `DELETE` / `TRUNCATE` on `audit_lineage_links` | raises; migration 0010 → 0011 keeps every row |

The existing tests A1–A16, F1–F6, D1–D5, Q1–Q3 and M1 pass unchanged.

## Mobile — store `apps/mobile/local-drafts/outbox.test.ts` / new `conflict.test.ts` (CAP-1, CAP-3, CAP-4)

- O1: The v3 → v4 upgrade keeps every row of the five existing tables. A database above v4 is refused.
- O2: While a draft conflict is open, `save` writes the draft and creates no item. `requestSubmission`, `delete` and `deleteUnreadable` throw `OpenConflictError`, and nothing changes.
- O3: Keep-local on a draft conflict produces one resolution, a `conflict` item row, the withdrawn never-attempted items deleted with their snapshots still readable, a new `sync-draft` item (base = server revision, `conflictOperationId` = newest open conflict), and `task_sync_state` = server revision. A failure injected before commit leaves everything unchanged.
- O4: Keep-local on a submit conflict, and on a sync-draft conflict with a queued `submit` behind it: the submit snapshot stays readable, no `submit` item stays unresolved, and the new item is a `sync-draft`.
- O5: Discard with a payload: the local draft is the server payload at `revision + 1`. Discard with a `null` payload: the row is deleted. Discard with a `submitted` server state: resolution `server_state = submitted`. An unreadable payload: refused, nothing changes.
- O6: Refusals: stale `conflictOperationIds`; an attempted unresolved item; keep-local with server `submitted`; keep-local with a missing or unreadable draft. Each throws `ConflictResolutionError`, and nothing changes.
- O7: A save after keep-local supersedes the never-attempted item and keeps `conflictOperationId`. So does `requestSubmission`.
- O8: Employee B's rows are never read, resolved or withdrawn by A's calls.

## Mobile — engine and derivation (CAP-1)

- E4: Task A gets a `conflict`. The next item of A is not sent in this run, B's items are sent, and a later run, with or without `retryBlocked`, sends nothing for A.
- E5: After keep-local, the next run sends the new item with `conflictOperationId`. The adapter includes the field only when it is set (adapter test T4).
- D2: `deriveTaskSyncState` covers each row of the derivation table in [conflict-model.md](conflict-model.md), including closed conflicts being ignored, `discard-local` → `draft-synchronized`, and `discard-local` with `submitted` → `submitted`/locked.
- All existing engine, adapter and `task-sync-state` tests pass unchanged.

## Mobile — controller (CAP-6)

- W1: The controller runs on each trigger (online authorization, reconnect, foreground, changed save), runs exactly one follow-up run, does no run offline or when not `online-authorized`, and keeps the previous state when a refresh fails. These are the R15/R17 behaviours, now tested without React.

## Mobile — App render `apps/mobile/App.render.test.tsx` (CAP-2, CAP-3, CAP-4)

- R18: Draft conflict. The panel shows the local revision and date, the 409 metadata and the fetched server version, and lists the differing field labels. Soumettre, Supprimer and the retry button are absent, and the form is editable.
- R19: Submit conflict. The form is read-only and `conflictPendingKept` is shown.
- R20: Offline, or a fetch failure. `conflictServerUnavailable` (or the offline message) and « Réessayer » are shown, both actions are disabled, and nothing is fetched while offline. A retry that succeeds enables the actions.
- R21: Keep-local. The form becomes editable, Soumettre returns, the fake transport receives a `sync-draft` with base = the server revision and `conflictOperationId`, and no submit is sent.
- R22: Discard. Cancel leaves everything unchanged. Confirm shows the server values, and the state is « Brouillon synchronisé — non soumis ».
- R23: Server state `submitted`. Keep-local is absent. After discard, the task shows « Soumis — accepté par le serveur » and is read-only.
- R24: A resolution failure shows `conflictResolutionFailed`, keeps the panel, and leaves the local draft and outbox unchanged.
- The existing 7.2 row « sync-draft resolved conflict → Brouillon + Conflit de synchronisation » still passes. The 7.2 « submit resolved conflict → locked » row still passes.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.
