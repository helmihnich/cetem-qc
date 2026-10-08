---
id: SPEC-11-3-create-a-report-candidate-from-a-ready-pdf
story: 11.3
status: approved
approved: 2026-10-08
baseline_commit: eb9366b
companions:
  - pdf-candidate-model.md
  - test-plan.md
  - ../spec-11-1-generate-an-inspectable-word-report-candidate/SPEC.md
  - ../spec-11-1-generate-an-inspectable-word-report-candidate/report-candidate-model.md
  - ../spec-11-2-validate-scan-and-store-a-manual-pdf-file/SPEC.md
  - ../spec-11-2-validate-scan-and-store-a-manual-pdf-file/pdf-file-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md (AD-8, AD-9)
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 11.3 — Create a report candidate from a ready PDF

## Why

**Pain.** Story 11.2 stores a validated, scan-clean manual PDF but it is only a file: it has no report meaning. Designation (11.4) works on report candidates, so a `ready` PDF must become a candidate bound to the same audit revision, confirmed summary and conformity decision as a Word candidate (FR-034, FR-035, AD-8), while `files` keeps the binary (AD-9).

**Story statement.** As a Responsable, I want a validated, scanned PDF represented as a report candidate, so that report lifecycle rules can use a safe file without taking ownership of file storage.

**What this delivers.** One additive migration (`0024`) letting `report_candidates` carry an `uploaded-pdf` origin and a reference to a stored file; one command and one route that attach a `ready` file; PDF candidates in the existing candidate list and download; a « Créer un candidat de rapport » action in the PDF area of the W5 panel. No designation, no completion (11.4).

**Traceability.** FR-034, FR-035, AD-8, AD-9, UX-DR2 (report-panel), UX-DR10. Depends on 11.1 (done: `report_candidates`, binding and freshness derivation, candidate routes/panel) and 11.2 (done: `files` `getReadyFile`/`readStoredFile`). Hands off to 11.4 (designates a `ready` candidate of either origin) and 11.6. DEP-03 governs report-*content* acceptance of generated Word documents; a hand-prepared PDF's content is not checked by the system.

## Capabilities

Migration, command, queries, routes, contract and web details are in [pdf-candidate-model.md](pdf-candidate-model.md); test IDs in [test-plan.md](test-plan.md).

- **CAP-1** — Attach a ready PDF as a candidate
  - **intent:** The Responsable of the owning team turns a `ready` stored PDF of a report-eligible task into a report candidate (same eligibility as 11.1/11.2: accepted audit, summary confirmed, conformity decision current, either outcome).
  - **success:**
    - `POST /api/v1/tasks/{taskId}/pdf-files/{fileId}/report-candidate` with body `{ "attemptId": uuid }` (strict) returns 201 `ReportCandidate` with `origin: "uploaded-pdf"`, `status: "ready"`.
    - The candidate is immutably bound to audit revision (`auditId`, `revision`, `submissionId`), confirmed summary (`id`, `version`), conformity decision `id`, the stored file (`id`, size, SHA-256, name) and the `attemptId`; actor and date come from the session and server clock.
    - Refusals write nothing: Employé 403; malformed/unknown/other-team/draft/no-audit task, or malformed/unknown/other-task file → 404 `TASK_NOT_FOUND` (body identical to 9.1); invalid body → 422 `VALIDATION_FAILED`; summary open 409 `SUMMARY_NOT_CONFIRMED`; confirmed without decision 409 `CONFORMITY_NOT_DECIDED`.
- **CAP-2** — Only a clean, validated file can become a candidate
  - **intent:** A file that is rejected, quarantined, scan-pending, scan-failed or storage-failed never becomes a candidate, so it can never be Ready or designated.
  - **success:** The command asks `files` (`getReadyFile`, derived status `ready`) inside the same transaction that inserts the candidate; any other status → 409 `REPORT_FILE_NOT_READY` and no row. A `ready` file that was scanned with `none` carries the PoV scan note on the candidate (`scanResult`). Uploading, validation and scanning remain 11.2 and are not repeated here.
- **CAP-3** — Immutable input bindings and derived freshness
  - **intent:** A PDF candidate cannot present obsolete inputs as current (AD-8).
  - **success:** Status is derived on every read exactly as for Word candidates: `ready` while the bound summary id and decision id are still the current ones and the submission is current, otherwise `outdated`; a later reopening or re-decision makes it `outdated` and it stays listed and downloadable. Nothing is written to existing tables by a reopening. A PDF candidate has no `generating` or `failed` state.
- **CAP-4** — Idempotent, no duplicate attachment
  - **intent:** A retried request does not create a second candidate; one file is not attached twice to the same inputs.
  - **success:** The same `attemptId` for the same task and file returns the stored candidate (200), writes nothing; the same `attemptId` for another task, another file or a Word attempt → 409 `REPORT_ATTEMPT_CONFLICT`. The same file with a new `attemptId` while a candidate for that file and the same summary and decision bindings already exists → 409 `REPORT_FILE_ALREADY_ATTACHED`; after a reopening and re-confirmation the file may be attached again to the new bindings (history preserved). Concurrent requests with one `attemptId` or one file+bindings leave one candidate.
- **CAP-5** — Reports own metadata; files own the binary
  - **intent:** Report lifecycle never owns file storage (AD-9).
  - **success:** `report_candidates` stores origin, bindings, the opaque `stored_file_id` and a copy of display name, size and SHA-256 for display and later integrity checks; it stores no storage key and never reads `stored_files` or calls `ObjectStorage`. The `reports` module reaches `files` only through `files/index.ts` (`getReadyFile`, `readStoredFile`). Candidate and download of a PDF candidate read bytes through `readStoredFile`.
- **CAP-6** — List and inspect both origins
  - **intent:** The Responsable sees Word and PDF candidates in one newest-first list and downloads the PDF to inspect it.
  - **success:** `GET …/report-candidates` returns both origins with `origin`, derived `status`, bindings, file metadata and, for PDF, `source: { fileId, scanResult }`; `template` is `null` for PDF. `GET …/report-candidates/{candidateId}/file` for a PDF candidate returns the stored PDF (`application/pdf`, `Content-Disposition: attachment; filename="Rapport-LCQ-candidat-{yyyymmdd}-{8 hex of candidate id}.pdf"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`) while its file is `ready` and the owner's team; anything else → 404 `TASK_NOT_FOUND`. Word behavior is unchanged.
- **CAP-7** — Action in the report panel
  - **intent:** The Responsable attaches a ready PDF from the W5 panel (UX-DR2 report-panel).
  - **success:** In « Rapport PDF manuel », each `ready` file shows « Créer un candidat de rapport » when the panel is eligible and the file has no current candidate (one request in flight, label « Création en cours… », control disabled meanwhile, new `attemptId` per click, reused only for an automatic transport retry). A file with a current candidate shows « Candidat créé — non officiel ». Non-ready files show no such control. The candidate list labels the origin (« PDF importé » / « Word généré »), « Candidat — non officiel », the status labels of 11.1 (without « En cours »/« Échec de génération » for PDF) and « Télécharger pour inspection ». French alerts for 409 `REPORT_FILE_NOT_READY`, `REPORT_FILE_ALREADY_ATTACHED`, summary/decision refusals and 404. No « Désigner comme officiel » control.

## Constraints

- Written by attachment: one `report_candidates` row and one `report_candidate_outcomes` row (insert-only; same transaction). Never written: `stored_files`, `stored_file_checks`, evidence, summaries, decisions, reopenings, access rows, drafts, `tasks.updated_at`, object storage. Reads take no review-access row.
- No CETEM rule is invented. Eligibility, bindings, statuses and « non officiel » come from 11.1/11.2, AD-8/AD-9 and the PO decisions. The system does not inspect, compare or validate the PDF's report content against the form values (PO: the PDF is manually prepared; content acceptance is human and DEP-03).
- Module boundaries: `reports` imports `files` only through `files/index.ts`; `files` imports no `reports`; the route registrar composes `audits`, `summaries`, `conformity`, `files` and `reports`. `boundaries:check` passes.
- Migration `0024` is additive and relaxes only what the PDF origin needs (see model). Existing Word rows and constraints stay valid; any test enumerating migrations is updated by adding it. No new npm dependency, no env variable.
- OpenAPI first: new operation, `ReportFromPdfRequest`, `ReportCandidate` extended (`origin` enum, `template` nullable, `source`), error codes `REPORT_FILE_NOT_READY`, `REPORT_FILE_ALREADY_ATTACHED`; then generated types, strict zod, typed client. `contracts:check` passes. Existing Word fields keep their values.
- Web goes through Next route handlers with the CSRF check and the session cookie only. `apps/mobile` untouched; no Employé access.
- Logs: event, actor ID and fixed class only (`report.candidate.attached`; `report.candidate.refused` with class `forbidden-role|not-found|not-confirmed|not-decided|attempt-conflict|file-not-ready|already-attached`); never IDs, file names or paths.
- All text in French in `packages/i18n` (`fr.report`, `fr.pdfFile` additions); internal identifiers English. Tests: synthetic PDFs, `none` or fake scanner, in-memory storage, local PostgreSQL harness (zero skipped). No test deleted, skipped or weakened; no gate script edited. The 11.2 web assertions « no candidate-creation control » are narrowed to « candidate-creation control only on a `ready` file when eligible; no designation control », all other coverage kept.

## Non-goals

- Designation, completion, locking, official download, history (11.4/11.5); asynchronous freshness queue (11.6).
- Inspecting, parsing or comparing the PDF's content; page count; PDF preview; re-scanning on attach (the 11.2 status is authoritative); uploading or replacing files; deleting a candidate; converting Word to PDF; electronic signature.
- Attaching non-PDF or non-`manual-pdf` files; candidates without a stored file.

## Success signal

PostgreSQL route tests (in-memory storage, `none` and fake scanners) prove: for a confirmed summary with a current decision, a `ready` uploaded file attached with a new `attemptId` returns 201 `uploaded-pdf`/`ready` with bindings equal to the current audit revision, summary id/version and decision id, the file's id/size/SHA-256, one candidate row and one outcome row, no storage key stored in `reports` tables and no new object; both decision outcomes work; the candidate is listed together with Word candidates newest first and its download returns the exact uploaded bytes with the required headers; rejected, quarantined, `scan-failed`, forged `scan-pending` and `storage-failed` files each return 409 `REPORT_FILE_NOT_READY` with nothing written; unknown, malformed, other-task and other-team file or task → 404 identical body, Employé 403, summary open 409, no decision 409, invalid body 422, all writing nothing; replay of an attempt → 200 same candidate, another file/task/Word attempt → 409 `REPORT_ATTEMPT_CONFLICT`, same file and same bindings with a new attempt → 409 `REPORT_FILE_ALREADY_ATTACHED`, concurrent duplicates → one candidate; after a reopening the candidate lists as `outdated`, stays downloadable, and the same file can be attached to the new bindings after re-confirmation and a new decision; Word candidate behavior, tests and bytes are unchanged; UPDATE, DELETE, TRUNCATE on both tables stay refused; nothing in `stored_*`, evidence, summaries, decisions or `tasks.updated_at` changes; logs hold no IDs, names or paths.

Web render tests prove: create control only on `ready` files when eligible, creating state, « Candidat créé — non officiel » afterwards, origin labels, download link, French alerts for 409/404, no designation control, no English text.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, AD-8/AD-9, the code and Product Owner rules. None is a CETEM business rule.

- **Origin value `uploaded-pdf`**, next to `generated-word` (AC: « origin »). Candidate status `ready` for a PDF means: file `ready` at attach time and bindings still current. A PDF needs no generation step, so its outcome row is written in the same transaction as the candidate.
- **Same eligibility and bindings as Word candidates** (summary confirmed, decision current, either outcome), taken from the snapshot under `lockTaskSummary`, so 11.4 treats both origins identically. The PDF's content is not bound to or checked against the summary text.
- **Reports keeps no storage key**: the binary stays behind `files`; the candidate stores `stored_file_id` plus display name, size and SHA-256 copies. `storage_ref` of the outcome becomes nullable for this origin only.
- **File status checked once, inside the attach transaction.** Checks are insert-only and a `ready` file cannot regress (`threat` rows are final and never written after `ready`), so no later recheck is needed; download still goes through `readStoredFile`, which re-derives `ready`.
- **`ready` file attach is explicit and never automatic**: upload (11.2) does not create a candidate.
- **One candidate per file and bindings**; re-attaching after changed bindings is allowed, preserving history. A file can therefore appear in several (historical) candidates.
- **Attempt IDs share the `report_candidates.attempt_id` uniqueness** with Word attempts (client-generated operation ID, architecture convention).
- **Separate attach route under the file** (`/pdf-files/{fileId}/report-candidate`) rather than overloading the Word generation body, keeping the strict Word request unchanged.

## Open Questions

None blocking. For CETEM via the Product Owner (acceptance only, not this build): whether a hand-prepared PDF should be checked against the confirmed summary or decision before designation (not in Phase 1 scope as written).
