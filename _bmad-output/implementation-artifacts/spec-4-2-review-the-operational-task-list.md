---
title: 'Story 4.2: Review the operational task list'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '64c1b5cc9702abdc30447820631ade513eec5826'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Responsable cannot review the tasks assigned to their team. They need a compact, authorized view to identify each task's assignee, type, state, establishment, and last update.

**Approach:** Add a Responsable-only own-team task-list API and expose it in the existing web experience using the established session bridge and French task-list patterns.

**Boundaries & Constraints**

**Always:** PostgreSQL and the API remain authoritative. Derive team scope from the authenticated Responsable on the server and enforce it in production SQL. Preserve Story 4.1 task/assignment relationships. Keep OpenAPI, generated TypeScript, Zod, typed client, Express runtime, and `contracts:check` aligned. Use the existing HttpOnly session cookie bridge. Keep user-facing UI copy French.

**Never:** Accept a client team ID as authorization scope. Expose extra task fields, add task filters/sorting/actions, invent lifecycle states or assignment behavior, expose employee task visibility, or start Story 4.3/Epic 5 behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Own-team list | Active Responsable session | Return own-team task ID, type, establishment, assignee, state, and last-update timestamp only | Empty array when none |
| Cross-team scope attempt | Request includes unsupported team query | Reject without returning task data | Contracted validation response |
| Wrong role or invalid session | Employé, anonymous, revoked, or deactivated session | No task data returned | 401 or 403 according to existing session/role conventions |
| Fetch failure in web | API unavailable or denied | French error state, with retry where appropriate | Never render stale or unauthorized rows |

</frozen-after-approval>

## Code Map

- `packages/types/openapi/cetem-qc-v1.yaml` -- source for the versioned task-list operation/response contract.
- `packages/types/src/generated/api-v1.ts`, `packages/schemas/src/api/v1.ts`, `packages/api-client/src/v1.ts` -- generated DTOs, request/response validation, and typed API method; update in contract order.
- `apps/api/src/modules/tasks/tasks.ts` -- add a SQL-backed list query using the existing assignment/team relation; no team scope comes from the request.
- `apps/api/src/index.ts` -- add the authenticated Responsable-only GET route, matching existing task role/error handling.
- `apps/api/src/db/migrations/0006_tasks.sql` -- Story 4.1 task/assignment schema; do not rewrite it. Add an additive migration for task last-update tracking, initialized from creation time.
- `apps/api/src/employee-routes.test.ts` -- existing Story 4.1 creation regression suite; run unchanged.
- `apps/api/src/modules/team-access/employee-credentials.postgres.test.ts` -- isolated temporary-schema PostgreSQL integration pattern; add separate Story 4.2 coverage for scoped joins/timestamps.
- `apps/web/src/app/api/tasks/route.ts` and `apps/web/src/app/api/task-assignees/route.ts` -- existing HttpOnly-cookie API bridge and no-store proxy conventions.
- `apps/web/src/app/page.tsx`, `apps/web/src/app/task-creation.tsx`, `packages/i18n/src/fr.ts`, `apps/web/src/app/globals.css` -- Responsable composition, French copy, loading/error patterns, and styles.

## Tasks & Acceptance

**Execution:**
- [x] OpenAPI-first task-list response and list operation; regenerate DTOs, align Zod and typed client, and enforce contract drift check.
- [x] Add an additive timestamp migration and SQL-backed task listing scoped to the authenticated Responsable's team; return only the six story fields.
- [x] Add direct API authorization and isolated PostgreSQL join/scope/update-timestamp coverage without changing Story 4.1 tests.
- [x] Add a no-store GET cookie bridge and French Responsable task-list UI with loading, empty, error, and retry states.
- [x] Run requested focused and regression tests, generation/checks, workspace checks/builds, and diff validation.

**Acceptance Criteria:**
- Given tasks exist for this and other teams, when an authenticated Responsable opens the list, then only own-team task ID, type, establishment, assignee, state, and last-update date are returned and shown.
- Given an Employé, invalid/deactivated session, or unsupported cross-team query, when the API is called directly, then access is denied without protected task data disclosure.
- Given no own-team tasks, API failures, or loading, when the Responsable opens the list, then distinct French empty, error, and loading states use the approved task-list/status/empty patterns.

## Implementation Notes

Added `GET /api/v1/tasks` as a Responsable-only, no-store operation. SQL joins tasks to assignments, team membership, and assignee accounts, constraining results by the authenticated Responsable's server-resolved identity. Unknown query parameters are rejected, and responses expose only the six story fields.

Added migration `0007_task_last_update.sql`, which backfills `updated_at` from `created_at` and advances it on task row updates. The Story 4.1 migration and creation tests remain unchanged.

Added the French web task table with loading, empty, and error/retry states; it renders no task detail action, filters, sorting controls, or employee view. Unsupported DEP-01 field/workflow behavior and Story 4.3 remain deferred by scope.

## Spec Change Log


## Review Triage Log


## Verification

**Commands:**
- Requested Story 4.2 focused API tests, Story 4.1 creation regressions, Epic 3 account/team regressions, authentication/session regressions, PostgreSQL integrations, OpenAPI generation, contract/schema tests, boundaries, recursive typechecks, API build, web production build, and `git diff --check` -- expected: all pass.

### Review Findings

- [x] [Review][Patch] Label deactivated assignees in the task list [apps/api/src/modules/tasks/tasks.ts:42-50; apps/web/src/app/task-list.tsx:42-46] — Resolved in Remediation: inactive assignees are labeled in the existing `assignee` value without adding a response field.
- [x] [Review][Patch] Verify the 0007 backfill against pre-existing tasks [apps/api/src/modules/tasks/tasks.postgres.test.ts:31-80] — Resolved in Remediation and verified against PostgreSQL 16 in the final review: a task created under 0001–0006 receives `updated_at = created_at` after applying the real 0007 migration.

**Rejected**

- Blind Hunter — The first-row-only projection assertion does not permit variable row shapes: the production query selects the same columns for every returned row.
- Blind Hunter — The fake-pool route test is not the evidence for production SQL scope; the PostgreSQL test invokes `listOwnTeamTasks` and direct API requests. It skipped in the initial review run but passed in the final PostgreSQL 16 run.
- Edge Case Hunter / Blind Hunter — Malformed percent-encoded cookie data can map to 503, but this requires a tampered cookie and follows the existing proxy decoding pattern; it does not justify adding special-case handling in this story.
- Blind Hunter — Date-only display satisfies the Story 4.2 acceptance criterion's “last-update date”; showing time is not required by the story.
- Blind Hunter — The proposed repeated-update and `created_at` assertions are not a separate defect from the 0007 timestamp verification gap recorded above.

## Remediation

- [x] Keep the task-list response at exactly six fields. Include `is_active` in the production assignee query and render active employees as their normal name and inactive employees as `<name> — Inactif`. Do not filter out tasks assigned to deactivated employees, reassign tasks, mutate task data, add status controls, or expose extra account fields.
- [x] Add focused API tests proving active and inactive assignee labels, continued visibility of an existing task after employee deactivation, exactly six response fields, and cross-team isolation.
- [x] Restructure the isolated PostgreSQL integration test to create a valid Story 4.1 task under migrations 0001–0006, verify `updated_at` is absent before migration 0007, apply the actual migration file, assert the existing task's `updated_at` equals its recorded `created_at`, and verify later updates advance it. Preserve production query/API scope coverage and schema/pool cleanup.
- [x] The initial review recorded PostgreSQL as unavailable and kept Story 4.2 in review. This environment blocker was resolved in Final Verification below.

## Remediation Verification

- Focused API, Story 4.1 non-PostgreSQL creation, Epic 3 employee/status, and authentication/session tests passed.
- Web task-list/session proxy tests, OpenAPI generation, `contracts:check`, schema tests, boundary tests/checker, recursive workspace typechecks, API build, web production build, and `git diff --check` passed.
- Initial review limitation: the Story 4.2 and Story 4.1 PostgreSQL tests could not connect because Docker was unavailable. This historical result was superseded by the successful final run below.

## Final Fresh-Context Review (2026-09-29)

**Decision:** Clean review. No blocking findings remain. Story 4.2 is `done`; Epic 4 remains `in-progress`; Story 4.3 remains `backlog`.

**PostgreSQL 16 evidence:** The disposable `postgres:16` container used `127.0.0.1:55432/cetem_qc_test` and was stopped after verification. The Story 4.2 migration/task-list integration passed 1/1 with zero skips, including the 0001–0006 seed, the real 0007 backfill, update timestamp, active/inactive assignee labels, unchanged task visibility, six-field projection, own-team isolation, authorization, and schema/pool cleanup. The Story 4.1 PostgreSQL task-creation regression passed, including assignment eligibility, atomic persistence, and rollback. The complete API suite passed 55/55 with zero failures and zero skips.

**Additional evidence:** Focused Story 4.2 API tests passed 2/2 with zero skips; Story 4.1, Epic 3 employee/status, and authentication/session regressions passed; web task/session/proxy tests passed 11/11; schema/contract tests passed 7/7; boundary tests passed 8/8 and the boundary checker passed. OpenAPI generation, `contracts:check`, recursive workspace typechecks, API build, web production build, and `git diff --check` passed.

**Rejected suggestions:** No stable task ordering is required and adding it would introduce sorting outside the story. The web table already uses an overflow-scrolling wrapper; the AC asks for the last-update date, not a time display. Internal assignee activation data is reduced to the existing six-field response and the strict runtime schema rejects extra fields. The suggested POST documentation change is already present. Extra repeated-update/default/projection assertions and a rendered-component test were judged non-blocking coverage suggestions; the production SQL, strict response schema, live PostgreSQL/API test, existing web proxy tests, and production build passed.
