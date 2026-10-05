# Replacement model

Technical model. Names can be adjusted at build if the meaning holds.

## Migration 0013 `0013_replacement_lineage.sql`

```sql
CREATE TABLE audit_replacement_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type text NOT NULL CHECK (link_type = 'replacement-control'),
  original_task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
  original_audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  original_submission_id uuid NOT NULL UNIQUE REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  replacement_task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (original_task_id <> replacement_task_id)
);
```

- Add the `refuse_history_change` (UPDATE/DELETE) and `refuse_evidence_truncate` triggers, as in 0011.
- No existing table, constraint or trigger changes.
- `migrateThrough("0012")` followed by 0013 keeps every row.

## Command `CreateReplacementControl`

File: `apps/api/src/modules/audits/commands/create-replacement-control.ts`. Input: `responsableId`, `originalTaskId` (lowercased), and `CreateTaskInput`.

Everything runs in one `withTransaction`:

1. Lock the original: `SELECT task.id … FOR UPDATE OF task`, using the own-team predicate of `getOwnTeamTaskId` (assignment team = Responsable's team, employee role `employe` in that team). Taking the lock does not fire the `updated_at` trigger. If no row comes back → `not-found`.
2. Read the audit and the accepted submission of the task: `audits.state = 'submitted'` joined to `audit_submissions`. If none → `not-accepted`.
3. Read `audit_replacement_links` by `original_task_id`. If a row exists → `already-replaced`.
4. Run the assignee check and the insert through the new `tasks/commands/insert-assigned-task.ts`. It takes the transaction client and does what `createAssignedTask` does today: the active own-team employee `FOR UPDATE`, then the task and its assignment. `createAssignedTask` calls it and keeps its behaviour. An unavailable assignee → `assignee-unavailable`.
5. Insert one `audit_replacement_links` row with the actor, the original task, audit and submission, and the new task.
6. A unique violation (`23505`) on the link table rolls back and maps to `already-replaced`.
7. Return the created task plus `replacementOf: { taskId, auditId }`.

The original's `tasks`, `task_assignments`, `audits`, `audit_revisions`, `audit_submissions`, `sync_operation_outcomes` and `audit_lineage_links` rows are never written. Add a test seam after step 4, like 8.2's `afterRevisionInsert`, to prove the rollback.

## Route `POST /api/v1/tasks/{taskId}/replacements`

| Order | Check | Response |
|---|---|---|
| 1 | Session role is not `responsable` | 403 `FORBIDDEN` « Action réservée au Responsable de l’équipe. » |
| 2 | `taskId` is not a UUID | 404 `TASK_NOT_FOUND` « Tâche introuvable. » |
| 3 | Body fails `createTaskRequestSchema` | 400 `VALIDATION_ERROR`, same message and details as `POST /tasks` |
| 4 | `not-found` (unknown task or another team's task, not told apart) | 404 `TASK_NOT_FOUND` |
| 5 | `not-accepted` | 409 `AUDIT_NOT_ACCEPTED` « Cette tâche n’a pas d’audit accepté par le serveur. » |
| 6 | `already-replaced` | 409 `REPLACEMENT_ALREADY_EXISTS` « Un contrôle de remplacement existe déjà pour cet audit. » |
| 7 | `assignee-unavailable` | 422 `TASK_ASSIGNEE_UNAVAILABLE`, same message as `POST /tasks` |
| — | Success | 201 `ReplacementTaskResponse` `{ task: Task, replacementOf: { taskId, auditId } }` |
| — | Any other error | 500 `INTERNAL_ERROR` « Le contrôle de remplacement n’a pas pu être créé. » |

- The body uses the default 32 kB parser.
- Responses carry `Cache-Control: no-store`.
- Errors are never logged with payloads.

## List contract `GET /api/v1/tasks`

`TaskListItem` changes. It still has `additionalProperties: false`.

- `state`: enum `[draft, submitted]`. The value is `submitted` when the task's audit is in state `submitted`.
- `replacementOf`: `string | null`, required. It holds the original task ID when this task is a replacement.
- `replacedBy`: `string | null`, required. It holds the replacement task ID when this task was replaced.

The tasks query stays in `tasks`. The route then calls a new `audits/queries/task-audit-lineage.ts` (`readTaskAcceptanceAndLineage(pool, taskIds)`) and merges the results.

- Neither query writes anything.
- `lastUpdatedAt` stays `tasks.updated_at`.
- A new OpenAPI schema `ReplacementTaskResponse` is added. `Task` is unchanged (`state: draft`).

## Employé surface

- `EmployeeTaskListItem`, `EmployeeTaskResponse`, the sync routes and the mobile app do not change.
- The replacement task reaches its Employé through the existing assignment queries, like any other task.
