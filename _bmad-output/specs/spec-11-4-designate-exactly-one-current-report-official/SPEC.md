---
id: SPEC-11-4-designate-exactly-one-current-report-official
story: 11.4
status: approved
approved: 2026-10-08
baseline_commit: cf923a7
companions:
  - official-report-model.md
  - test-plan.md
  - ../spec-11-1-generate-an-inspectable-word-report-candidate/SPEC.md
  - ../spec-11-1-generate-an-inspectable-word-report-candidate/report-candidate-model.md
  - ../spec-11-3-create-a-report-candidate-from-a-ready-pdf/SPEC.md
  - ../spec-11-3-create-a-report-candidate-from-a-ready-pdf/pdf-candidate-model.md
  - ../spec-10-3-reopen-a-confirmed-summary-before-official-designation/SPEC.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md (AD-8, AD-9)
  - _bmad-output/implementation-artifacts/epic-10-retro-2026-10-08.md (F5, action 2)
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 11.4 — Designate exactly one current report official

## Why

**Pain.** Stories 11.1–11.3 produce Word and PDF report candidates, all « non officiel ». Nothing yet lets the Responsable pick the one report that closes the control, and the summary reopening veto of 10.3 (`hasOfficialDesignation`) is hard-coded `false`, so « unavailable after designation » has no production effect (Epic 10 retro F5). FR-014/FR-035 require exactly one official report tied to the current summary and human decision (AD-8).

**Story statement.** As a Responsable, I want to inspect and explicitly designate one current report candidate, so that finalization is tied to the confirmed summary and human decision.

**What this delivers.** One additive migration (`0025`) with an insert-only `official_reports` table; one designation command and route; a derived `official` / `superseded` candidate status; a read of the official report; the real reports participant in the 10.3 reopening contract; a lock on new candidates after designation; a « Désigner comme officiel » action with explicit confirmation in the W5 panel.

**Traceability.** FR-014, FR-035, DR-005, DR-009, AD-8, AD-9, UX-DR10. Depends on 10.1–10.4 (done: confirmed summary, reopening participant contract, decision), 11.1 and 11.3 (done: candidates, bindings, derived freshness, download) and 11.2 (done: `files`). Hands off to 11.5 (history and official download) and 11.6 (asynchronous freshness). DEP-03 governs acceptance of generated-document *content*; designation checks bindings and file readiness, never report content.

## Capabilities

Migration, command, queries, routes, contract and web details are in [official-report-model.md](official-report-model.md); test IDs in [test-plan.md](test-plan.md).

- **CAP-1** — Designate one current candidate official
  - **intent:** The Responsable of the owning team designates one `ready` candidate (Word or PDF) as the official report of the control. The server rechecks eligibility and freshness in the designation transaction.
  - **success:**
    - `POST /api/v1/tasks/{taskId}/report-candidates/{candidateId}/designate` with body `{}` (strict) returns 201 `OfficialReport` with the candidate id, `origin`, actor (`designatedBy`), server `designatedAt`, task and audit linkage (`taskId`, `auditId`, `auditRevision`, `submissionId`), summary id/version, conformity decision id and outcome, and the candidate's file metadata.
    - Exactly one `official_reports` row is written; nothing else changes (no candidate, outcome, file, evidence, summary, decision or `tasks.updated_at` write).
    - Both conformity outcomes (`machine-conforme`, `machine-non-conforme`) can be designated; the outcome never gates designation.
    - Refusals write nothing: Employé 403; malformed/unknown/other-team/draft/no-audit task, or malformed/unknown/other-task candidate → 404 `TASK_NOT_FOUND` (body identical to 9.1); invalid body → 422 `VALIDATION_FAILED`.
- **CAP-2** — Only a fresh, ready candidate is designatable
  - **intent:** A candidate bound to obsolete inputs, or not finished, never becomes official (AD-8).
  - **success:** Inside the transaction (under `lockTaskSummary`) the server requires: the candidate's outcome is `ready`; its `confirmed_summary_id` and `conformity_decision_id` equal the *current* ones; its `submission_id` and `audit_revision` equal the current accepted submission's; for a PDF candidate, `files` still derives the stored file as `ready` (`getStoredFileStatus`). Candidate still generating or failed → 409 `REPORT_CANDIDATE_NOT_READY`; bindings stale, `outdated` outcome, summary reopened or re-decided, other submission, or file no longer ready → 409 `REPORT_CANDIDATE_OUTDATED`. Nothing is written on refusal.
- **CAP-3** — Exactly one official report, never replaced
  - **intent:** A control has one official report; once designated it cannot be changed or replaced in place.
  - **success:** `official_reports` is unique per task and per candidate and is insert-only (UPDATE/DELETE/TRUNCATE refused by the database). Designating the same candidate again returns 200 with the stored `OfficialReport` and writes nothing; designating another candidate of the task → 409 `REPORT_ALREADY_OFFICIAL`. Two concurrent designations (same or different candidate) leave one row; the loser gets 200 (same candidate) or 409.
- **CAP-4** — Candidate statuses reflect designation
  - **intent:** The candidate list tells the Responsable which candidate is official and which were passed over, without rewriting history.
  - **success:** The derived status gains `official` (the designated candidate; stays `official` even if later inputs change) and `superseded` (any other candidate that would otherwise read `ready` once an official report exists). `outdated` and `failed` keep their own status; nothing is written to candidate tables. A candidate list entry never has a designation control state other than from `ready`.
- **CAP-5** — Designation completes and locks the workflow
  - **intent:** After designation no later mutation can alter the completed control or replace the report.
  - **success:**
    - `GET /api/v1/tasks/{taskId}/official-report` returns 200 `OfficialReport` for the owning Responsable or 404 `TASK_NOT_FOUND` (no official report, unknown, other team, malformed; identical body). This is the completion signal; the task's `state` column is not changed.
    - `generateReportCandidate` and `attachPdfReportCandidate` return 409 `REPORT_OFFICIAL_DESIGNATED` (no row written) once the task has an official report; a generation already in flight keeps its attempt and evidence but its candidate reads `superseded`, never `ready`/designatable.
    - Reopening the summary → 409 `SUMMARY_DESIGNATED` (10.3) through the real reports participant; confirm, decision, insight decision, manual insight and AI draft stay refused by the existing confirmed-summary rules; no endpoint can modify or delete the official row.
- **CAP-6** — Real participant in the reopening contract
  - **intent:** Close Epic 10 retro action 2: « unavailable after designation » has a production effect.
  - **success:** `reports` registers a `SummaryReopenParticipant` named `reports` (idempotent, in `register-participants.ts`). `hasOfficialDesignation` is true exactly when `official_reports` has a row for the `taskId` and `submissionId`; `onSummaryReopened` is a no-op (candidate staleness is derived). A reopening of a designated task is refused with nothing written and no participant notified; a task with only candidates reopens as before and its candidates read `outdated`.
- **CAP-7** — Inspect and designate in the report panel
  - **intent:** The Responsable inspects a candidate and designates it with an explicit, irreversible-action confirmation (UX-DR10).
  - **success:** On each `ready` candidate, next to « Télécharger pour inspection », a « Désigner comme officiel » button opens an inline confirmation (« Cette désignation est définitive : le rapport ne pourra plus être remplacé. », actions « Confirmer la désignation » / « Annuler »); one request in flight, « Désignation en cours… », controls disabled meanwhile. After success the panel shows « Rapport officiel » with designation actor/date on the official candidate, « Remplacé — non officiel » on `superseded` candidates, and hides generation, attach and designation controls; the PDF area shows no « Créer un candidat de rapport » control. French alerts for 409 `REPORT_CANDIDATE_NOT_READY`, `REPORT_CANDIDATE_OUTDATED`, `REPORT_ALREADY_OFFICIAL`, `REPORT_OFFICIAL_DESIGNATED` and 404. The panel loads the official report with the evidence reload.

## Constraints

- Written by designation: one `official_reports` row only. Never written: `report_candidates`, `report_candidate_outcomes`, `stored_files`, `stored_file_checks`, evidence, summaries, decisions, reopenings, access rows, drafts, `tasks.updated_at`, object storage. Reads take no review-access row.
- No CETEM rule is invented. Eligibility, freshness and « exactly one » come from the AC, AD-8/AD-9 and the PO decisions (either conformity outcome completes; final conformity is the human decision of 10.4). The system never infers conformity and never checks report content; content acceptance is human and DEP-03.
- Module boundaries: `reports` reads `summaries`, `conformity`, `files` only through their `index.ts`; `summaries` and `conformity` import no `reports` (the participant registry is the only inversion); the route registrar composes modules. `boundaries:check` passes.
- Migration `0025` is additive; existing rows and tests stay valid; any test enumerating migrations is updated by adding it. No new npm dependency, no env variable.
- OpenAPI first: new operations, `OfficialReport`, `ReportDesignateRequest`, `ReportCandidateStatus` extended (`official`, `superseded`), error codes `REPORT_CANDIDATE_NOT_READY`, `REPORT_CANDIDATE_OUTDATED`, `REPORT_ALREADY_OFFICIAL`, `REPORT_OFFICIAL_DESIGNATED`; then generated types, strict zod, typed client. `contracts:check` passes. Existing candidate fields keep their values.
- Web goes through Next route handlers with the CSRF check and the session cookie only. `apps/mobile` untouched; no Employé access.
- Logs: event, actor ID and fixed class only (`report.official.designated`; `report.official.refused` with class `forbidden-role|not-found|not-ready|outdated|already-official`; candidate creation refusal uses `report.candidate.refused` class `official-designated`); never IDs, file names or paths.
- All text in French in `packages/i18n` (`fr.report` additions); internal identifiers English. Tests: synthetic PDFs, `none` or fake scanner, in-memory storage, local PostgreSQL harness (zero skipped). No test deleted, skipped or weakened; no gate script edited. The 11.1/11.3 web assertions « no designation control » are narrowed to « designation control only on `ready` candidates when the task has no official report », all other coverage kept.

## Non-goals

- Authorized history list, read-only completed view, official download endpoint (11.5); asynchronous queue, delayed-completion freshness (11.6); the task `state` column.
- Un-designating, replacing or deleting an official report; a second official report per task; correcting a designated control (replacement audits keep their own lineage and never alter the original official record).
- Inspecting or comparing candidate content; electronic signature (signature cells stay handwritten); e-mail or any notification; automatic designation or automatic conformity.
- Locking PDF upload or rescan in `files` (a stored file is not a report mutation, and `files` must not import `reports`).

## Success signal

PostgreSQL route tests (in-memory storage, `none` and fake scanners) prove: with a confirmed summary and current decision, designating a `ready` Word candidate and a `ready` PDF candidate (separate tasks) each returns 201 `OfficialReport` with origin, actor, date, linkage and bindings equal to the candidate's, writes exactly one `official_reports` row and nothing else, and works for both decision outcomes; the list then reads `official` for it and `superseded` for other formerly `ready` candidates while `outdated`/`failed` ones are unchanged; re-designating the same candidate → 200 with no new row; another candidate → 409 `REPORT_ALREADY_OFFICIAL`; concurrent duplicates → one row; generating, failed → 409 `REPORT_CANDIDATE_NOT_READY`; after a reopening or re-decision, other-submission binding, `outdated` outcome, or a PDF whose file is no longer ready → 409 `REPORT_CANDIDATE_OUTDATED`; unknown/other-team/malformed task or candidate → 404 identical body; Employé 403; invalid body 422; all refusals write nothing; after designation `POST` generate and attach → 409 `REPORT_OFFICIAL_DESIGNATED` with no row, a generation in flight at designation ends `superseded`; summary reopen → 409 `SUMMARY_DESIGNATED` through the real participant while a task without official report still reopens and its candidates read `outdated`; confirm, decision, insight and draft endpoints still refuse; `GET …/official-report` returns 200 for the owner, 404 otherwise; UPDATE, DELETE, TRUNCATE on `official_reports` refused, duplicate task or candidate rejected by PostgreSQL; logs hold no IDs, names or paths.

Web render tests prove: designation control only on `ready` candidates without an official report, inline irreversible confirmation with cancel, designating state with disabled controls, « Rapport officiel » with actor/date and « Remplacé — non officiel » afterwards, generation/attach/designation controls hidden, French alerts for the 409/404 codes, no English text.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, AD-8/AD-9, the code and Product Owner rules. None is a CETEM business rule.

- **Completion = the official row.** `tasks.state` is constrained to `draft` and unused for workflow; the insert-only `official_reports` row is the single completion fact (unique per task), consistent with « derive, don't mutate » used for candidate freshness.
- **Ready candidates may coexist; designation chooses one.** « Superseded » is derived (a formerly `ready` candidate once another is official), not written; « pre-designation replacement preserves history » is met because every candidate row stays.
- **Lock by refusal at the owning module.** `reports` refuses new candidates; the summary-side mutations are already blocked by the confirmed state and by the reopening veto, which becomes real through the participant. PDF upload is not locked (cross-module and not a report mutation).
- **Designation is irreversible and needs UI confirmation**; there is no undo (AC: no later replacement). Idempotent re-designation of the same candidate returns the stored record.
- **Body `{}` and no `attemptId`:** the unique `(task, candidate)` row makes the command naturally idempotent.
- **Official stays official** even if inputs later change; this cannot happen through the API because reopening is vetoed. `official` does not depend on current bindings.
- **Both conformity outcomes designate** (PO decision; AC).

## Open Questions

None blocking. For CETEM via the Product Owner (acceptance only, not this build): whether a designated report may ever be withdrawn through a controlled procedure (not in Phase 1 scope as written).
