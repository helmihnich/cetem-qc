# Delivery notes

## Current capability check (2026-10-05)

| Capability | Current code | 8.4 gap |
|---|---|---|
| Deactivation blocks login/session server authorization | `identity-auth` checks `is_active`; sessions are rejected | Reuse; do not duplicate identity behavior |
| Existing assignments/history survive deactivation | Existing task query retains inactive assignee; DB tests verify tasks remain | No explicit reassignment history or recovery action |
| Active same-team assignment | Existing task creation/replacement assignee checks | Reuse eligibility; add explicit unstarted reassignment and append-only assignment history |
| Conflict resolution | Story 8.1 server/current-version endpoint and mobile conflict UI/model | Preserve and flag; never rebuild |
| Rejection correction | Story 8.2 actor-bound correction records/references | Preserve; no cross-actor continuation without approved typed recovery |
| Accepted replacement | Story 8.3 replacement table/route/list lineage | Reuse for accepted audit; no duplicate endpoint/action |
| Pending vs accepted distinction | Stories 7.1–7.4 durable outbox and server acceptance | No transfer/unlock; show resolution required |
| Secure offline data | Stories 5.2–5.3 and 7.x local store/outbox | Do not migrate scope or expose old identity data |
| Action-required state | Inactive label exists in Responsable task list | Add explicit recovery projection and detail UI |
| Recovery values and lineage | 8.1/8.2/8.3 have distinct immutable lineage; no deactivation lineage exists | Add `deactivated-assignee-recovery` and field-level source provenance |

## Suggested implementation order (after decisions)

1. Specify/test state projection and transaction concurrency against existing 7.x/8.x data contracts.
2. OpenAPI and additive database migrations for assignment history, recovery lineage, and field provenance; then `tasks`/`audits` commands and own-team route authorization.
3. Web task detail/actions and French copy.
4. Mobile identity/offline protections only where current code gaps are proven; do not duplicate already passing behavior.
5. PostgreSQL, web, mobile regression suite and standard repository gates.

Product decisions listed in the original proposal are resolved by the Product Owner. No product decisions remain open. Spec approved 2026-10-07; story is ready-for-dev. A checkpoint implementation exists (migration 0014, reassign/recovery commands, API/web routes, `task-recovery.tsx`); dev must verify it against SPEC.md and run all gates. Deferred-work items "TASK_NOT_ASSIGNED stops whole sync run" and "assignment checked outside task lock" are owned by this story (lock/revalidate assignment in the transaction; per-task skip of unassigned tasks in sync).
