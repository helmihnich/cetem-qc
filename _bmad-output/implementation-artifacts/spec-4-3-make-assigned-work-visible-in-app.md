---
title: 'Story 4.3: Make assigned work visible in-app'
type: 'feature'
created: '2026-09-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'dcdd10d52b2c412e118be51e639a1f01302a6768'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An Employé has no in-app way to find or open work assigned by their Responsable. Email delivery is outside Phase 1, so the mobile app and API need to expose the assignment directly and securely.

**Approach:** Add Employé-scoped task list and task read operations, then implement mobile sign-in/first-login activation, “Mes tâches,” and a read-only task overview. Every read is authorized by the authenticated server session and explicit assignment ownership.

## Boundaries & Constraints

**Always:** Follow `epics.md` Story 4.3 ACs. Keep API/PostgreSQL authoritative; use the existing session and activation checks. Use assignment ownership predicates for both listing and direct task access, return no protected data on denial, reject unsupported query parameters, and keep French copy in the Expo app. Keep Responsable list behavior unchanged. Preserve task and assignment records, task state, and task history. Keep OpenAPI → generated types → Zod → typed client → Express aligned. No schema change is anticipated.

**Never:** Trust client identity/team scope, expose another employee's assignment, filter authorization only in the UI, mutate/reassign tasks, add email delivery claims, or begin Epic 5 field work. No audit or measurement entry, local drafts, offline access, sync, submission, calculations, lifecycle transitions, or new task states.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|----------------------------|----------------|
| Employee task list | Active authenticated Employé | French “Mes tâches” contains only tasks explicitly assigned to that account; multiple rows can be opened | Empty state when none; loading/error/retry remain distinct |
| Open assigned task | Authenticated Employé requests an assigned task ID | Read-only existing task metadata is shown | No mutation or unsupported field-work action |
| Read another employee's task | Own valid session requests another employee's task ID | No task data disclosed | Not found response |
| Protected access denial | No session, wrong role, temporary credential not replaced, or deactivated account | No task data disclosed | Existing 401/403 session conventions |
| Unsupported list query | Employee supplies query scope such as `teamId` | Request rejected before task query | Contracted validation error |

</frozen-after-approval>

## Code Map

- `packages/types/openapi/cetem-qc-v1.yaml` — authoritative contract for separate employee list and assigned-task read operations.
- `packages/types/src/generated/api-v1.ts`, `packages/schemas/src/api/v1.ts`, `packages/api-client/src/v1.ts` — generated contract, strict schemas, and typed client; preserve Responsable task-list operation.
- `apps/api/src/index.ts` — protected route registration, shared session enforcement, role checks, no-store responses, and French safe errors.
- `apps/api/src/modules/tasks/tasks.ts` — PostgreSQL task/assignment reads. Reuse task tables; predicate on authenticated assignment employee ID, never request-supplied team ID.
- `apps/api/src/modules/tasks/tasks.postgres.test.ts` and `apps/api/src/task-list-routes.test.ts` — isolated PostgreSQL and HTTP test patterns; retain Story 4.2 regression assertions.
- `apps/mobile/App.tsx`, `apps/mobile/package.json`, `apps/mobile/app.json` — Expo entry and minimal installed dependencies; add the employee sign-in/list/read-only overview without introducing field forms or local work storage.
- `packages/i18n/src/fr.ts` — shared French authentication and employee task copy.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — move only Story 4.3 to `in-progress` at implementation start and to `review` after developer verification; Epic 4 remains `in-progress`.

## Tasks & Acceptance

**Execution:**
- [x] Add OpenAPI employee task list and assigned-task read contracts, regenerate types, then align strict Zod schemas and typed client.
- [x] Implement authenticated employee-only API reads with PostgreSQL assignment-owner predicates and indistinguishable not-found behavior for unassigned IDs; add HTTP and real PostgreSQL security coverage.
- [x] Build French Expo sign-in/mandatory activation and “Mes tâches” list with loading, empty, error/retry, and openable read-only task metadata; no token or work persistence beyond existing session needs.
- [x] Run Story 4.3 and Story 4.1–4.2, Epic 3, auth/session, and PostgreSQL regressions; contract generation/checks, schema/boundary checks, workspace typechecks, API build, mobile typecheck/build where configured, and `git diff --check`.

**Acceptance Criteria:**
- Given tasks assigned to this Employé and tasks assigned to others, when the Employé opens “Mes tâches,” then only their authorized assignments appear in French and multiple active tasks can be opened.
- Given an assigned task, when the Employé opens it in the app, then the existing task context is visible without beginning field-work behavior.
- Given an in-app assignment, when the task becomes visible, then no email-sent or email-delivered claim is made.
- Given a direct API request for a task, when the requester is not the active authenticated assignee, then the API returns no task data regardless of manipulated IDs or query parameters.

## Implementation Notes

Added separate employee task-list and assigned-task read operations. Both use the active session's employee ID in SQL assignment predicates; the single-task route returns the same 404 body for malformed, missing, and unassigned IDs. Employee list query parameters are rejected before the database query, and employee read responses use `Cache-Control: no-store`.

The Expo app now has Employé sign-in, required temporary-password replacement, “Mes tâches” with distinct loading/empty/error/retry states, and a read-only task overview. Session credentials remain in the API client's memory; task data is held only in component state. Responsable task operations were not changed.


## Spec Change Log


## Review Triage Log

| Finding | Verdict | Evidence and disposition |
|---|---|---|
| Blind Hunter: employee list ordering is unstable | false | The employee list query's ordering can vary, but Story 4.3 and its UX do not promise sorting; no authorization or task-visibility result changes. Adding sorting would introduce a behavior the approved UX does not specify. |
| Blind Hunter: default localhost API URL is unreachable from some devices | medium | A physical device cannot reach the developer computer's loopback address. `apps/mobile/README.md` now documents simulator, Android emulator, LAN, and hosted API URLs, and notes the API's current loopback binding for physical-device use. |
| Blind Hunter: shared loading state could race during login/list load | false | Sign-in and activation now await the initial list load before leaving those flows; list refresh is not started by a competing effect. |
| Blind Hunter: task list has no pagination/limit | low | The API returns all assigned task records as specified, and no everyday scale problem is evidenced. Introducing pagination would risk hiding assigned work and add an unsupported query contract. |
| Blind Hunter: API errors are collapsed into generic mobile copy | false | The mobile error state is intentionally user-safe, French, and offers retry; no required error distinctions or API diagnostics are lost from the approved story behavior. |
| Blind Hunter: stable task UUID is prominent in detail | false | The ID is authorized task metadata already present in the task model and only returned after assignment ownership succeeds; it reveals no other employee's record. |
| Blind Hunter: type/state labels are hardcoded to current values | false | The OpenAPI/Zod task contract constrains returned values to the existing Graphie Mobile type and draft state, so the screen cannot receive another value through this API. |
| Blind Hunter: PostgreSQL coverage missed an empty assignment list | medium | The integration now authenticates an active employee with no assignments and proves the production PostgreSQL/API path returns `200 { tasks: [] }`. |
| Blind Hunter: tests lack a list ordering assertion | false | No ordering contract is defined; a permutation does not violate any Story 4.3 acceptance criterion. |
| Blind Hunter: verification could be mistaken for native/on-device validation | medium | The verification section explicitly limits Android/iOS exports to Metro JavaScript bundling and states that native build, install, on-device launch, native-module behavior, and live device API connectivity were not tested. |
| Verification Gap Reviewer: task-detail success/error/retry path lacked a behavior test | medium | Added detail-state path tests for assigned-task success and failure followed by retry of the same selected ID; the mobile screen uses these paths. A native React Native component render/on-device exercise remains outside the available verification evidence and is reported as a limitation. |


## Verification

**Final verification:**

- `pnpm.cmd --config.store-dir='.pnpm-store' contracts:generate` and `contracts:check` — passed; generated types match OpenAPI.
- `pnpm.cmd --config.store-dir='.pnpm-store' --filter @cetem-qc/schemas exec tsx --test src/api/v1.test.ts` — passed 8/8.
- `CETEM_QC_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/cetem_qc_test pnpm.cmd --config.store-dir='.pnpm-store' --filter @cetem-qc/api exec tsx --test` — passed 57/57, zero failures and zero skips. Includes Story 4.3 HTTP and isolated PostgreSQL assignment tests, Story 4.1/4.2 task regressions, Epic 3 account/status, and auth/session coverage.
- Story 4.3 PostgreSQL fixture separately passed with the task and employee credential/status PostgreSQL integrations: 5/5, zero skips. It proves assigned-task visibility, same-team colleague and cross-team exclusions, direct task-ID 404, Responsable 403, deactivated account 401, and retained assignment row.
- `pnpm.cmd --config.store-dir='.pnpm-store' --filter @cetem-qc/mobile exec tsx --test employee-task-list-state.test.ts employee-task-detail-state.test.ts` — passed 3/3 for loading, empty, error, ready, assigned-detail success, and retrying the selected task ID.
- `pnpm.cmd --config.store-dir='.pnpm-store' boundaries:test` — passed 8/8; `boundaries:check` passed.
- `pnpm.cmd --config.store-dir='.pnpm-store' -r --if-present typecheck` — passed for API, mobile, and web.
- API build and web production build — passed.
- Expo Android and iOS JavaScript production exports — passed offline with `--no-bytecode`; Metro bundled both platforms. The workspace has no native binary build script. Expo web export is not configured (`react-native-web` is not installed), so no web platform export was attempted in the final run.
- Android/iOS JavaScript exports validate Metro bundling only; they do not validate a native binary build, installation, on-device launch, native-module behavior, or live API connectivity on a simulator or physical device.
- `git diff --check` — passed.
- No migration was added. The temporary PostgreSQL 16 container used database `cetem_qc_test`; all integration schemas were isolated and removed by the tests.
- The reviewer-driven final assertion also passed against PostgreSQL (1/1 employee task integration) and mobile task state tests (3/3); recursive workspace typecheck and both Expo platform exports passed after that adjustment.

### Review Findings

- [x] [Review][Patch] Ignore stale detail responses after a different task is selected [apps/mobile/App.tsx:94] — resolved by request-generation invalidation in `apps/mobile/employee-task-detail-state.ts`; the out-of-order test proves task A's later success is ignored after task B is selected, and the list-return test proves invalidation prevents a pending detail result from applying.

#### Rejected

- Sign-in password clearing leaves no recovery path — false: a failed task-list load leaves the employee signed in with the French error state and retry action.
- Detail requests can leave loading stuck because there is no `finally` — false: the detail helper catches request errors and returns a result, and no reachable exception path was demonstrated.
- Invalid task timestamps can silently render as an invalid date — false: the production timestamp is a PostgreSQL `timestamptz`, returned through the date-typed query mapping and ISO serialization.
- The default API URL is unusable on a physical device — false as a Story 4.3 defect: the mobile README documents host/LAN alternatives; native device connectivity remains an evidence limitation.
- Activation does not explain the password requirement — false: the localized field label states “12 caractères minimum.”
- Detail route does not reject unsupported query parameters — false: the route validates the strict empty query schema and the HTTP test asserts an `employeeId` query is rejected.
- Wrong-role callers can distinguish malformed query input from role denial — false: role denial is the intended authenticated endpoint behavior and no non-disclosure contract applies to malformed query parameters.
- Employee task list ordering is unstable — false: the story and approved UX define no ordering contract.
- Task timestamp conversion can throw for a malformed database value — false: no reachable malformed `created_at` value was demonstrated with the PostgreSQL timestamp column and production query.

### Final Fresh-Context Review (2026-09-29)

- [x] [Review][Patch] Add behavioral tests for employee task API-client methods [packages/api-client/src/v1.ts:75] — resolved by six mocked-fetch tests in `packages/api-client/src/v1.test.ts` covering versioned list/detail GET paths, bearer headers, query-free list requests, encoded IDs, strict successful payload parsing, and contract-shaped 500/404 errors.

#### Rejected

- Employee task rows can reorder between list loads — false: no ordering is required by Story 4.3 or its approved UX.
- The unpaginated list can grow too large — low: no scale problem is evidenced for this PoV, and pagination would add behavior and a contract outside the approved story.
- The default loopback API URL prevents physical-device access — false as an acceptance defect: the README documents emulator, LAN, and hosted API alternatives; native connectivity remains an evidence limitation.
- Activation requires the temporary password to be entered again — false: the activation form explicitly requests the current password; carrying the temporary secret between screens is not a Story 4.3 requirement.
- The list can become stale while a session remains open — false: no live refresh requirement is specified; login and retry load the server list.
- A 401 from list/detail has no recovery path — false: the server rejects expired sessions and the UI retains a sign-out action so the employee can return to sign-in.
- Wrong-role sign-in can show generic error if logout fails — false: the mobile UI remains unauthenticated and exposes no task data; no role-denial copy contract requires a distinct message here.
- List/detail API errors are too generic — false: safe French errors with retry and sign-out are provided; the story does not require exposing server diagnostics.
- Sign-in and activation lack keyboard submit actions — low: this is a usability enhancement outside the approved acceptance criteria and requires additional interaction behavior.
- Task detail displays creation date without time — false: the approved read-only overview does not require time precision.
- A late task-list response can overwrite newer list state after sign-out — false: the list request is disabled behind the shared loading state during sign-in, activation, retry, and sign-out, so the described overlapping UI path is not reachable.
