# Test plan

IDs continue the 7.x/8.x series. Every test uses synthetic names. PostgreSQL tests run on the local harness with zero skipped. Accepted audits come from the existing `sync-fixture.ts` path: a real accepted submission, never a direct insert.

## Contracts (`packages/schemas`, `packages/api-client`)

- **K5** `taskListResponseSchema` accepts `state` `draft` and `submitted`, and requires `replacementOf` and `replacedBy` (UUID or null). It refuses unknown states and extra properties. `replacementTaskResponseSchema` parses a 201 body. `contracts:check` passes.
- **K6** The typed client posts `CreateTaskRequest` to `/tasks/{taskId}/replacements` and returns typed outcomes for 201, 404, 409 (both codes) and 422.

## API (PostgreSQL route tests, new `replacement-routes.postgres.test.ts`)

- **L17** An accepted own-team task gets a 201. Exactly one task, one assignment and one `audit_replacement_links` row (`replacement-control`) are written, with the actor, the original task, audit and submission, and the new task. The new task is `draft` and assigned to the chosen Employé.
- **L18** The original's rows in `tasks` (including `updated_at`), `task_assignments`, `audits`, `audit_revisions`, `audit_submissions`, `sync_operation_outcomes` and `audit_lineage_links` are byte-identical before and after L17.
- **L19** Each refusal writes nothing (row counts unchanged) and returns its code:
  - an Employé session → 403;
  - a malformed ID → 404;
  - an unknown ID → 404;
  - another team's accepted task → 404, with the same body as unknown;
  - an own-team task with a draft audit → 409 `AUDIT_NOT_ACCEPTED`;
  - an own-team task without an audit → 409 `AUDIT_NOT_ACCEPTED`;
  - a second replacement → 409 `REPLACEMENT_ALREADY_EXISTS`;
  - an inactive assignee → 422;
  - an assignee from another team → 422;
  - an invalid body → 400.
- **L20** Two concurrent replacement requests for the same original give one 201 and one 409. One link row exists.
- **L21** A failure injected after the task insert (test seam) rolls back the task, the assignment and the link.
- **L22** Independence: the replacement's Employé syncs a draft and submits it. Both are accepted, a new audit is created for the replacement task, and the original audit is unchanged. The replacement, once accepted, can itself be replaced (L17 rules).
- **L23** `GET /tasks` gives the original `state: submitted`, `replacedBy` = the new ID and `replacementOf: null`. The replacement gets `state: draft`, `replacementOf` = the original ID and `replacedBy: null`. Other tasks get both null. Another team's tasks and links never appear.
- **L24** Migration 0012 → 0013 with `migrateThrough` keeps every row. UPDATE, DELETE and TRUNCATE on `audit_replacement_links` are refused. An insert with another `link_type`, with the same task on both sides, or with a second row for the same original is refused.
- **L25** The original assignee was deactivated after acceptance. The replacement is still allowed, assigned to an active Employé.
- **L26** Employé surface: after L17, the Employé task list and task responses parse with the unchanged schemas and carry no lineage field.

## Web

- **W1** Route handler `api/tasks/[taskId]/replacements`: a cross-origin POST is refused, a missing cookie gives 401, the API status and body are forwarded, and an unreachable API gives 503.
- **W2** List render: the `draft` and `submitted` pills, both lineage lines, and the replacement button only on a submitted row without `replacedBy`.
- **W3** Full path: button, form with the context line and empty fields, submit, the 201 status message, the list reloads with reciprocal lines, and the button disappears from the original.
- **W4** Refusals: a 409 already-replaced, a 409 not-accepted, a 422, a 500 and a network failure each show their text. Input is kept where specified, and a double click sends one request.
- **W5** Cancel closes the form and sends nothing.
