---
title: 'Handle unfinished tasks after employee deactivation'
type: 'feature'
created: '2026-10-05'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '77b6f870e720b4087ccc857e8964a6b4f790ede0'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/specs/spec-8-4-handle-unfinished-tasks-after-employee-deactivation/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-8-4-handle-unfinished-tasks-after-employee-deactivation/recovery-model.md'
  - '{project-root}/_bmad-output/specs/spec-8-4-handle-unfinished-tasks-after-employee-deactivation/web-behavior.md'
  - '{project-root}/_bmad-output/specs/spec-8-4-handle-unfinished-tasks-after-employee-deactivation/mobile-offline.md'
  - '{project-root}/_bmad-output/specs/spec-8-4-handle-unfinished-tasks-after-employee-deactivation/test-plan.md'
  - '{project-root}/_bmad-output/specs/spec-8-4-handle-unfinished-tasks-after-employee-deactivation/delivery-notes.md'
---

<!-- Execution tracking companion. The source specification and companions above remain authoritative and unchanged. -->

<frozen-after-approval reason="authorized implementation intent">

## Intent

**Problem:** Deactivation preserves assigned work but offers no safe state-aware way to continue it. Recovery must preserve historical authorship, immutable evidence, offline boundaries, and the distinct 8.1–8.3 workflows.

**Approach:** Add explicit, own-team Responsable reassignment for eligible unstarted work and new independent recovery work for synchronized draft/correction revisions. Add append-only assignment and recovery provenance history, expose state-aware web controls, and preserve existing mobile identity and outbox protections.

## Boundaries & Constraints

**Always:** No automatic reassignment; source work and authorship remain immutable; copied values retain field-level provenance; only active same-team Employé successors qualify; revalidate authorization and state transactionally; failed actions leave no partial writes; use `deactivated-assignee-recovery`; retain 8.1 conflict, 8.2 correction, and 8.3 replacement ownership.

**Never:** Do not reassign correction drafts in place, transfer local data or pending snapshots, infer success/failure for uncertain submissions, create administrative recovery for pending/uncertain or device-only work, or start Epic 9/mark Story 8.4 done.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unstarted reassignment | Inactive assignee, no server audit, active same-team successor | Current assignment changes once; history records actor, prior/new assignee, reason and time | Stale state or ineligible successor leaves all rows unchanged |
| Synchronized draft recovery | Editable source revision and eligible successor | New task/audit/draft plus typed lineage and per-field copied-from provenance; source unchanged | Duplicate/stale/failed command creates no partial recovery |
| Correction recovery | Synchronized correction revision | Separate new work; preserve rejected-submission-correction and add deactivated-assignee-recovery; do not reuse old operation reference | Never mutate or reassign source correction |
| Accepted/conflict/rejected/pending or device-only state | Existing immutable or locally unknown work | Accepted delegates to 8.3; conflict/rejection stays with 8.1/8.2; pending is Resolution required; local-only is explicitly unknown | No unlock, transfer, cancel, retry, deletion or implied absence |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/tasks.ts`, `queries/own-team-task.ts`, `commands/insert-assigned-task.ts` — own-team list, eligibility, current assignment; retain current operational assignment and add history.
- `apps/api/src/modules/audits/commands/audit-revisions.ts`, `queries/task-audit-lineage.ts`, `commands/create-replacement-control.ts` — immutable revisions and typed 8.1–8.3 lineage patterns; add a separate recovery type.
- `apps/api/src/modules/sync/commands/process-sync-operation.ts`, `apps/api/src/modules/identity-auth/sessions.ts`, `apps/api/src/modules/team-access/employee-credentials.ts` — operation transaction and active-session/deactivation race seams.
- `apps/api/src/db/migrations/0006_tasks.sql`, `0009_audits_and_sync.sql`, `0011_audit_lineage.sql`, `0012_correction_lineage.sql`, `0013_replacement_lineage.sql` — additive schema and immutable-history patterns.
- `packages/types/openapi/cetem-qc-v1.yaml`, `packages/types/src/generated/api-v1.ts`, `packages/schemas/src/api/v1.ts`, `packages/api-client/src/v1.ts` — OpenAPI-first typed contract path.
- `apps/web/src/app/task-list.tsx`, `task-creation.tsx`, `api/tasks/route.ts`, `api/tasks/[taskId]/replacements/route.ts`, `packages/i18n/src/fr.ts` — W2 state display, explicit forms, CSRF-protected proxy, centralized French copy.
- `apps/mobile/offline-authorization-state.ts`, `local-drafts/authorized-drafts.ts`, `local-drafts/sqlite-draft-database.ts`, `sync/task-sync-controller.ts`, `sync/sync-engine.ts` — retain identity-scoped encrypted data and actor-bound pending operations; avoid Responsable recovery UI on mobile.

## Tasks & Acceptance

**Execution:**
- [ ] Add additive migration(s) for append-only assignment history, deactivated recovery lineage, copied-field provenance, restrictive FKs, uniqueness/concurrency constraints, and mutation/truncate guards.
- [ ] Add transaction-safe task reassignment and new-work recovery commands; recheck active Responsable, team, source state, successor eligibility, and sync/deactivation races; expose own-team-only API routes and task state/history reads.
- [ ] Extend OpenAPI, generated types, schemas, typed client, web proxy routes, and French W2 UI with state-specific actions, confirmation, stale/error handling, provenance, and lineage display.
- [ ] Add API/PostgreSQL migration, route, authorization, race, rollback, immutability and 8.1–8.3 regression tests; add web render/proxy tests and mobile authorization/outbox regression where uncovered.
- [ ] Run focused Story 8.4 tests, full API integration suite, web tests, affected mobile tests, workspace typecheck, contracts:check, boundaries:check, and git diff --check.

**Acceptance Criteria:**
- Given employee deactivation, when it completes, then assignments/evidence/outcomes remain unchanged and no task is automatically transferred.
- Given an inactive assignee, when a Responsable views own-team tasks, then inactive identity and state-specific Action required/Resolution required status are visible; accepted work remains read-only and distinguishable.
- Given authoritatively unstarted work, when an authorized Responsable selects an active same-team Employé, then reassignment and append-only history commit atomically without fabricating audit data.
- Given a synchronized draft or correction revision, when recovery is authorized, then new independent work links to the unchanged source using `deactivated-assignee-recovery`, each copied field records source provenance, and correction lineage/reference semantics remain intact.
- Given tablet-only, pending/uncertain, conflict, rejected, accepted, or replacement work, when reviewed, then the correct existing owner/limitation remains visible and no forbidden reassignment, retry, unlock, transfer, deletion, cancellation, or duplicate replacement is offered.
- Given any non-Responsable, foreign-team, stale, inactive-successor, failed, canceled, or duplicate request, when attempted, then authorization hides cross-team existence and no partial history/work is written.
- Given mobile local drafts or outbox operations under a deactivated identity, when authorization fails or another identity signs in, then local evidence and operation metadata remain encrypted, unchanged, inaccessible to the other identity, and unsent.

## Implementation Notes

- CAP-1: identity deactivation/session path; prove work remains unchanged.
- CAP-2: `tasks.ts` list projection and Responsable task UI.
- CAP-3: reassignment transaction, assignment-history migration, authorization/race tests.
- CAP-4: audit recovery command, typed source/successor link and field provenance.
- CAP-5/CAP-7: conservative tablet-only and pending/uncertain UI; server cannot observe local-only state.
- CAP-6/CAP-8: preserve correction/conflict/replacement lineage and delegate each state to its existing owner.
- CAP-9/CAP-10/CAP-11: transaction authorization, immutable event records, rollback/idempotency tests.

## Verification

Commands required by the user: focused Story 8.4 tests; API integration suite; web tests; affected mobile tests; `pnpm typecheck`; `pnpm contracts:check`; `pnpm boundaries:check`; `git diff --check`.
