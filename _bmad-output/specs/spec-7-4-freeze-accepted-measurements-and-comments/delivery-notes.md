# Delivery notes and hand-offs

## Files expected to change

- `apps/api/src/db/migrations/0010_freeze_submitted_audits.sql` (new, [freeze-model.md](freeze-model.md)).
- `apps/api/src/modules/tasks/queries/own-team-task.ts` (new): `getOwnTeamTaskId`.
- `apps/api/src/modules/audits/queries/accepted-submission.ts` (new): `getAcceptedSubmissionForReview`.
- `apps/api/src/freeze-routes.postgres.test.ts` (new), and shared fixture helpers moved to `apps/api/src/test-support/` if reused ([test-plan.md](test-plan.md)).
- `apps/api/src/db/README.md`: list migration 0010 if the README lists migrations.

No change to `packages/types`, `packages/schemas`, `packages/api-client`, `packages/domain`, `packages/i18n`, `apps/mobile` or `apps/web`.

## Hand-offs

- **Story 8.3.** `CreateReplacementControl` creates a new task and audit and the typed `replacement-control` lineage table (AD-6), in one transaction. It must not update the original `audits` row: the 0010 trigger refuses it. Reciprocal lineage is read from the lineage table.
- **Story 8.4.** Assignments of a task with a submitted audit are not frozen by 7.4. 8.4 decides how reassignment treats them (AD-5: immutable snapshots are never reassigned).
- **Story 9.1.** Add the Responsable route that calls `getAcceptedSubmissionForReview`, the access log with actor/date, the web view, and the task-list `state` change (task rows stay updatable). A `404 TASK_NOT_FOUND`-style answer must cover every `undefined` case, without telling them apart.
- **Any later story that must change a submitted audit row** (none is planned: summaries, decisions and reports have their own tables per AD-8) needs a spec decision and a new migration that changes the trigger explicitly.
