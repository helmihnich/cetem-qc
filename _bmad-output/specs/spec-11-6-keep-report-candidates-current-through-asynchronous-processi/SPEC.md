---
id: SPEC-11-6-keep-report-candidates-current-through-asynchronous-processi
story: 11.6
status: approved
approved: 2026-10-08
baseline_commit: 77e21c6
companions:
  - test-plan.md
  - ../spec-11-1-generate-an-inspectable-word-report-candidate/SPEC.md
  - ../spec-11-2-validate-scan-and-store-a-manual-pdf-file/SPEC.md
  - ../spec-11-3-create-a-report-candidate-from-a-ready-pdf/SPEC.md
  - ../spec-11-4-designate-exactly-one-current-report-official/SPEC.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md (Story 11.6)
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md (AD-8, AD-9)
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 11.6 — Keep report candidates current through asynchronous processing

## Why

**Pain.** Report work spans time: a Word generation runs between its two transactions (11.1), a PDF is scanned outside any transaction (11.2), and the Responsable may reopen the summary, re-decide, or accept a newer audit revision meanwhile. Stories 11.1–11.4 derive freshness on read and recheck at designation, but two seams still let obsolete work look current (AD-8):

1. **Generation completion** (`generateReportCandidate`, transaction B) checks only the bound summary and decision *of the candidate's own submission*. A newer accepted submission (another audit revision) is not checked, so the stored outcome can read `ready` for an obsolete revision.
2. **File scan completion.** A PDF candidate lists as `ready` while its file is no longer `ready` in `files` (e.g. a later scan row), yet designation refuses it (`REPORT_CANDIDATE_OUTDATED`). List and designation disagree, and the panel offers a control that cannot succeed.

**Story statement.** As a Responsable, I want completed generation and scan operations checked against current workflow versions, so that delayed work cannot make an obsolete report designatable.

**What this delivers.** No migration, no new route, no new env variable, no queue. A completion-time freshness check on audit revision, a file-readiness term in the derived candidate status through the existing `files` contract, hardening tests for every delayed-completion ordering, and the matching panel behavior. Generation and scanning stay synchronous in the request (PoV; NFR-005 target unchanged); « asynchronous » means any gap between binding and completion, which the check covers whether the gap is milliseconds or a future worker.

**Traceability.** FR-035, AD-8, AD-9, UX-DR10, UX-DR13. Depends on 11.1–11.5 (done).

## Capabilities

- **CAP-1** — Generation completion rechecks all three bindings
  - **intent:** A generated Word result becomes `ready` only if, at completion under the per-task lock, the audit revision, summary version and conformity decision it was bound to are still the current ones. Otherwise the attempt and the stored binary are kept, the outcome is `outdated`, and the candidate is not designatable.
  - **success:** In transaction B (already under `lockTaskSummary`) the server compares the candidate's `submission_id` and `audit_revision` with the current accepted submission of the task (read for the same Responsable via `getAcceptedSubmissionForReview`), and the bound summary id and decision id with the current ones. Any difference, or a task no longer readable for that Responsable, records outcome `outdated` (file name, size, SHA-256 and storage ref retained) and returns the existing 409 `REPORT_INPUTS_CHANGED`. Equal → `ready` as today. A newly accepted audit revision between insert and completion therefore yields `outdated`, never `ready`.
- **CAP-2** — Candidate status reflects the file's current readiness
  - **intent:** The list never offers designation for a PDF candidate whose file `files` no longer derives as `ready`.
  - **success:** `presentCandidateRows` consumes the `files` contract (`getFileScanResults`: `null` = not ready) and reads such a `ready`/`superseded`-would-be candidate as `outdated`; `official` is unaffected (permanent). The candidate row, outcome and file are not written; if the file later reads `ready` again (successful rescan of a `scan-failed` file cannot revert a `threat`), the candidate reads `ready` again. List status and designation eligibility agree for every ordering. Reports import only `files/index.ts`.
- **CAP-3** — Delayed results never reach `ready` by another path
  - **intent:** Every ordering of delayed completion against changes leaves a non-designatable candidate when inputs are stale, with history preserved.
  - **success:** Proven by tests (see test-plan): summary reopen, re-decision, new audit revision and official designation of another candidate, each occurring between insert and completion of a generation; a scan result row appended or a rescan finished after a PDF candidate exists; attach of a file whose scan completes only after the attach request started. In every case: no candidate or outcome row is rewritten, designation → 409 `REPORT_CANDIDATE_OUTDATED` (or `REPORT_ALREADY_OFFICIAL` after another official), the retained binary stays downloadable for inspection of `outdated` candidates, and a fresh generation or attach (new attempt) can become `ready`.
- **CAP-4** — Panel never implies success before completion
  - **intent:** UX-DR13: no success, « Prêt » or designation control while generation, scan or recheck is unresolved.
  - **success:** The panel keeps « Génération en cours… » while the request is in flight and shows the French outdated alert (`fr.report.inputsChanged`) plus the candidate as « Obsolète — les données ont changé » when the completion returns 409 `REPORT_INPUTS_CHANGED`; a PDF candidate whose file is no longer ready shows « Obsolète » and no designation control; after any report action the candidate list is re-read from the server so a status changed meanwhile is shown. No new French string is required unless a label is missing; any addition goes in `fr.report`.

## Constraints

- Written: nothing new. The only write change is which existing outcome value (`ready` vs `outdated`) transaction B records. Candidate and outcome tables stay insert-only; no row is updated or deleted; no migration.
- Freshness stays **derived on read** plus **checked under the per-task lock at every state change** (completion, attach, designation); no stored flag, no background job, no polling endpoint. A real queue or worker is not introduced (no deployment need in PoV; AD-11).
- Boundaries: `reports` reads `summaries`, `conformity`, `audits` read queries and `files` only through their `index.ts` / existing query modules; no import of `files` repositories or tables; `files` imports no `reports`. `boundaries:check` passes. « File-scan completion is consumed through the files contract »: the contract is the derived status exposed by `getStoredFileStatus` / `getFileScanResults`; no new event bus.
- No CETEM rule is invented. « Current » means equal to the current accepted submission/revision, confirmed summary and human conformity decision (AC); the system never infers conformity and never inspects report content (DEP-03).
- OpenAPI, generated types and typed client unchanged (the 409 `REPORT_INPUTS_CHANGED` and `outdated` status already exist); `contracts:check` passes.
- Logs: event, actor ID, fixed class only; completion-time staleness logs `report.candidate.refused` class `inputs-changed` as today; no IDs, names or paths.
- All text French in `packages/i18n`; no test deleted, skipped or weakened; no gate script edited. Tests use the local PostgreSQL harness, in-memory storage, `none` or fake scanners, synthetic PDFs; no real AI or client data.

## Non-goals

- A job queue, worker process, webhook or event bus; real-time push or polling of statuses (the panel re-reads on action).
- Rewriting history: no un-superseding, no candidate deletion, no automatic regeneration after a change.
- Un-quarantining a `threat` file; changing scan rules or the scanner port; locking PDF upload (11.4 decision).
- Changing designation rules, the history/download endpoints (11.5), or the `tasks.state` column.
- Any CETEM business rule (report content, retention, withdrawal of an official report).

## Success signal

PostgreSQL route/command tests (in-memory storage; a seam that pauses generation between insert and completion, as in 11.1 R15) prove: for each of reopen, re-decision, newer accepted audit revision (new submission/revision for the same task) and designation of another candidate occurring during generation, the completion records the correct outcome (`outdated`, or `ready` then `superseded` for the official case), keeps the object and attempt, responds 409 `REPORT_INPUTS_CHANGED` for stale inputs, and the candidate is never designatable; an unchanged run still returns 201 `ready` and is designatable. For a PDF candidate, a later non-ready file state (threat row, unavailable scan row inserted by the harness) makes the list read `outdated`, designation 409 `REPORT_CANDIDATE_OUTDATED`, and the list status equals designation eligibility in every case; an `official` candidate is unaffected. Row-count snapshots show no write beyond the one outcome row; no storage or scanner call from designation; logs hold no IDs, names or paths. Web render tests prove the in-flight, outdated and file-not-ready states and the absence of a designation control for them, with no English text.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

Follow from the AC, AD-8/AD-9, the code and Product Owner rules; none is a CETEM business rule.

- **Stale at completion → `outdated` outcome, not a new `superseded` state.** 11.1 already stores `outdated` with the retained binary; `superseded` remains the derived « another candidate is official » state (11.4).
- **Audit revision checked by the accepted-submission read.** A newer revision is a different `submission_id`, so comparing it (and `audit_revision`) at completion closes the gap; summary and decision ids are compared as today.
- **Unreadable task at completion = outdated.** Fail closed: nothing becomes `ready` if currency cannot be established.
- **File readiness in the list is derived, not stored**, matching « derive, don't mutate » (11.4) and the single `files` status derivation; the `files` contract needs no change.
- **No queue now.** The AC concerns correctness when completion is late; the lock-and-recheck design is independent of how the work is scheduled, so a future worker reuses it unchanged.

## Open Questions

None blocking.

## Code review (2026-10-08)

Result: approved, no patch needed. All gates pass (`pnpm -r test`, `-r typecheck`, `boundaries:check`, `contracts:check`, `git diff --check`).

- Rejected: no test for A3 (newer accepted audit revision). `audit_submissions.audit_id` is UNIQUE (migration 0009, « exactly one accepted submission per audit »), so a second accepted revision of a task cannot be created today; the submission/revision comparison in transaction B is a defensive fail-closed check, exercised through A4 (task unreadable) and R15/R16.
- Rejected: A5, A7, B3, B4 and the web tests W1–W4 are not added in this diff. The behaviors they cover are pre-existing and already tested by 11.1–11.5 (R15/R16, R11/R12, official-report and PDF files route tests, `report-candidates-render.test.tsx`); the only new behavior (CAP-1 recheck, CAP-2 file readiness) is covered by A4 and B1/B2.
- Checked: `fileNotReady` applies only to `ready`/`superseded`-derived candidates, so an `official` PDF candidate stays official; no write added; no import boundary change.
