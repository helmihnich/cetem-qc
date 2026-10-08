---
id: SPEC-11-1-generate-an-inspectable-word-report-candidate
story: 11.1
status: in-review
approved: 2026-10-08
baseline_commit: 0b0b6f3
companions:
  - report-candidate-model.md
  - report-template.md
  - test-plan.md
  - ../spec-10-4-record-the-explicit-human-machine-conformity-decision/SPEC.md
  - ../spec-10-4-record-the-explicit-human-machine-conformity-decision/conformity-decision-model.md
  - ../spec-10-2-write-edit-and-explicitly-confirm-a-summary/summary-confirmation-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - docs/product/source/formulaire-cetem/ (4 photos, pages 1/4 to 4/4)
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 11.1 — Generate an inspectable Word report candidate

## Why

**Pain.** Epic 10 ends with a confirmed summary and an explicit human machine-conformity decision, but nothing yet produces the printable report. FR-035/FR-041 require a Word document the Responsable can inspect before it can become official (Story 11.4), reproducing the signed CETEM paper report, with handwritten-signature zones and no electronic signature.

**Story statement.** As a Responsable, I want to generate a Word report candidate from current audit workflow inputs, so that I can inspect the proposed printable document before official designation.

**What this delivers.** The first task of Epic 11 (route registration extracted from `apps/api/src/index.ts`); a `reports` module and a minimal `files` module (object-storage port); two insert-only tables; a pure report-document builder in `packages/i18n`; a zero-dependency `.docx` writer adapter; three routes (generate, list, download); a « Rapport » panel in the W5 review panel. Official designation, manual PDF, history and asynchronous freshness are Stories 11.2–11.6.

**Traceability.** FR-035, FR-041, NFR-005, DR-009, AD-8, AD-9, UX-DR2 (report-panel, loading-state), UX-DR10; DEP-03 (final content acceptance only). Depends on 10.1–10.4 (done). Hands off to 11.4 (designates a candidate, rechecks the bindings stored here) and 11.6 (asynchronous freshness).

## Capabilities

Tables, ports, routes, contract and web details are in [report-candidate-model.md](report-candidate-model.md); the document content in [report-template.md](report-template.md); test IDs in [test-plan.md](test-plan.md).

- **CAP-1** — Generate a candidate from eligible inputs
  - **intent:** The Responsable of the owning team requests Word generation for a task whose audit is accepted, summary confirmed and conformity decision current (either outcome).
  - **success:**
    - `POST /api/v1/tasks/{taskId}/report-candidates` with body `{ "attemptId": uuid }` (strict) generates one `.docx`, stores it privately and returns 201 `ReportCandidate` with `status: "ready"`.
    - The candidate is bound immutably to: audit revision (`auditId`, `revision`, `submissionId`), confirmed summary (`id`, `version`), conformity decision `id`, and the `attemptId`. Actor and dates come from the session and server clock.
    - Refusal classes of 10.2/10.3/10.4 apply (Employé 403, malformed/unknown/other-team/draft/no-audit 404 identical to 9.1). Summary open → 409 `SUMMARY_NOT_CONFIRMED`; confirmed but no current decision → 409 `CONFORMITY_NOT_DECIDED`; no row written in either case.
- **CAP-2** — Candidate is private, versioned and not official
  - **intent:** The binary is never public, never a database blob and never official in this story.
  - **success:** The `.docx` is written through the `files` object-storage port; PostgreSQL holds only metadata and an opaque storage reference plus size and SHA-256. Each attempt is a new candidate (history preserved, nothing overwritten). No field, status, route or label in this story designates, completes or marks anything official; the panel states « Candidat — non officiel ».
- **CAP-3** — Generation failure is recoverable
  - **intent:** A failed generation or storage never completes the control and can simply be retried.
  - **success:** A generator or storage failure records an outcome row `failed` with a fixed class (`generation-failed` | `storage-failed`), returns 502 `REPORT_GENERATION_FAILED` with a French message, leaves summary, decision, audit and task untouched, and a later request with a **new** `attemptId` succeeds. Replaying a failed `attemptId` returns the same 502 and creates nothing. Partial files of a failed attempt are removed best-effort and never referenced.
- **CAP-4** — Idempotent by attempt
  - **intent:** A retried request does not create a second candidate.
  - **success:** The same `attemptId` for the same task returns the stored candidate (200 for `ready`, 502 for `failed`), writes nothing, calls neither generator nor storage. The same `attemptId` for another task → 409 `REPORT_ATTEMPT_CONFLICT`, nothing written. Two concurrent requests with one `attemptId` produce exactly one candidate.
- **CAP-5** — Inputs are rechecked when generation completes
  - **intent:** A delayed completion cannot present an obsolete candidate as current (AD-8).
  - **success:** The candidate row is inserted (bindings captured) in a first transaction; the document is generated outside any database transaction; a second transaction takes `lockTaskSummary` and records the outcome. If the bound summary id or decision id is no longer the current one (reopened or re-decided meanwhile), the outcome is `outdated` (file retained, never `ready`) and the response is 409 `REPORT_INPUTS_CHANGED`. Candidate status is also derived on every read (CAP-6): a `ready` outcome whose bindings are no longer current reads as `outdated`. Nothing is written to existing tables by a reopening.
- **CAP-6** — List and inspect
  - **intent:** The Responsable lists candidates and downloads the Word file to inspect it.
  - **success:**
    - `GET /api/v1/tasks/{taskId}/report-candidates` → `{ candidates: ReportCandidate[] }` newest first, each with derived `status` (`generating` | `ready` | `failed` | `outdated`), bindings, file metadata (name, size, SHA-256) and `failureClass`. 
    - `GET /api/v1/tasks/{taskId}/report-candidates/{candidateId}/file` returns the stored `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`) for the owning Responsable and a candidate whose outcome retained a file (`ready` or `outdated`). Anything else, including another team's candidate, → 404 `TASK_NOT_FOUND` with the 9.1 body.
- **CAP-7** — Document reproduces the official paper report
  - **intent:** The `.docx` is the CETEM paper report « Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie N° …/LCQ » filled with the accepted data (FR-041, PO decision).
  - **success:** Sections, tables, order and French labels follow [report-template.md](report-template.md) (pages 1/4–4/4 of the photos), the CETEM BH logo `docs/product/source/cetem-logo.png` is in the header, measurements and calculated values at full precision with the per-test verdict, comments, « Conclusion générale » (decision + confirmed summary), « Contrôle effectué par ». Every « Signature » cell is empty. No electronic signature, no stamp, no watermark claiming officiality. A missing optional value renders an empty cell, never an invented one.
- **CAP-8** — Report panel
  - **intent:** The Responsable requests and inspects candidates in the W5 panel (UX-DR2 report-panel, loading-state).
  - **success:** Area « Rapport Word (candidat) » below the conformity decision. Eligible (summary confirmed and decision current): button « Générer le rapport Word » (one request in flight; label « Génération en cours… » with the loading state; button disabled meanwhile). Not eligible: no button; text « Le rapport pourra être généré après la confirmation de la synthèse et l’enregistrement de la décision de conformité. ». List shows per candidate: « Candidat — non officiel », status label (« Prêt à inspecter », « Échec de génération », « Obsolète — les données ont changé », « En cours »), date, author, summary version, decision label, and for ready/outdated a « Télécharger pour inspection » link. On 502 the French failure message and « Réessayer » (new `attemptId`); on 409 it reloads state and shows the French message. No « Désigner comme officiel » control, no upload control.

## Constraints

- Written by generation: `report_candidates`, `report_candidate_outcomes` (insert-only, triggers as `confirmed_summaries`) and one object in storage. Accepted evidence, summaries, reopenings, decisions, invalidations, insights, access rows, drafts and `tasks.updated_at` are never written. Reads take no review-access row.
- No CETEM rule is invented. Content and labels come from the paper-form photos and the PO decisions in « Confirmed decisions ». Anything the paper form does not show is not added (no extra provenance block, no insight list, no invented footer). DEP-03 gates **final acceptance** of the content, not this build; the candidate is by definition not official.
- Calculations are never recomputed for the report: values and per-test verdicts are read from the stored server `results` of the accepted snapshot (calculated by `packages/domain`, rule `cetem-paper-form` 2.0.0). Results whose identity tuple is unsupported render as « indisponible — version de règles non prise en charge ». The report builder reads no AI draft and calls no provider. Light-field verdict stays « indisponible » (PO).
- Module boundaries: `reports` imports from `summaries`, `conformity`, `audits`, `files` only through `index.ts`, `commands/`, `queries/`, `contracts/`, `ports/`. `files` imports no business module. `conformity` gains an `index.ts` public query export (`getCurrentConformityDecision`) if not already public. `boundaries:check` passes.
- Ports with adapters (AD-9): `ReportDocumentGenerator` (adapter `word-template`, the zero-dependency writer) and `ObjectStorage` (adapters `local` default, `memory` for tests). Env `FILE_STORAGE_DIR` (default `.data/files`, outside any served directory, added to `.gitignore`) and `FILE_STORAGE=local|memory`; both in `.env.example` with empty values. No external account, SDK, cloud storage or paid service; cloud object storage is an Epic 12 deployment adapter. No new npm dependency: the `.docx` (OOXML in a ZIP) is written with `node:zlib` (`crc32`, `deflateRawSync`).
- OpenAPI first: operations, `ReportCandidate`, `ReportCandidateRequest`, `ReportCandidateList`, error codes `CONFORMITY_NOT_DECIDED`, `REPORT_GENERATION_FAILED`, `REPORT_INPUTS_CHANGED`, `REPORT_ATTEMPT_CONFLICT`; then generated types, strict zod, typed client. `contracts:check` passes. `AcceptedEvidenceResponse` is unchanged. Web goes through Next route handlers with the CSRF check and session cookie only (the file handler streams bytes with the same headers).
- Migration `0022` is additive. Any test enumerating migrations is updated by adding it.
- Task 0 (prerequisite, Epic 10 retro item 37): extract route registration from `apps/api/src/index.ts` into per-module registrars before adding the report routes. Behaviour-preserving: no route path, status, header, log or body changes; all existing tests pass unmodified. At minimum the new report routes live in their own registrar; existing routes are moved verbatim into registrars per module so `index.ts` only builds the app and calls them.
- Logs carry event, actor ID and fixed class only (`report.candidate.generated`, `report.candidate.failed` with class, `report.candidate.refused` with class `forbidden-role|not-found|not-confirmed|not-decided|attempt-conflict|inputs-changed`, `report.candidate.downloaded`); never task, candidate, summary or decision IDs, file names, text or paths.
- All text in French in `packages/i18n` (`fr.report`); internal identifiers English. Download file name is `Rapport-LCQ-candidat-{yyyymmdd}-{first 8 hex of candidate id}.docx` (no client or task data). `apps/mobile` untouched; no Employé access. Tests: synthetic names, in-memory storage, local PostgreSQL harness (zero skipped). No test deleted, skipped or weakened; no gate script edited. The 10.4 assertions « the panel shows no report control » (web tests) are superseded and narrowed to « no designation control, no upload control, and no report control unless eligible », with all other coverage kept.

## Non-goals

- Official designation, completing the workflow, locking, `hasOfficialDesignation` participant (11.4); the reopen participant of `reports` (11.4/11.6; here outdated is derived by binding).
- Manual PDF upload, validation, antivirus, `files` binary validation/scan (11.2); PDF candidates (11.3); history views and official download (11.5); asynchronous queue/worker processing (11.6; generation here is synchronous in the request, target ≤ 30 s p95 per NFR-005, not asserted by a test).
- Electronic signature, signed-scan upload, PDF rendering of the Word file, an in-browser preview of the document body, email or notifications.
- Deleting or editing a candidate; choosing a template version in the UI; a second template.
- Deploying or provisioning storage.

## Success signal

PostgreSQL route tests (in-memory storage, real domain results) prove: confirm a summary and record a decision, then `POST` returns 201 `ready` with bindings equal to the current audit revision, summary id/version and decision id, one candidate row, one outcome row, one stored object whose SHA-256 and size match the response; both outcomes (`machine-conforme`, `machine-non-conforme`) generate; the downloaded file is a valid ZIP whose `word/document.xml` contains the filled labels and values of [report-template.md](report-template.md) and empty signature cells; no candidate is official and nothing else is written; summary open → 409 `SUMMARY_NOT_CONFIRMED`, confirmed without decision → 409 `CONFORMITY_NOT_DECIDED`, no rows; a throwing generator and a throwing storage each give 502, a `failed` outcome, no stored object referenced, no change to summary/decision/task, then a new `attemptId` yields 201; replay of a ready attempt → 200 same candidate with no second generator/storage call; one `attemptId` on two tasks → 409; two concurrent requests with one `attemptId` leave one candidate; a reopen between insert and completion yields `outdated` and 409 `REPORT_INPUTS_CHANGED`; after a later reopen a `ready` candidate lists as `outdated` and stays downloadable; list is newest first and team-scoped; download returns the exact bytes with the required headers, and another team's, unknown, failed or `generating` candidate → 404; Employé 403 and every 404 class write nothing; UPDATE, DELETE, TRUNCATE on both tables are refused; logs hold no IDs, names or paths.

Unit tests prove the `packages/i18n` builder reproduces every section of the paper report from a full fixture and from a sparse one, per-test OUI/NON marks follow the stored verdicts, and the `.docx` writer output is a valid, deterministic-content package (content types, relationships, logo media part).

Web render tests prove: no button before eligibility (explanatory text), button when eligible, loading state, success list entry with « Candidat — non officiel » and download link, 502 retry with a new `attemptId`, 409 handling, outdated label after a reopening, no designation or upload control, no English text.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, the paper form, the code and the Product Owner rules. None is a CETEM business rule.

- **Candidate only; never official** (AC; PO « final conformity is always human »): eligibility requires a current decision of either outcome; the outcome is printed, never inferred. Both outcomes generate identically.
- **Word template = the paper report** (PO decision): sections, tables, order and French labels from the four photos; logo in the header; « Signature » cells empty; « Contrôle approuvé par » keeps the printed approver cells as on the paper form.
- **Per-test OUI/NON boxes** mirror the stored suggested verdict (Story 6.6): `conforme` marks OUI, `non-conforme` marks NON, `indisponible` marks neither and prints « indisponible » with its reason. The paper tolerances are printed as on the form. The verdict is suggested; « Conclusion générale » carries the human decision.
- **« Conclusion générale »** = the line « Machine conforme » or « Machine non conforme » (the recorded decision) followed by the confirmed summary text. The paper form leaves the section free-form; this uses only data the AC require the candidate to be bound to.
- **No new npm dependency**: a minimal OOXML/ZIP writer (stored content is plain text XML, `deflateRawSync`, `crc32` from `node:zlib`, Node 24) removes the install risk of the unattended pipeline and the supply-chain surface; a library can replace the adapter behind the port later.
- **`files` module starts here with the storage port only.** Report files need private object storage (AD-9); 11.2 adds validation, scanning and PDF handling on top. Local filesystem adapter is the PoV default (no accounts); a cloud adapter is deployment work (Epic 12).
- **Synchronous generation inside the request, with insert-then-complete transactions**, so the bindings are captured before generation and rechecked after (AD-8). Real asynchronous queueing is 11.6.
- **Currentness by binding, derived on read** (same rule as 10.4): no participant is needed in this story, a reopening needs no write to reports.
- **Idempotency by client-generated `attemptId`** (architecture « operation ID » convention); a failed attempt is final, a retry uses a new ID.
- **Provenance in the report is limited to what the paper form prints**: measurements, formulas' calculated values, tolerances, verdicts. Internal provenance (rule id/version, summary input-set id, AI draft provenance, insights) is kept in the system and in the candidate bindings, not printed (PRD: « do not silently force every internal provenance field into the report »; exact presentation is DEP-03). The document carries no « candidat » or « non officiel » mark: the same file may be designated official by 11.4 without regeneration, so the candidate status lives in the application (panel, metadata), never in the printed document.
- **Download is an authorized endpoint**, not a public or pre-signed URL (AD-9 « authorized download »); owning Responsable only.

## Open Questions

None blocking. For the Product Owner / CETEM (DEP-03, final acceptance only): (1) whether the « Conclusion générale » should carry the summary text, the decision wording or both as built; (2) whether the printed approver (« Contrôle approuvé par ») cells and the « Contrôle effectué par » qualité/name come from the form values as built; (3) none further on candidate marking (see decision above).
