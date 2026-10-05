# Delivery notes

## Suggested order

1. Contracts: OpenAPI (route, `ReplacementTaskResponse`, `TaskListItem` change, codes), then the generated types, zod schemas and the client (K5, K6).
2. API:
   - migration 0013;
   - extract `tasks/commands/insert-assigned-task.ts`;
   - the `CreateReplacementControl` command and route;
   - the lineage and acceptance query merged into `GET /tasks` (L17–L26).
3. Web: the route handler, the list states and lineage lines, and the form in replacement mode with its strings (W1–W5).

## Bookkeeping at build

- Existing tests that build `TaskListItem` fixtures add `replacementOf: null, replacedBy: null`. Record this as a build decision. No assertion is weakened.
- In `epics.md`, Story 8.3 already carries its spec traceability line. Do not edit it again.

## Hand-offs

- **Story 8.4.** A replacement task is an ordinary task: its reassignment follows 8.4's rules. The link names tasks, not employees, so attribution is never transferred.
- **Story 9.1 / Epic 11 (W4, H1).** Host « Créer un contrôle de remplacement » on accepted-audit detail through the same route. History shows lineage only from `audit_replacement_links` (AD-6). Resolve the replacement audit through `audits.task_id = replacement_task_id`.
- **Story 12.8.** Demonstrate it end to end: accepted audit, replacement created and assigned, the Employé performs it, it is accepted, the original is unchanged, the links are shown both ways, and an Employé call is refused.
- **Cardinality.** If CETEM later allows several replacements of one original, drop `UNIQUE (original_task_id)` in a new migration and make `replacedBy` a list.
