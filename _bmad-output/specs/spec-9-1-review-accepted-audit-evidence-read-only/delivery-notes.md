# Delivery notes

## Suggested order

1. Contracts: OpenAPI `getAcceptedEvidence` and `AcceptedEvidenceResponse`, then generated types, zod schema and client (K7, K8).
2. API: migration 0015, `record-review-access.ts`, the invariant check, the route and its log lines (R1–R11).
3. Web: the route handler, the row button, the panel, the read-only section lists, `fr.evidence` strings (W1–W7).

## Bookkeeping at build

- `GraphieCalculationReview` is reused as is. If it needs a prop to hide a block, add it without changing its current output.
- Existing tests that build `TaskList` props keep working. The new list prop is optional.
- `deferred-work.md`: mark the 7.3 « task list state » entry as resolved by Story 8.3 (list `state`) and 9.1 (row action). Add a `resolved:` line to the 6.4 identity/results entry: the server invariant is 7.3, the response guard is 9.1.
- In `epics.md`, Story 9.1 already exists. Add only the spec traceability line.
- Set `epic-8-retro-item-28-add-a-cross-lineage-test-conflict-correc` to `done` only when R10 passes.

## Hand-offs

- **Stories 9.2–9.4.** W5 (insights) opens from the same panel later. The access table stays the review-access record; insight decisions get their own tables.
- **Epic 10.** The machine conformity decision is a separate Responsable action. W4 shows suggestions only.
- **Epic 11 (H1).** History may reuse `openAcceptedEvidenceForReview`. A routed W4 page can replace the panel without an API change.
- **Story 12.8.** Demonstrate: an Employé submits, the Responsable opens the evidence, an access row exists with the actor and date, another team's Responsable gets the same 404 as for an unknown task, and an Employé call is refused.
- **Catalogue or rule bump (D2).** A revision stored under an older tuple would fail the identity schema. Handle it at the first bump, in the same change as the 8.1/8.2 follow-ups.
