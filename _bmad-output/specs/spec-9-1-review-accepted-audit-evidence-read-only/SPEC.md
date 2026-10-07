---
id: SPEC-9-1-review-accepted-audit-evidence-read-only
story: 9.1
status: approved
approved: 2026-10-07
baseline_commit: d8cad03
companions:
  - evidence-model.md
  - review-ui.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-6-4-display-calculation-results-in-responsable-review/review-view.md
  - ../spec-7-4-freeze-accepted-measurements-and-comments/freeze-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/EXPERIENCE.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
  - _bmad-output/implementation-artifacts/deferred-work.md
  - _bmad-output/implementation-artifacts/epic-8-retro-2026-10-07.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 9.1 — Review accepted audit evidence read-only

## Why

**Pain.** The server accepts and freezes submissions (7.3, 7.4) and the Responsable's task list shows which tasks are accepted (8.3), but the Responsable still cannot open the evidence:
- No HTTP route returns the accepted snapshot. `getAcceptedSubmissionForReview` (7.4) has no caller.
- The read-only calculation view (6.4) has no host. W4 « Submitted evidence » does not exist.
- Nothing records that a Responsable looked at an audit (SEC-011, FR-012/013).

**Story statement.** As a Responsable, I want to inspect accepted measurements, comments and calculation evidence, so that I can review the control without changing the employee's submission.

**Traceability.** FR-012, FR-013, SEC-002, SEC-003, SEC-011 (security events), DR-005, UX-DR6, UX-DR2 (`measurement-result`), EXPERIENCE.md W4. Hand-offs: 6.4 (render `GraphieCalculationReview` with the accepted snapshot; keep identity and results consistent), 7.3/7.4 (route over `getAcceptedSubmissionForReview`, access log with actor and date, one 404 for every `undefined` case), 8.3 (lineage from `audit_replacement_links`), epic-8 retro action 5 (cross-lineage test). Depends on 6.4, 6.6, 7.3, 7.4, 8.1–8.4 (done).

## Capabilities

The route, table, contract and invariants are in [evidence-model.md](evidence-model.md). The screen and French copy are in [review-ui.md](review-ui.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Open accepted evidence
  - **intent:** The Responsable opens the accepted submission of an own-team task from the task list and reads everything the Employé submitted.
  - **success:**
    - On an accepted row the list offers « Consulter les preuves ».
    - The screen shows the task context, then identification, visual checks and comments, then the measured values, the calculated values, the per-test suggested verdict and its provenance.
    - It also shows the submitter, the acceptance date and the stored rule identity.
    - Values appear exactly as stored.
- **CAP-2** — Read-only, no approval
  - **intent:** Review never changes the submission and never becomes an approval step.
  - **success:**
    - No control on the screen changes data, apart from « Retour à la liste ».
    - No approve, reject or validate action, no review state and no overall machine conformity appear.
    - The note « La conformité finale de l'appareil est décidée par le Responsable. » appears once.
    - Evidence rows and `tasks.updated_at` are byte-identical after any number of opens.
- **CAP-3** — Access log
  - **intent:** Every successful open of accepted evidence is recorded with who and when.
  - **success:**
    - One insert-only row per successful open holds the Responsable's account ID, the server date, the task, the audit and the submission.
    - If the log write fails, the request fails and no evidence is returned.
    - The row carries no evidence content.
- **CAP-4** — Server-side own-team authorization
  - **intent:** Another team's audit is never disclosed, and refusals are traceable.
  - **success:**
    - An Employé call gets 403.
    - A malformed ID, an unknown task, another team's task and an own-team task without accepted submission all get the same 404 `TASK_NOT_FOUND` with the same body.
    - A refusal writes no access row and returns no evidence field.
    - Each refusal emits one structured server log line with the actor ID and the refusal class, and no task ID or evidence.
- **CAP-5** — Consistent snapshot
  - **intent:** The screen never pairs an identity with results calculated under another rule.
  - **success:**
    - The API refuses (500 `INTERNAL_ERROR`, nothing logged in the access table) a stored snapshot whose result rule identity differs from the revision identity.
    - The web view shows « Version de règle non prise en charge » for an unsupported identity (6.4 behaviour).
    - A response never carries a mixed pair.
- **CAP-6** — Lineage context
  - **intent:** The Responsable sees how the audit relates to replacement and recovery tasks without leaving W4.
  - **success:**
    - The screen shows read-only « Remplacement de l'audit X » and « Remplacé par l'audit Y » lines from `audit_replacement_links`, exactly as the list does.
    - It shows the recovery lines the list already derives.
    - One cross-lineage test covers all four relationship types on one task set.

## Constraints

- Read only. Nothing in `audits`, `audit_revisions`, `audit_submissions`, `sync_operation_outcomes`, lineage tables or `tasks` is written, except the new insert-only access table. `tasks.updated_at` does not move.
- Responsable-only and own-team-only, enforced on the server by the existing `getOwnTeamTaskId` predicate. Authorization comes from the session, never from the request.
- AD-3 and `boundaries:check`: `audits` owns the access table, the access command and the review read, reached through `audits/commands/` and `audits/queries/`. `tasks` owns `getOwnTeamTaskId`.
- OpenAPI first: route, schemas and codes go in `packages/types/openapi/cetem-qc-v1.yaml`, then generated types, `packages/schemas` zod schemas and the typed client.
- The web screen never calculates. It renders stored results through `GraphieCalculationReview` and the shared presenter in `packages/i18n`. `apps/mobile` is untouched.
- The access log stores no measurement, comment, payload or secret. Application logs carry IDs only.
- All user-visible text is in French in `packages/i18n`. The web route reaches the API only through a Next route handler. A GET needs no CSRF check but must forward only the session cookie and send `no-store`.
- No CETEM business rule is invented. No overall conformity, approval state or insight appears (Epic 10 and Epic 9.2+ own them). Tests use synthetic names and the local PostgreSQL harness (zero skipped). No test is deleted, skipped or weakened, and no gate script is edited.

## Non-goals

- Approve or reject employee work, any review state, or an « examiné » flag (AC, AD scope).
- Deterministic insights, retain or discard, manual insights (9.2–9.4), AI summary and machine conformity (Epic 10), reports and history (Epic 11).
- Hosting « Créer un contrôle de remplacement » or recovery actions on W4. They stay on the list.
- Any employee-facing or mobile access to this route, and an access-log viewer.
- Showing not-yet-accepted drafts, or revision history other than the accepted submission.
- Reading old revisions across a catalogue bump (deferred D2).
- Deploying anything.

## Success signal

PostgreSQL route tests prove the following:
- an own-team Responsable gets 200 with the exact stored payload, results, identity, submitter and acceptance date, and exactly one access row with their ID;
- every refusal (Employé, malformed ID, unknown, another team, draft audit, no audit) returns its documented code, writes no access row, and the 404 bodies are byte-identical;
- the evidence tables and `tasks.updated_at` are byte-identical after repeated opens, and each open adds one row;
- UPDATE, DELETE and TRUNCATE on the access table are refused;
- a failing log insert returns 500 with no evidence;
- a mismatched results snapshot returns 500 and logs no access;
- one task set that carries conflict, correction, replacement and deactivation-recovery lineage returns consistent list state and evidence.

Web render tests walk four paths:
1. an accepted row, « Consulter les preuves », the full screen, and back;
2. a screen with no action control apart from « Retour à la liste », and no conformity or approval wording;
3. a 404, a 500 and a network failure;
4. an unsupported identity.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, EXPERIENCE.md W4, AD-3/AD-6/AD-11, the 6.4/7.3/7.4/8.3 hand-offs, the current code and the Product Owner rules. None is a CETEM business rule.

- **Route.** `GET /api/v1/tasks/{taskId}/accepted-evidence`, Responsable only. A GET with a side effect (the log) is accepted: the log is a security event, not a state change, and `Cache-Control: no-store` stops caching.
- **State already in the list.** 8.3 made `GET /tasks` report `submitted`, so the deferred 7.3 « task list state » item is resolved there. 9.1 changes no list contract field; it only adds the row action.
- **Access table.** `audit_review_accesses` (migration 0015) in the `audits` module, insert-only like the other history tables (`refuse_history_change`, `refuse_evidence_truncate`). One row per successful open, no dedupe: the log records each access, and a repeated open is a repeated access.
- **Fail closed.** The read and the log insert run in one transaction. If the insert fails, nothing is returned. An unlogged access is not allowed.
- **Refusals.** Refusals are logged as structured server lines (SEC-011 « authorization refusals »), not table rows. They carry the actor ID and a fixed class (`forbidden-role`, `not-found`) and never the requested ID, so a probe cannot turn the log into a store of foreign IDs. The 404 does not distinguish its causes for the caller; the class in the log may.
- **What is shown.** All catalogue fields in paper order. The fields that feed a calculation render inside `GraphieCalculationReview`; every other field (identification, visual checks, comments) renders in read-only section lists. Empty values read « Non renseigné ». The text comes from `GRAPHIE_MOBILE_POV_CATALOGUE` labels and `fr`; the screen adds no wording of its own.
- **No overall verdict.** The screen shows per-test suggested verdicts from the stored results with the 6.4 note. Final machine conformity stays an explicit human decision (Epic 10).
- **Entry point.** The web has no routing beyond one page, so W4 opens as a panel under the list from the row action « Consulter les preuves », closed by « Retour à la liste ». A routed page may replace it later without changing the API.
- **Identity and results invariant.** The server check lives in the review query (CAP-5) because it is the last point before the data leaves the server. The 6.4 view-level concern is closed by the response never carrying a mismatch.
- **Submitter.** `submittedBy.displayName` is the current display name; the ID is the authority (7.4). A later name change shows the new name.
- **Lineage.** The lineage lines reuse `readTaskAcceptanceAndLineage`; no second lineage query is written.

## Open Questions

None blocking. Every resolution above follows from the approved specs, the architecture, the existing code or the Product Owner rules. No CETEM business rule is involved.
