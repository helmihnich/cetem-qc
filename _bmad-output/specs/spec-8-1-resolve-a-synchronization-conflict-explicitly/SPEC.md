---
id: SPEC-8-1-resolve-a-synchronization-conflict-explicitly
story: 8.1
status: done
approved: 2026-10-05
baseline_commit: c737d28
companions:
  - conflict-model.md
  - server-support.md
  - conflict-ui.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-7-1-queue-durable-synchronization-operations/outbox-model.md
  - ../spec-7-1-queue-durable-synchronization-operations/sync-engine.md
  - ../spec-7-2-show-synchronization-and-submission-state-distinctly/state-model.md
  - ../spec-7-3-accept-submissions-transactionally-and-idempotently/server-command.md
  - ../spec-7-3-accept-submissions-transactionally-and-idempotently/mobile-transport.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/EXPERIENCE.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
  - _bmad-output/implementation-artifacts/deferred-work.md
  - _bmad-output/implementation-artifacts/epic-7-retro-2026-10-05.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 8.1 — Resolve a synchronization conflict explicitly

## Why

**Pain.** A stale base revision gets a stored 409 with current-version metadata (7.3), and the device resolves the item as `conflict` (7.1). Nothing comes after that:
- A submit conflict locks the task forever.
- A draft conflict keeps queueing items with the same stale base, and the engine sends them after the conflict, so each one conflicts again (deferred-work, 7.1 review).
- The device cannot read the server version. No lineage record exists.

**Story statement.** As an Employé, I want to compare the current server version with my preserved local version, so that I can resolve a conflict without silent data loss.

**Traceability.** FR-022, UX-DR2 (confirmation-dialog, alert-message), UX-DR5, UX-DR13, AD-3, AD-4, AD-5, AD-6, AD-10, OD-02b (EXPERIENCE.md « Explicit synchronization conflict resolution »). Also: the deferred-work entry « after a conflict, later items keep the stale base », epic-7 retro action item 21, and the 7.2/7.3 hand-offs. Depends on 7.1–7.4 (done).

## Capabilities

The local model, the derivation and the engine change are in [conflict-model.md](conflict-model.md). The endpoint, envelope and lineage are in [server-support.md](server-support.md). The screen and its French copy are in [conflict-ui.md](conflict-ui.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Pause synchronization on conflict
  - **intent:** A conflict stops synchronization and submission for its task until the Employé resolves it.
  - **success:** After a `conflict` outcome is stored, the engine sends no other item of that task in that run or any later run, explicit retry included. Other tasks keep syncing. While the conflict is open:
    - Soumettre, the retry button, `requestSubmission`, `delete` and `deleteUnreadable` are unavailable or refused (`OpenConflictError`), and nothing changes.
    - A save on a draft conflict writes the local draft only and creates no outbox item.
- **CAP-2** — Identify local and server context
  - **intent:** The Employé sees what is in conflict before choosing.
  - **success:** The conflict panel shows the preserved local version: local revision, local save date and time, and whether a pending submission snapshot is kept. It shows the conflict metadata stored with the 409, labelled as known at conflict time. When online and authorized, it fetches the current server version: revision, state, last change date and author. It then lists the form fields whose values differ. If the fetch fails or the device is offline, the panel says so, offers « Réessayer » and shows no invented server data. No resolution action is enabled before a successful fetch.
- **CAP-3** — Keep the local version as a new revision
  - **intent:** The local version can go forward as a new revision without ever overwriting the server version directly.
  - **success:** One exclusive local transaction does five things:
    1. records the resolution;
    2. withdraws the task's unresolved items (their snapshots are kept);
    3. inserts a new `sync-draft` snapshot and item from the local draft, with `baseRevision` = the fetched server revision and `conflictOperationId` = the newest open conflicted operation;
    4. sets `task_sync_state` to that revision;
    5. makes the task an editable draft.

    The next authorized run sends the item. The server accepts it as revision `current + 1` and writes one `sync-conflict-revision` lineage row in the same transaction. No submission is queued. The action is not offered when the server state is `submitted`, or when the local draft is missing or unreadable.
- **CAP-4** — Discard the local version and reload the server version
  - **intent:** After a confirmation, the Employé may replace the local working version with the current server version.
  - **success:** A confirmation explains that the local working version will be lost. Cancelling changes nothing. On confirm, one exclusive local transaction:
    - records the resolution and withdraws unresolved items (snapshots kept);
    - replaces the local draft with the fetched payload as a new local revision, or deletes it when the server has no audit;
    - sets `task_sync_state` to the fetched revision.

    A fetched `submitted` version reloads read-only as « Soumis — accepté par le serveur ». A payload this app version cannot read is refused, and nothing changes.
- **CAP-5** — Server current version and lineage
  - **intent:** The server provides the current version to the assigned Employé and records conflict lineage as typed, immutable history.
  - **success:**
    - `GET /api/v1/employee/tasks/{taskId}/audit-version` returns `{ revision, state, lastChangedAt, lastChangedBy, payload }` to the assigned Employé. It returns 401, 403 or 404 otherwise and writes nothing.
    - The sync envelope accepts an optional `conflictOperationId`. A valid reference on an accepted operation inserts one insert-only `audit_lineage_links` row (`sync-conflict-revision`). An invalid reference gets a stored 422 `INVALID_CONFLICT_REFERENCE`.
    - Replays and fingerprints of existing outcomes are unchanged.
- **CAP-6** — Extract the mobile sync wiring
  - **intent:** The conflict UI is built on a tested sync module instead of growing `App.tsx` (epic-7 retro item 21).
  - **success:** Engine creation, triggers, outbox refresh and run state move out of `App.tsx` into `apps/mobile/sync/`, as a non-React controller with its own tests plus a thin hook. Every existing App render test (7.2 R1–R10, 7.3 R15–R17) passes unchanged.

## Constraints

- No field-level merge, last-write-wins or automatic choice. Dismissing the panel, cancelling, or a failed action leaves the conflict open and every row unchanged (OD-02b step 4).
- A conflict is never labelled or handled as a validation rejection (8.2) or a replacement (8.3). No CETEM business rule, tolerance or validation is invented.
- Every resolution is one exclusive SQLite transaction behind the per-scope queue, through `createAuthorizedDrafts`. Snapshots are never updated or deleted. Every row is scoped by `employee_id`.
- OpenAPI first: the new operation, the envelope field and the rejection code go in `packages/types/openapi/cetem-qc-v1.yaml`. Then come the generated types, the `packages/schemas` zod schemas and a typed client method with behavioural tests.
- AD-3 and `boundaries:check`: `audits` owns the lineage table and the current-version query. `sync` owns outcomes and calls `audits` through `commands/`/`queries/`. The route checks assignment through the public `tasks` query.
- All user-visible text is in French and lives in `packages/i18n`. Server payload values never appear in logs or error bodies.
- Tests use synthetic names, the local PostgreSQL harness (zero skipped) and the SQLite test double. No test is deleted, skipped or weakened, and no gate script is edited.

## Non-goals

- Correction drafts after a validation rejection (8.2), replacement after acceptance (8.3), and deactivation or reassignment recovery (8.4).
- Showing or editing field values side by side. Copying single fields between versions.
- Automatic resolution, multi-device reconciliation or collaborative editing.
- Removing resolved items, conflict snapshots or resolution records.
- Exposing lineage in the Responsable web view or in reports (Epic 9/11 derive it from `audit_lineage_links`).
- Unifying the device and server payload validators (epic-7 retro item 20, owned by 8.2).
- Deploying anything.

## Success signal

PostgreSQL route tests prove the following:
- the current-version endpoint returns the latest revision only to the assigned Employé;
- a keep-local revision with a valid reference is accepted with exactly one lineage row, and every invalid reference gets a stored 422;
- old fingerprints replay unchanged.

Mobile tests on the SQLite double prove the following:
- the engine pauses the task after a conflict, while other tasks continue;
- each resolution commits completely or not at all;
- withdrawn snapshots survive;
- lineage survives supersession.

App render tests walk four paths: draft conflict and submit conflict, each through keep-local and through discard-and-reload, including a fetch failure, a cancelled confirmation and a `submitted` server state. `pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, OD-02b, AD-4 to AD-6, the 7.1–7.4 specs and hand-offs, the current code and the Product Owner rules. None is a CETEM business rule.

- **Open conflict.** A conflict is open when an item is resolved `conflict` and no resolution record covers it. It stops its task in every run. The engine also stops the task right after it records a conflict outcome. This resolves the 7.1 review deferral.
- **Draft conflicts stay editable; pending submissions stay locked.** OD-02b locks only pending submissions, and field work must continue offline. While a draft conflict is open, saves are local only, with no outbox item and so no stale base. A submit conflict, or an unresolved `submit` queued behind a conflicted item, keeps the task read-only.
- **Server version source.** The server version is the latest `audit_revisions` row (7.3 hand-off), read through the new GET. Both actions need a fetch that succeeded in the current panel. The stored 409 metadata alone is never used as the base.
- **Accepted server version.** Keep-local is hidden when the fetched state is `submitted`, because 7.4 refuses every new revision there. Reload shows accepted evidence read-only.
- **Keep-local never re-submits.** It yields an editable draft plus a queued `sync-draft`. The Employé submits again with Soumettre. This is the AC's « separately authorized sync attempt ».
- **Withdrawal.** Unresolved items at resolution time were never attempted, because the pause guarantees it. They leave `outbox_operations` in the resolution transaction. Their snapshots stay, and the resolution records their IDs. This is a third explicit exception to the 7.1 preservation rule, next to explicit delete and supersession. If any unresolved item of the task was attempted, the resolution is refused.
- **Lineage survives supersession.** An item that supersedes a never-attempted item carrying `conflictOperationId` inherits that value.
- **Lineage reference.** The reference points to the newest open conflicted operation. The server requires a stored `conflict` outcome of the same actor and task, not yet linked. The check runs after the base-revision check and before payload validation. A stale keep-local item conflicts again, and the next resolution references that new conflict.
- **Fingerprint.** `conflictOperationId` enters the fingerprint only when present.
- **Comparison.** The panel lists the differing fields by section and field `labelFr`. It shows metadata, not values (non-goal).
- **Retro item 21** is done here as a pure extraction, before the panel is added.

## Open Questions

None blocking. Every resolution above follows from OD-02b, the architecture or the existing code. No CETEM business rule is involved.
