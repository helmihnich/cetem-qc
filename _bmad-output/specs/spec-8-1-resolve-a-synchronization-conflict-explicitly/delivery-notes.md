# Delivery notes

## Suggested order

1. CAP-6 extraction (W1) with the existing render tests green, before any behaviour change.
2. Contracts: OpenAPI, then generated types, zod schemas and the client (K1, K2).
3. API: migration 0011, the current-version query and route, then the lineage check and insert (S1–S4, L1–L8).
4. Mobile store v4, resolutions and supersession inheritance (O1–O8). Then the engine pause, adapter field and derivation (E4, E5, T4, D2).
5. Panel and strings (R18–R24).

## Bookkeeping at build

- In `deferred-work.md`, mark the 7.1 review entry « After a `conflict` outcome, later unresolved items … stale base revision » as resolved by 8.1, naming test E4.
- In `sprint-status.yaml`, mark `epic-7-retro-item-21-extract-the-mobile-sync-wiring-engine-cr` as `done`, with a note naming W1.
- The open deferred entry « no engine test for an explicit run joining an automatic run with a blocked item » (7.3 review) may be closed here if E4 covers it. Otherwise leave it open.

## Build decisions (2026-10-05)

Technical resolutions taken while building; none is a CETEM business rule.

- **R1 draft-conflict row.** The 7.2 R1 row « sync-draft resolved conflict » now expects no Soumettre button (`submittable: false`); its state labels, alert role, retry and editability expectations are unchanged. CAP-1, conflict-ui §7 and R18 hide Soumettre during an open conflict, which the earlier row could not anticipate.
- **Derivation result.** `TaskSyncState` gains `conflict` and `canSubmit` as specified. The 7.2 `expectState` helper now also asserts them (`conflict` null unless a conflict row exists, `canSubmit` = draft without conflict), so the existing rows check strictly more.
- **Schema version tests.** The version-pinned local tests (S1, S2, S4 and the migration statement count) follow the specified v3 → v4 bump; S4 now refuses version 5.
- **`OutboxItem` lineage fields** are optional (`?: string | null`) so existing typed fixtures compile; the store always sets both.
- **Insert-only triggers.** Locally, the two resolution tables refuse `UPDATE` by trigger (like `audit_snapshots`) and no code path deletes them; a `DELETE` trigger is not added so the upgrade issues no `DELETE` statement (S2). On the server, `audit_lineage_links` refuses `UPDATE`, `DELETE` (trigger `audit_lineage_links_history_only`, named so the 7.3 A16 trigger inventory stays unchanged) and `TRUNCATE`.
- **Rejection issue.** `INVALID_CONFLICT_REFERENCE` is stored with the issue `{ path: "conflictOperationId", code: "invalid-reference" }`.
- **Differences list.** A table cell is named `section › ligne — champ`, like its input, because cell labels repeat on every paper row.
- **App render double.** The test double of `App.render.test.tsx` now stores `task_sync_state`, `conflict_operation_id` and the two resolution tables; no existing test body changed except the R1 row above.
- **Open deferral kept.** The 7.3 entry « explicit run joining an automatic run with a blocked item » is not covered by E4 and stays open.

## Code review (2026-10-05)

There were four review layers: Blind Hunter, Edge Case Hunter, Verification Gap and Acceptance Auditor. None of the findings needed a business decision.

**Patched**

- **Keep-local saves a failed edit first.** `resolveConflict` now saves a pending edit (`saving`) or a failed one (`failed`) before keep-local. The kept version is the version on screen. New render test: R26.
- **Real server state on keep-local.** Keep-local passes the fetched server state, no longer a hard-coded `draft`. The store's `server-submitted` refusal is now live code. The repository input type is `FetchedServerVersion["state"]`.
- **No retry of other tasks.** The run after keep-local is automatic (`runSync(employeeId, true)`). It no longer retries blocked items of other tasks without the user asking.
- **Confirmations close on conflict.** A Soumettre or Supprimer confirmation that is open when a conflict is recorded now closes. Before, confirming hit `OpenConflictError`.
- **Missing local draft.** The panel shows `conflictLocalUnavailable` for a missing local draft as well as an unreadable one (conflict-ui §2).
- **No difference list without local values.** The differences block is not shown when no local values can be read (legacy, unreadable or missing). Before, it listed every server field.
- **One rule for Soumettre.** Soumettre now uses `TaskSyncState.canSubmit` instead of a duplicate `!locked && !inConflict` rule.
- **New tests:**
  - stale panel: R25;
  - submit conflict resolved with keep-local in the App: R27, which completes the four App paths of the success signal;
  - unreadable local draft in conflict: R28;
  - `diffGraphieValues` unit tests: X1–X3.

**Deferred** (see `deferred-work.md`)

- A payload the strict schema cannot read after a future catalogue change (unverified today).
- A test for the 30 s read timeout.
- Restart tests for the v4 startup guards.

**Rejected**

- **Only the newest of several open conflicts gets server lineage.** This is specified (conflict-model « Open conflict »; Confirmed decisions « Lineage reference »).
- **`attempted` refusal deadlocks a pre-8.1 task.** This is specified (Confirmed decisions « Withdrawal »). After 8.1 it cannot happen, because the engine stops the task at the conflict. Old local data is not migrated (PO decision).
- **Generic message for non-stale resolution failures.** conflict-ui §6 specifies `conflictResolutionFailed`.
- **The panel does not refetch on reconnect.** conflict-ui §4 specifies fetching on open and on « Réessayer ».
- **`conflictOperationId` accepted on submissions.** server-support specifies that both sync routes accept it.
- **Discarding a server with no audit shows « Brouillon synchronisé ».** It cannot happen: a 409 requires `current_revision` > base ≥ 0, and audits are never deleted. For the same reason the duplicated `conflictServerNone` line and the missing App test for discard with a `null` payload were rejected.
- **The open-conflict check runs twice (outside and inside the transaction).** Only the in-transaction check decides. The outer check is harmless.
- **`hasOpenConflict` cost on every save.** Outbox rows per employee are few. A malformed `outcome_json` would already break `listOutbox` elsewhere.
- **`taskId` case in the audit-version route.** PostgreSQL `uuid` comparison ignores case.
- **Separate outbox and resolution reads in `refreshOutbox`.** Any wrong state is transient, and the next refresh corrects it.
- **Wall-clock ordering of resolutions and items in the derivation.** A backward clock change between a resolution and an outcome is unlikely, and the fix is a different ordering model.
- **Unused `reconnect` trigger member and `_reason`.** Harmless. W1 uses the names.
- **The store accepts a save during a submit conflict.** This follows the conflict-model `save` row. The App keeps the task read-only.
- **Existing tests were edited.** The edits are recorded above under « Build decisions », and none weakens a test.

## Hand-offs

- **Story 8.2.** A rejected keep-local item (for example `INVALID_CONFLICT_REFERENCE`) follows the rejection path, never the conflict path. Extend `audit_lineage_links.link_type` with `rejected-submission-correction` in its own migration. `deriveTaskSyncState` stays the single place to extend. Epic-7 retro item 20 (single validator) stays with 8.2.
- **Story 8.3.** Add `replacement-control` to `audit_lineage_links` (or a task-level link table), and never reuse `sync-conflict-revision`.
- **Story 8.4.** A conflict whose `lastChangedBy` is another account comes from reassignment. 8.1 shows it as is, and recovery rules belong to 8.4.
- **Epics 9 and 11.** History and report projections derive conflict lineage only from `audit_lineage_links` (AD-6).
- **Story 12.5.** Demonstrate the conflict path end to end: keep-local and discard-and-reload, with retry paused until resolved.
