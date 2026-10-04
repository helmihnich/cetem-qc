---
id: SPEC-7-1-queue-durable-synchronization-operations
story: 7.1
status: done
approved: 2026-10-04
baseline_commit: 9b900e3
companions:
  - outbox-model.md
  - sync-engine.md
  - test-plan.md
  - delivery-notes.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 7.1 — Queue durable synchronization operations

## Why

**Pain.** The mobile app saves drafts only to the local `local_drafts` table. Nothing records that a draft still has to reach the server, or that the Employé asked to submit it. Without a durable record, a reconnect or retry can lose work or send it twice, and the later sync stories (7.2, 7.3, 8.x) have nothing to build on.

**Story statement.** As an Employé, I want local changes and requested operations preserved in a durable outbox, so that reconnecting or retrying cannot lose or duplicate my work.

**Traceability.** FR-019, FR-021, FR-042, NFR-001, NFR-002, SEC-007, AD-4, AD-5.

## Capabilities

Tables, states and transitions are in [outbox-model.md](outbox-model.md). The engine, outcomes and retry bound are in [sync-engine.md](sync-engine.md).

- **CAP-1** — Atomic draft-sync operation
  - **intent:** Each local draft save also records that this draft version must reach the server.
  - **success:** One SQLite exclusive transaction writes the draft row, an insert-only snapshot of the saved `LocalDraft` and a `sync-draft` outbox item. The item has an operation ID, an idempotency key and a base revision. If any write fails, none is committed and the previous draft, snapshot and items are unchanged. Save keeps its current revision guard and return value.
- **CAP-2** — Atomic submission request
  - **intent:** An explicit submission request is recorded as an immutable snapshot plus a `submit` operation.
  - **success:** `requestSubmission(employeeId, taskId, payload, expectedRevision)` saves the payload and writes the submission snapshot and the `submit` item in one transaction. While that item is unresolved, `save`, `delete` and `deleteUnreadable` for the task are refused and change nothing. A second request for the same task while one is unresolved is refused.
- **CAP-3** — Outbox lifecycle until a definitive outcome
  - **intent:** An item stays in the outbox until a definitive server outcome is stored on the device.
  - **success:** Only `accepted`, `rejected` or `conflict` resolves an item. The outcome is written in the same transaction that resolves it. Retryable and blocking results leave it unresolved, with the attempt recorded. Resolved items and their snapshots are kept; 7.1 deletes no resolved item.
- **CAP-4** — Bounded, retry-safe sync engine
  - **intent:** Unresolved items can be sent and retried without duplication, through a transport port.
  - **success:** The engine sends only the authenticated employee's items, one task at a time in creation order, with the same operation ID and idempotency key on every attempt. Attempts are bounded per run, then the item is `retry-paused` until a new trigger. Correctness never depends on background execution. All of this is proven with a fake transport.
- **CAP-5** — Preservation across restart, logout, expiry, upgrade and transient failure
  - **intent:** No ordinary event silently deletes an unresolved item or its snapshot.
  - **success:** After a simulated restart (new repository over the same database), logout, offline-authorization expiry, transport failure or the v2→v3 schema upgrade, every unresolved item and its snapshot are still there and byte-identical. Existing `local_drafts` and `synchronized_tasks` rows survive the upgrade.

## Constraints

- Mobile only. No change to `apps/api`, the OpenAPI contract, `packages/schemas`, the catalogue, rule identity or domain calculations.
- Every outbox write runs in one exclusive transaction on the existing SQLCipher database, behind the per-scope queue. Snapshot rows are never updated.
- Every row is scoped by `employee_id`. Another user signing in on the same device neither sees nor sends nor deletes someone else's items.
- Data-access methods go through the offline authorization wrapper (`createAuthorizedDrafts`), like the draft methods.
- Item IDs and keys come from the injected `createId` (`Crypto.randomUUID` in the app), so tests stay deterministic.
- The UI does not change in 7.1. All text visible to users stays in French.
- Never delete, skip or weaken a test; never edit the gate scripts.

## Non-goals

- The Soumettre button, pending read-only form and French sync states (Story 7.2).
- The HTTP transport, server endpoints, server idempotency store and acceptance transaction (Story 7.3).
- Conflict resolution (8.1), correction drafts after rejection (8.2), and deactivation handling (8.4).
- Client-side submission validation rules (DEP-01/02; the server validates in 7.3).
- Removing resolved items, or deleting the local draft after acceptance.
- OS background tasks (expo-background-fetch and the like).

## Success signal

Mobile tests show four things with a fake transport and the SQLite test double: a save and its outbox item commit together or not at all; a submission request blocks later saves and deletes; a retry after a lost response reuses the same idempotency key and records exactly one outcome; unresolved items survive restart, logout, expiry and the v2→v3 upgrade. `pnpm -r test`, `pnpm -r typecheck`, `boundaries:check`, `contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, AD-4/AD-5, the existing code and the Product Owner decisions in the pipeline rules. None is a CETEM business rule.

- **Scope split.** 7.1 delivers the store, repository API and engine with a transport port. The first story that renders sync state (7.2) or provides the server command (7.3) wires the transport and App triggers.
- **Base revision.** This is the last server revision of the task's audit known to this device, `0` if none. It is stored per employee and task. When an item is accepted, later unresolved items of the same task with the same base move to the returned revision in the same transaction, because that change is the device's own.
- **Supersession.** A save replaces an unresolved `sync-draft` item of the same task only if it was never attempted. The new snapshot contains everything the old one did, so nothing is lost. Attempted items and `submit` items are never replaced. `requestSubmission` supersedes never-attempted `sync-draft` items in the same way.
- **Explicit delete.** `delete` and `deleteUnreadable` are refused while a `submit` item is unresolved. Otherwise, in the same transaction, they also remove the task's unresolved `sync-draft` items and their snapshots. This is the Employé's confirmed discard (FR-019), not a silent deletion.
- **Outcome classes and retry bound** are given in [sync-engine.md](sync-engine.md): 5 attempts per run, waits of 1, 2, 4 and 8 s, and 401/403 treated as blocking.
- **Operation ID and idempotency key** are two distinct UUIDs, saved when the item is created and never regenerated.
- **Snapshot content** is the saved `LocalDraft` envelope (values and catalogue/schema/rule identity), with no calculated results. The server recalculates (epic-6 retro action item 15).
- **Local submission refusal** applies only to legacy-content drafts and drafts that `parseLocalDraft` rejects. No validation rule is invented.

## Open Questions

None blocking. The server draft-sync command has no owning story yet. It is handed off in [delivery-notes.md](delivery-notes.md).

## Review Findings

Code review, 2026-10-04 (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor).

- [x] [Review][Patch] `run()` for another employee during an active run returned the first employee's run and sent none of the second employee's items [apps/mobile/sync/sync-engine.ts] — fixed: the active run is keyed by employee; another employee's run starts after it.
- [x] [Review][Patch] A missing snapshot row (or one joined to another employee) made the engine reload the same item forever, so the run never settled and every later `run()` hung [apps/mobile/sync/sync-engine.ts] — fixed: any snapshot read failure records `snapshot-unreadable`; only a missing item is `gone`.
- [x] [Review][Patch] An explicit delete during a send made the post-send transition throw `OutboxOperationNotFoundError` and rejected the whole run [apps/mobile/sync/sync-engine.ts] — fixed: every transition treats a missing item as `gone` and the run continues.
- [x] [Review][Patch] Authorization was checked only at the start of a run, so a logout or lock during up to 15 s of retries did not stop sends [apps/mobile/sync/sync-engine.ts] — fixed: checked before every attempt.
- [x] [Review][Patch] No test for the unreadable-snapshot path, the `gone` path, two employees' runs, a lock during a run, or `lastOutcome` with several outcomes [apps/mobile/sync/sync-engine.test.ts] — fixed: six engine tests added.
- [x] [Review][Patch] `requestSubmission` stores a payload that `parseLocalDraft` rejects (wrong catalogue/rule identity, non-string values); the `submit` item then blocks as `snapshot-unreadable` on every run and locks save/delete for the task [apps/mobile/local-drafts/model.ts:259] — fixed (approved by the Product Owner): a changed draft is validated with `parseLocalDraft` before queueing and refused with `SubmissionNotAllowedError`; new O9 test covers wrong rule version, non-string values and wrong catalogue on a new task, with nothing written.
- [x] [Review][Patch] The snapshot read joins `audit_snapshots` to the operation by snapshot and employee only, not by task [apps/mobile/local-drafts/sqlite-draft-database.ts:171] — fixed (approved by the Product Owner): the JOIN filter also requires `audit_snapshots.task_id = outbox_operations.task_id`; new O11 test proves a snapshot row of another task is never returned.
- [x] [Review][Defer] A blocking `TASK_NOT_ASSIGNED` on one task stops the whole run on every trigger, so other tasks never sync [apps/mobile/sync/sync-engine.ts:19] — deferred: sync-engine.md makes every blocking result stop the run; per-task handling belongs to 7.3 (HTTP mapping) / 8.4 (deactivation, unassignment).
- [x] [Review][Defer] After a `conflict` outcome, later unresolved items of the task keep the stale base revision and will conflict too [apps/mobile/local-drafts/sqlite-draft-database.ts:199] — deferred: conflict resolution is Story 8.1 (non-goal here).

### Rejected

- Transient snapshot-read errors labelled `snapshot-unreadable` — low: `blocked` items are retried by the next run, and a lock error also fails the transition, so the run rejects without mislabelling.
- No enforced from→to transition rules in `recordOutboxTransition` — low: the engine is the only caller and always records attempt-start first.
- Resolved items and snapshots are never cleaned up — spec non-goal ("Removing resolved items").
- Redundant `assertNoPendingSubmission` read in the repository — low: one indexed read per save; the double check is deliberate defence.
- `requestSubmission` duplicates `readForWrite` checks — low: no named divergence today.
- Schema check ignores trigger/index, `sequence` not UNIQUE, `resolved_at` not required, FK pragma off — low: the adapter is the only writer and keeps these invariants.
- Unguarded `JSON.parse(outcome_json)` / non-serialisable `detail` — low: `outcome_json` is only written by the adapter's own `JSON.stringify`; 7.3's HTTP adapter yields JSON-parsed details.
- Test double needs `node:sqlite` and is excluded from `tsc` — false: the gates run on the repo's Node and all mobile tests pass; exclusion matches the existing test-file policy.
- Migration test count changed from 2 to 3 — false: the extra statement is the v3 step; the version rollback assertion still holds.
- App render double fidelity (MAX(sequence), null `task_sync_state`) — low: P3 only proves a save creates one item; outbox behaviour is covered against the real SQLite double.
- Accepted revision lower than stored revision moves `task_sync_state` backwards — low: one item per task is in flight, so it needs a server bug.
- Per-scope queue not used by `recordOutboxTransition` — low: the adapter serializes every write globally inside an exclusive transaction, which is stronger.
- `sequence` numbers can be reused after supersession — low: FIFO order among existing rows is preserved.
- `OutboxOperationNotFoundError` message says "already resolved" while resolved snapshots are still readable — low, cosmetic.
- Fake `DraftDatabase` in local-drafts.test.ts lacks `getTaskSyncStatus` — false: that method lives on the repository, not on `DraftDatabase`.
