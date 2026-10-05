---
id: SPEC-8-3-create-a-responsable-only-replacement-after-acceptance
story: 8.3
status: in-progress
approved: 2026-10-05
baseline_commit: b95b1b5
companions:
  - replacement-model.md
  - replacement-ui.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-7-4-freeze-accepted-measurements-and-comments/freeze-model.md
  - ../spec-8-1-resolve-a-synchronization-conflict-explicitly/server-support.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/EXPERIENCE.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 8.3 — Create a Responsable-only replacement after acceptance

## Why

**Pain.** Once the server accepts a submission, its evidence is frozen (7.4), and nothing comes after that:
- A material error in accepted evidence cannot be corrected. The only legal path (FR-024, OD-03) is a new, independent, linked control, and no command creates it.
- The Responsable's task list always shows « Brouillon », so they cannot tell which tasks hold an accepted audit.
- No typed `replacement-control` lineage exists (AD-4, AD-6). `audit_lineage_links` cannot hold it: it needs a successor revision and a predecessor sync outcome.

**Story statement.** As a Responsable, I want to create a new control linked to an accepted audit, so that a material submitted error can be corrected without altering original evidence.

**Traceability.** FR-024, FR-040, DR-001, DR-006, SEC-002, SEC-003, AD-3, AD-4, AD-6, UX-DR11, OD-03, EXPERIENCE.md « Replacement after server acceptance — OD-03 », `history-record` and the label table. Also: the 7.4 hand-off (`CreateReplacementControl`) and the 8.1/8.2 hand-offs (own migration, never reuse another link type). Depends on 7.1–7.4, 8.1 and 8.2 (done).

## Capabilities

The table, command, endpoint and list contract are in [replacement-model.md](replacement-model.md). The screens and French copy are in [replacement-ui.md](replacement-ui.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Show accepted audits to the Responsable
  - **intent:** The Responsable can tell which own-team tasks hold a server-accepted audit.
  - **success:** The task list shows « Soumis — accepté par le serveur » for a task whose audit is submitted, and « Brouillon » otherwise. No other team's task appears (4.2 rule unchanged).
- **CAP-2** — Create a replacement control
  - **intent:** On explicit request, the Responsable creates a new task linked to an accepted audit, through normal task creation.
  - **success:**
    - « Créer un contrôle de remplacement » is offered only on an accepted own-team task that has no replacement yet.
    - It opens the normal creation form (establishment, service, Graphie Mobile, active own-team Employé), empty, with « Remplacement de l’audit {X} ».
    - One server transaction creates the task, its assignment and one immutable `replacement-control` link.
    - On refusal or failure, nothing is written, the original is unchanged, and the form shows the French error with the input kept.
- **CAP-3** — Independent replacement
  - **intent:** The replacement is a control of its own, not a continuation of the original.
  - **success:** The new task is an ordinary `draft` task. The assigned Employé sees it in « Mes tâches » and performs it like any task. Its audit is created by its own first accepted sync (7.3). No measurement, comment, calculation, result or date is copied from the original.
- **CAP-4** — Reciprocal lineage
  - **intent:** Both records show their relationship without any status change.
  - **success:** The list shows « Remplacement de l’audit {X} » on the replacement and « Remplacé par l’audit {Y} » on the original. Both come only from `audit_replacement_links`. The original keeps its state, `lastUpdatedAt`, audit, revisions, submission and outcomes, byte for byte.
- **CAP-5** — Employé exclusion
  - **intent:** The Employé can neither see nor invoke a post-acceptance replacement.
  - **success:** An Employé call to the replacement route gets 403 and writes nothing. Employé task responses and the mobile app gain no replacement field or action.

## Constraints

- The original task, assignment, audit, revisions, submission, outcomes and lineage rows are never written. The 0010 freeze stays as it is. Neither record changes status automatically.
- Responsable-only and own-team-only, enforced on the server. A refused request does not reveal whether another team's task exists.
- Lineage is typed and insert-only, in its own table and migration. `sync-conflict-revision` and `rejected-submission-correction` are never reused, and no lineage is inferred from any other source.
- AD-3 and `boundaries:check`: `audits` owns the command, the link and the acceptance/lineage reads. `tasks` owns the task and assignment insert, exposed through `tasks/commands/`.
- OpenAPI first: route, schemas and codes go in `packages/types/openapi/cetem-qc-v1.yaml`. Then come the generated types, the `packages/schemas` zod schemas and the typed client.
- All user-visible text is in French and lives in `packages/i18n`. The web route reaches the API only through a Next route handler with the existing CSRF check.
- No CETEM business rule, tolerance or validation is invented. Tests use synthetic names and the local PostgreSQL harness (zero skipped). No test is deleted, skipped or weakened, and no gate script is edited.

## Non-goals

- The accepted-evidence detail (W4, Story 9.1) and authorized history (H1, Epic 11). They may later host the same action through the same route.
- Showing lineage to the Employé or in the mobile app.
- Copying or prefilling anything from the original into the replacement.
- Cancelling, deleting or reassigning a replacement task (reassignment is 8.4). More than one replacement per original.
- Reports. None exist yet, and Epic 11 derives replacement lineage from `audit_replacement_links`.
- Deploying anything.

## Success signal

PostgreSQL route tests prove the following:
- a replacement of an accepted own-team task returns 201 and writes exactly one task, one assignment and one `replacement-control` row, with the actor;
- the original's rows and `updated_at` are byte-identical afterwards;
- every refusal (Employé, another team, unknown or malformed ID, not accepted, already replaced, inactive or foreign assignee, invalid body) writes nothing and returns its documented code;
- two concurrent requests create exactly one replacement;
- a failure after the task insert rolls everything back;
- the replacement task syncs and is accepted independently, with its own audit;
- the list reports state and lineage both ways;
- UPDATE, DELETE and TRUNCATE on the link table are refused.

Web render tests walk four paths:
1. accepted row, action, form, success, reciprocal labels;
2. no action on a draft or already replaced task;
3. refusal and network failure;
4. the list with mixed states.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, EXPERIENCE.md, AD-3/AD-4/AD-6, the 7.4/8.1/8.2 hand-offs, the current code and the Product Owner rules. None is a CETEM business rule.

- **Separate typed table.** `audit_replacement_links` (migration 0013) holds `replacement-control` only. `audit_lineage_links` needs a successor revision and a predecessor sync outcome, and a replacement has neither at creation.
- **The replacement's audit.** It is created by the existing rule: one audit per task, on the task's first accepted sync (0009). The link names the replacement task, which has at most one audit, so the link resolves to it. An empty audit row cannot exist (`current_revision >= 1`), and it would break the 7.3 base-revision protocol.
- **One replacement per original.** UNIQUE on the original task. The UX names one successor (« Remplacé par l’audit Y »), and `button-primary` forbids duplicates from repeated requests. An accepted replacement may itself be replaced. This is a technical cardinality that a later migration can lift.
- **Label identifiers.** X and Y are task IDs, as shown in the list's ID column. One task has exactly one audit, and the replacement audit does not exist before its first accepted sync.
- **Normal task creation.** Same body and rules as `POST /tasks`. The form is empty, because the UX says « No new copy-forward or transfer policy is inferred ». The original assignee may be chosen again. A deactivated original assignee does not block the replacement.
- **Entry point.** W4 and H1 do not exist yet, so the action is on the W2 list row.
- **List state.** `submitted` means that the task's audit is in state `submitted`. `tasks.state` stays `draft`. The state is derived by an `audits` query, never stored on the task.

## Open Questions

None blocking. Every resolution above follows from EXPERIENCE.md, the architecture, the 7.4/8.1/8.2 hand-offs or the existing code. No CETEM business rule is involved.
