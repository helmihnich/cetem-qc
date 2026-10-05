---
id: SPEC-7-4-freeze-accepted-measurements-and-comments
story: 7.4
status: done
approved: 2026-10-05
baseline_commit: 5b38b1e
companions:
  - freeze-model.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-7-3-accept-submissions-transactionally-and-idempotently/server-command.md
  - ../spec-7-3-accept-submissions-transactionally-and-idempotently/data-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
  - _bmad-output/implementation-artifacts/deferred-work.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 7.4 — Freeze accepted measurements and comments

## Why

**Pain.** Story 7.3 records an accepted submission, and its history tables are insert-only. But the `audits` row that marks the audit `submitted` can still be updated or deleted in SQL. Nothing proves that every API path, for both roles, leaves accepted evidence untouched. No query returns the accepted snapshot for review either.

**Story statement.** As a Responsable, I want server-accepted evidence to remain immutable, so that later review and reporting refer to the actual submitted snapshot.

**Traceability.** FR-023, FR-024, DR-001, DR-005, SEC-008, AD-3, AD-4, AD-6; the 7.3 hand-off (delivery-notes.md). Depends on 7.3 (done).

## Capabilities

The table list, migration and query signatures are in [freeze-model.md](freeze-model.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Database freeze
  - **intent:** Once an audit is submitted, no SQL path can change or remove its accepted evidence.
  - **success:** On a submitted audit, `UPDATE` and `DELETE` of its `audits` row are refused. `TRUNCATE` of the four evidence tables is refused. Deleting the linked task is refused. A draft audit still accepts draft-syncs and its submission (D1–D4, M1).
- **CAP-2** — API refusal for both roles
  - **intent:** Neither the Employé nor a Responsable can mutate accepted measurements or comments through the API.
  - **success:** The assigned Employé gets 422 `AUDIT_ALREADY_SUBMITTED` on both sync routes, whatever the base revision or payload. A Responsable (own or other team) gets 403. An unassigned Employé gets 404. Every other mutating route leaves the evidence fingerprint byte-equal. A route inventory test fails when a new mutating route appears (F1–F6).
- **CAP-3** — Accepted snapshot available to authorized review
  - **intent:** The accepted snapshot stays readable, exactly as accepted, by the Responsable who owns the task's team.
  - **success:** `getAcceptedSubmissionForReview` returns the original payload (measurements and comments), results, schema/rule identity, submitting actor, server date and task ID, byte-equal after every refused attempt. It returns `undefined` for another team, an unknown or invalid task, or no accepted submission (Q1–Q3).
- **CAP-4** — No in-place correction or replacement
  - **intent:** Any later correction or replacement is a distinct record, never an edit of the accepted audit.
  - **success:** A second audit for the task and a second submission for the audit are refused (D5). The submitted `audits` row cannot be re-pointed (D1). The 8.3 hand-off requires a new task, a new audit and a typed lineage record.

## Constraints

- No CETEM business rule is invented. Story 7.4 adds no validation, tolerance or verdict.
- The freeze lives in the database (triggers with `restrict_violation`), not only in command order. Trigger messages contain no payload values.
- No OpenAPI, schema, api-client, domain, i18n, mobile or web change. `AUDIT_ALREADY_SUBMITTED` keeps its 7.3 wording.
- Module ownership follows AD-3 and `boundaries:check`: `audits` owns the migration and the review query. `tasks` owns `getOwnTeamTaskId`. They talk to each other only through `queries/`.
- The 7.3 behaviour and tests A1–A16 stay unchanged. No test is deleted, skipped or weakened, and no gate script is edited. Tests use synthetic names and the local PostgreSQL harness.

## Non-goals

- A Responsable HTTP route, web view or access log for accepted evidence, and the task-list `state` change (Story 9.1).
- The lineage table and the replacement command (8.3), correction drafts (8.2), conflict resolution (8.1), and freezing assignments or reassignment rules (8.4).
- Freezing task metadata updates (only task deletion is refused).
- Mobile changes. The device already locks a task whose submission was accepted (7.2 `locked`).
- Deploying anything.

## Success signal

PostgreSQL tests F1–F6, D1–D5, Q1–Q3 and M1 pass. They show refused mutations for both roles and direct SQL, a byte-equal evidence fingerprint after every refused attempt, the accepted snapshot returned intact to the own-team Responsable only, and the draft path still working. `pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, AD-3/4/6/8, FR-024, DR-005, the 7.3 spec, its hand-offs and the current code. None is a CETEM business rule.

- **Comments are payload fields.** The catalogue comment areas (`voltage.accuracy.comments` … `comments.general`) live in `payload.values`. Freezing the submission revision freezes them. There is no separate comment store.
- **Freeze scope.** Story 7.3 left `audits` updatable. After submission it is frozen, and it is never deleted. A draft audit stays updatable, so `advanceAudit` is untouched.
- **TRUNCATE is refused** on the four evidence tables. Row triggers do not cover it. The test harness drops per-test schemas and never truncates.
- **Task row.** Deletion is already refused by the `audits.task_id` foreign key, and a test pins this. Task metadata updates are not frozen: they are not measurements or comments, and 9.1 changes the task `state` projection.
- **Assignments are not frozen.** `submitted_by` is stored independently of the assignment. 8.4 owns reassignment (deferred-work: assignment under lock).
- **Review is a query, not a route.** Story 7.3 placed the read endpoint, the view and the access logging in 9.1 (9.1 AC: « review access is logged »). Story 7.4 provides the authorized query that 9.1 calls, scoped by the same predicate as the Responsable task list.
- **No lineage table in 7.4.** AD-4 creates `replacement-control` links inside `CreateReplacementControl` (8.3). A correction (8.2) follows a rejection, so its audit is never submitted. A conflict revision never reaches a submitted audit, because the submitted check comes before the revision check.
- **A replay is not a mutation.** A replayed stored outcome, including the original 200, returns the stored body and writes nothing.
- **Route inventory guard.** The fixed list of mutating routes makes any future route that might touch audits fail a test until its freeze behaviour is covered.

## Open Questions

None. No deferred-work entry targets 7.4. The 6.4 identity/results entry was resolved on the server side by 7.3, and its view-level check stays with 9.1.

## Code review (2026-10-05)

Four layers ran: blind, edge-case, verification-gap and acceptance. No finding needs a business decision. The production code (migration 0010 and the two queries) is unchanged; every patch strengthens a test.

**Patched**
- D3 used `TRUNCATE … CASCADE` and matched only `/cannot be truncated/`. A cascaded child table's trigger then satisfied the assertion, so removing the `audits` or `audit_revisions` truncate trigger went undetected. D3 now checks the exact message naming each evidence table and the `23001` code.
- In F5, most calls ended in a refusal (403 or 401), so the unchanged fingerprint did not show that a real write left the evidence alone. F5 now requires the Responsable's task creation, employee creation, credential (for the newly created Employé), password reset, status change and both logouts to succeed.
- No test reused the accepted submission's idempotency key with changed measurements and comment. F2 now checks it gets 422 `IDEMPOTENCY_KEY_REUSED` and leaves the fingerprint unchanged.
- Q1 re-read the snapshot after only some of the refused attempts. It now runs both bases × both routes × all five actors, the replay, the key reuse, task creation, and the D1/D3 statements first (test-plan « after F1–F5 ran »).

**Deferred** (see deferred-work.md): the triggers hold only against a role that cannot alter them. Separating a table-owner role from the runtime role is a deployment decision (Story 12.x).

**Rejected**
- Nothing refuses `INSERT INTO audit_revisions` for a submitted audit: the accepted snapshot is addressed by `audit_submissions.revision`, which is insert-only. `current_revision` is frozen, so an appended row changes neither the accepted evidence nor the current-state pointer. The spec's freeze scope does not list revision inserts.
- The freeze is keyed on `audits.state` rather than on whether an `audit_submissions` row exists. Also rejected: a draft audit set to `submitted` without a submission, and a draft audit's `task_id` re-pointed. Each needs forged direct SQL; the 7.3 command writes the submission and `state` together in one transaction under the task lock. A draft audit stays updatable by design.
- The authorization and the read are two queries: the only change between them would be a reassignment, which no flow does yet (8.4), and the window is one call. Story 9.1 wraps the query in its route.
- `payload`/`results` are typed without runtime validation: they are the server's own validated and computed values, stored insert-only by 7.3.
- The snapshot query does not filter `revision.kind = 'submission'`: the 7.3 command writes the submission row only for its submission revision, and the CHECK makes `results` non-null for that kind.
- F6 ignores mount prefixes and relies on Express internals: any new mutating route adds an entry, so the sorted lists differ and the test fails. The API pins Express 5.2.1.
- M1 does not re-check the truncate triggers after the upgrade: it applies the same migration file that D3 exercises.
- The fixture accepts a `migrateThrough` earlier than 0004, and `send` assumes a JSON body: test-only helpers. A wrong use fails loudly, and the `send` code moved unchanged from 7.3.
