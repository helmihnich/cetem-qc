---
id: SPEC-9-3-retain-or-discard-proposed-insights-with-provenance
story: 9.3
status: approved
approved: 2026-10-08
baseline_commit: 4a87d79
companions:
  - decision-model.md
  - test-plan.md
  - ../spec-9-2-generate-deterministic-insight-proposals-from-approved-rules/insight-rules.md
  - ../spec-9-1-review-accepted-audit-evidence-read-only/evidence-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
  - _bmad-output/specs/spec-9-2-generate-deterministic-insight-proposals-from-approved-rules/SPEC.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 9.3 — Retain or discard proposed insights with provenance

## Why

**Pain.** 9.2 delivers read-only proposals (`AcceptedEvidenceResponse.insights`) but the Responsable cannot act on them. FR-029 and DR-008 require the selections and discards, with actor, date and audit/rule version, plus the initial proposals, to be kept; Epic 10 needs a trustworthy "retained insights" set that never contains discarded content.

**Story statement.** As a Responsable, I want to select or discard each proposed insight, so that the retained set accurately reflects my review.

**What this story delivers.** A persisted, insert-only decision history, a decision route, current decisions in the evidence response, retain/discard controls in the W5 panel, and a pure domain function that yields the retained set for summary generation. Because the approved-rule registry is still empty (DEP-01R), production shows no proposal and therefore no control; the mechanism is proven with synthetic registries in tests.

**Traceability.** FR-029, FR-031, DR-007, DR-008, UX-DR2 (insight-item), UX-DR7, DEP-01. Depends on 9.1, 9.2 (done). Hands off to 9.4 (manual insights) and 10.1 (summary input).

## Capabilities

Table, route, contract and domain function are in [decision-model.md](decision-model.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Record a decision
  - **intent:** The Responsable retains or discards each proposal of an accepted own-team audit, and the system records who, when and under which versions.
  - **success:**
    - `POST /api/v1/tasks/{taskId}/insight-decisions` with `{ proposalId, decision: "retained" | "discarded" }` inserts one row holding actor ID, server date, task, audit, submission, revision number, revision rule identity, and the proposal's rule ID, rule version, registry version, approval reference, source keys and statement.
    - The server re-evaluates the proposals itself; the body carries no proposal content.
- **CAP-2** — History and current decision
  - **intent:** Decisions are never lost; the latest one per proposal is the current state.
  - **success:**
    - The table is insert-only. Changing one's mind inserts a new row; earlier rows stay.
    - The evidence response lists the current decision per proposal (latest wins) with decider display name and date.
    - A proposal with no row is undecided and is not retained.
- **CAP-3** — Initial proposals retained
  - **intent:** The proposals as first shown remain recoverable (DR-008).
  - **success:**
    - Each decision row stores the full proposal snapshot it applies to, so the initial content survives even if the registry later changes.
- **CAP-4** — Retained set for summary
  - **intent:** Only explicitly retained content can feed summary generation.
  - **success:**
    - `packages/domain` exports `selectRetainedInsights(proposals, currentDecisions)`: pure, returns only proposals whose current decision is `retained`, in proposal order; discarded and undecided content is absent.
    - Zero retained returns an empty list, a valid result, and no state anywhere requires a decision for the audit to proceed to summary.
- **CAP-5** — Zero is valid
  - **intent:** An all-normal audit, or a review that discards everything, never blocks summary completion.
  - **success:**
    - No flag, counter or gate requires at least one decision or one retained insight.
    - The panel shows « Aucun insight retenu » when nothing is retained; it is a normal state, not a warning.
- **CAP-6** — Server-side authorization and refusals
  - **intent:** Only the owning team's Responsable can decide, and only on real proposals.
  - **success:**
    - Employé → 403. Malformed ID, unknown task, other team, draft or no accepted submission → the same 404 `TASK_NOT_FOUND` body as 9.1, no row.
    - A `proposalId` not in the freshly evaluated set, or an invalid `decision` → 422 `VALIDATION_FAILED`, no row. With the production registry every proposal ID is therefore refused.
    - Stored snapshot inconsistent (9.1 CAP-5) → 500 `INTERNAL_ERROR`, no row.
- **CAP-7** — Panel controls
  - **intent:** The Responsable acts on each proposal in the W5 panel.
  - **success:**
    - Each proposal item shows « Retenir » and « Écarter », its current state (« Retenu », « Écarté », « Non décidé »), decider and date.
    - Controls appear only for `available` proposals; `unavailable` and zero-proposal states render as in 9.2 with no control.
    - The panel never evaluates or calculates; failures show a French error and leave the state unchanged.

## Constraints

- Evidence rows (`audits`, `audit_revisions`, `audit_submissions`, lineage tables) and `tasks.updated_at` are never written. Only the new insert-only table is written. Decisions never modify accepted measurements or comments (FR-031).
- No CETEM business rule is invented. Decisions are the Responsable's own judgement on rule-approved proposals; this story adds no rule, threshold or wording.
- A decision is not an approval of the employee's work and implies no machine conformity. No such state or wording appears. Final conformity stays an explicit human decision (Epic 10).
- Proposals come only from `evaluateInsightProposals` with the production registry; the client never supplies proposal content. Decisions on stale or unknown proposals are refused, not stored.
- Domain logic in `packages/domain`; `audits` module owns the table, command and query; the API delegates (AD-3, AD-7, `boundaries:check`). `apps/mobile` untouched; no Employé access.
- OpenAPI first: new operation and schemas in `packages/types/openapi/cetem-qc-v1.yaml`, then generated types, `packages/schemas` zod (strict), typed client. `contracts:check` passes. Web mutation goes through a Next route handler with the CSRF check and the session cookie only.
- All text in French in `packages/i18n`. Tests use synthetic names, the local PostgreSQL harness (zero skipped) and synthetic registries injected through the existing `reviewCommandTestSeams.insightRegistry`. No test is deleted, skipped or weakened; no gate script is edited. No AI text is stored or produced.

## Non-goals

- Manual insights (9.4), insight edit/delete, summary generation and its input trace (Epic 10), reports (Epic 11).
- Defining any rule on CETEM's behalf; making the production registry non-empty.
- Bulk decisions, decision undo by deletion, an audit-log viewer, notifications.
- Employé or mobile access. Deploying anything.

## Success signal

Domain tests prove `selectRetainedInsights` returns only retained proposals, drops discarded and undecided ones, and returns `[]` validly.

PostgreSQL route tests (synthetic registry via seam) prove: a decision inserts exactly one row with every provenance field; a second decision keeps both rows and flips the current state; all 9.1 refusal classes plus unknown proposal and invalid decision write nothing; with the production registry any decision is refused; UPDATE, DELETE and TRUNCATE on the table are refused; evidence tables and `tasks.updated_at` are byte-identical; the evidence response shows current decisions, and an open with no decisions or no proposals still works.

Web render tests prove the controls and states, no control when unavailable, « Aucun insight retenu », error handling, and no conformity or approval wording.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, DR-008, the 9.1/9.2 code and the Product Owner rules. None is a CETEM business rule.

- **Production behaviour.** The registry is empty (DEP-01R), so production offers no decision; this is the AC's gated path, not a gap. The route still validates and is fully tested with synthetic registries.
- **Insert-only history.** Matches `audit_review_accesses`/lineage tables; the current decision is the latest row per `(submission_id, proposal_id)` ordered by an identity sequence, not by clock.
- **Snapshot in each row.** DR-008 requires keeping the initial proposals; storing the proposal snapshot with the decision avoids a second proposals table and a "proposals persisted on open" write that would break 9.1's read-only open.
- **Server re-evaluation.** Determinism (9.2) lets the server rebuild the set; trusting client content would let discarded or fabricated text enter the retained set.
- **No gate on zero.** AC: zero retained must not block summary. Hence no "review complete" marker is added; Epic 10 reads `selectRetainedInsights` only.
- **Undecided ≠ retained.** Only explicit retention passes content to summary generation.
- **Version fields.** "Audit/rule version" = revision number and revision rule identity (`rule_id`, `rule_version`, catalogue/identity columns already on the revision) plus the insight rule ID, rule version and registry version.
- **No access-log row.** A decision is not an evidence open; its row is its own record.
- **Concurrency.** Two decisions on one proposal both insert; the later sequence wins; no lock needed.

## Open Questions

None blocking. For CETEM (DEP-01R, unchanged): which observations become deterministic insights. Until then production shows none.
