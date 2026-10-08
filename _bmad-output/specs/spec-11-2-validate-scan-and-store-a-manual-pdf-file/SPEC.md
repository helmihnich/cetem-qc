---
id: SPEC-11-2-validate-scan-and-store-a-manual-pdf-file
story: 11.2
status: in-review
approved: 2026-10-08
baseline_commit: 28f5979
companions:
  - pdf-file-model.md
  - test-plan.md
  - ../spec-11-1-generate-an-inspectable-word-report-candidate/SPEC.md
  - ../spec-11-1-generate-an-inspectable-word-report-candidate/report-candidate-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md (AD-9)
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 11.2 — Validate, scan and store a manual PDF file

## Why

**Pain.** The Responsable may prepare the signed report by hand and needs to import it as a PDF (FR-034), but an unsafe, corrupt or unscanned file must never become eligible to be official (SEC-008, SEC-010, AD-9). Nothing yet accepts a binary upload.

**Story statement.** As a Responsable, I want to upload a manually prepared PDF and see its validation/scan status, so that an unsafe or incomplete file cannot become official.

**What this delivers.** The `files` module grows from the storage port (11.1) into a file-intake capability: server-side PDF validation, a scanner port (`none` default, `clamav` optional), two insert-only tables, four routes (upload, list, download, rescan) and a « Rapport PDF manuel » area in the W5 report panel. It creates **no report business state**: no report candidate, no origin, no bindings, no designation. Turning a `ready` file into a candidate is Story 11.3; designation is 11.4; asynchronous scan freshness is 11.6.

**Traceability.** FR-034 (intake part), SEC-008, SEC-010, AD-9, UX-DR2 (report-panel, alert-message, loading-state), UX-DR10, OD-04 (resolved: PDF only, 20 MB, no page limit). Depends on 11.1 (done: `files` storage port, migration `0022`, route registrars, `fr.report`, report panel). Hands off to 11.3 (consumes `ready` files through the `files` index) and 11.6.

## Capabilities

Tables, ports, validation rules, routes, contract and web details are in [pdf-file-model.md](pdf-file-model.md); test IDs in [test-plan.md](test-plan.md).

- **CAP-1** — Upload only for a report-eligible task
  - **intent:** The Responsable of the owning team uploads one PDF for a task whose audit is accepted, summary confirmed and conformity decision current (either outcome) — the same eligibility as Story 11.1 and FR-034.
  - **success:**
    - `POST /api/v1/tasks/{taskId}/pdf-files` with the raw bytes as body (`Content-Type: application/pdf`), header `X-Attempt-Id: <uuid>` and optional `X-File-Name` stores and checks the file and returns 201 `StoredFile`.
    - Refusals: Employé 403; malformed/unknown/other-team/draft/no-audit task 404 `TASK_NOT_FOUND` (identical to 9.1); summary open 409 `SUMMARY_NOT_CONFIRMED`; confirmed without current decision 409 `CONFORMITY_NOT_DECIDED`. Nothing is written or stored in any refusal.
    - Eligibility is checked by the route layer through the public `audits`, `summaries`, `conformity` queries; `files` imports no business module.
- **CAP-2** — Size and type are enforced on the server
  - **intent:** Only a PDF up to the configured limit (default 20 MB, resolved OD-04) is processed; no page-count limit exists.
  - **success:** A body over the limit → 413 `FILE_TOO_LARGE` (checked from `Content-Length` before reading and again on the bytes read); a `Content-Type` other than `application/pdf` → 415 `UNSUPPORTED_FILE_TYPE`; an empty body or a missing/invalid `X-Attempt-Id` → 422 `VALIDATION_FAILED`. None of these writes a row or an object. The declared media type is never trusted: content is validated independently (CAP-3).
- **CAP-3** — Structural validation rejects or quarantines
  - **intent:** Corrupt, unreadable, truncated, structurally invalid, password-protected/encrypted or unsafe files cannot reach `ready`.
  - **success:** The pure validator of [pdf-file-model.md](pdf-file-model.md) classifies every file as `passed`, `rejected` (class `not-pdf` | `truncated` | `corrupt-structure` | `encrypted`) or `quarantined` (class `active-content`). Rejected files are **not stored** (metadata only: size, SHA-256, class). Quarantined files are stored privately but never served. The upload response is 201 with the resulting status (the user sees it), never an opaque 4xx, for any file that reached validation.
- **CAP-4** — Malware scanning behind a port; never clean by default
  - **intent:** A passed file is scanned through a replaceable adapter; failed, unavailable or incomplete scanning never counts as clean (AD-9).
  - **success:** Scanner results are `clean` | `threat` | `unavailable` | `not-performed`. `clamav` → `clean`/`threat`/`unavailable` (connection error, timeout, protocol error, size refusal = `unavailable`). `none` (default, used by all tests) → `not-performed`, recorded with the French note « analyse antivirus non effectuée (PoV) » (PO decision). `threat` → `quarantined`; `unavailable` → `scan-failed` (not `ready`) and the scan can be retried; `not-performed` under `none` → `ready` and the note is shown with the file.
- **CAP-5** — Private storage with metadata in PostgreSQL
  - **intent:** The binary is never public and never a database blob.
  - **success:** The binary goes through the existing `ObjectStorage` port under an opaque server-generated key (`files/pdf/<fileId>.pdf`); PostgreSQL holds only metadata, the key, size, SHA-256 and check results in insert-only tables. A storage failure records a `storage-failed` check, removes the partial object best-effort and returns 502 `FILE_STORAGE_FAILED`; the file is never `ready`; a new `X-Attempt-Id` retries.
- **CAP-6** — Idempotent by attempt, retryable scan
  - **intent:** A retried upload does not create a second file; a failed scan can be retried without re-uploading.
  - **success:** The same `X-Attempt-Id` for the same task returns the stored `StoredFile` (200), writes nothing and does not call validator, scanner or storage again; for another task → 409 `FILE_ATTEMPT_CONFLICT`; concurrent requests with one attempt ID leave one file. `POST …/pdf-files/{fileId}/scan-retries` re-scans a `scan-failed` or `scan-pending` file (appends a scan check, returns 200 `StoredFile`); on any other status → 409 `FILE_NOT_RESCANNABLE` and nothing is written; a quarantined or rejected file is never re-scanned into `ready`.
- **CAP-7** — List, status and authorized download
  - **intent:** The Responsable sees each uploaded file's validation/scan status and inspects a safe file.
  - **success:**
    - `GET /api/v1/tasks/{taskId}/pdf-files` → `{ files: StoredFile[] }` newest first with derived `status` (`rejected` | `quarantined` | `scan-pending` | `scan-failed` | `storage-failed` | `ready`), checks summary and no storage key.
    - `GET …/pdf-files/{fileId}/content` returns the PDF bytes (`application/pdf`, `Content-Disposition: attachment; filename="Rapport-LCQ-manuel-{yyyymmdd}-{8 hex}.pdf"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`) **only** for a `ready` file of the owner's team. Any other status, unknown, malformed or other-team file, → 404 `TASK_NOT_FOUND` with the 9.1 body.
    - List and download need the Responsable of the owning team but not report eligibility (history stays visible after a reopening).
- **CAP-8** — Files-owned contract, no report state
  - **intent:** 11.3 can rely on a stable `files` outcome without `files` owning report meaning.
  - **success:** `files/index.ts` exports `getReadyFile(executor, ownerScope)` returning only `ready` file metadata (id, size, SHA-256, name, scan note, uploader, date) plus `readStoredFile`; no table of `reports` is created or written; no field, status or label designates, completes or marks a file official; no candidate is created.
- **CAP-9** — Upload area in the report panel
  - **intent:** The Responsable imports a PDF and sees its status in the W5 panel (UX-DR2 report-panel, alert-message, loading-state).
  - **success:** Below the Word candidates, area « Rapport PDF manuel »: file input limited to PDF (client pre-check of type and size is usability only) and button « Importer un rapport PDF », shown only when eligible (same explanatory text as 11.1 otherwise); while sending the label is « Envoi en cours… », the control is disabled and one request is in flight. The list shows per file: name, size, date, author, status label (« Prêt », « Refusé », « Mis en quarantaine », « Analyse en attente », « Analyse échouée — réessayer », « Échec du stockage »), the French reason, the scan note, a « Télécharger pour inspection » link for `ready` only, and « Relancer l’analyse » for `scan-failed`/`scan-pending`. French alerts for 413/415/409/502. No « Désigner comme officiel » control and no « Créer un candidat » control.

## Constraints

- Written by upload: `stored_files`, `stored_file_checks` (insert-only, triggers as `report_candidates`) and one object in storage. Accepted evidence, summaries, decisions, reports tables, drafts, access rows and `tasks.updated_at` are never written. Reads take no review-access row.
- No CETEM rule is invented. Limit 20 MB, PDF only, no page-count limit, reject/quarantine classes and « never clean when unavailable » come from the resolved baseline (epics 11.2, AD-9, PO decisions). The unsafe-content token list is a security policy of this build, documented in the model; it is not a CETEM business rule.
- Module boundaries: `files` imports no business module and no `reports`; the route registrar composes `audits`, `summaries`, `conformity` and `files` through their public `index.ts`/queries. `reports` does not read `stored_files`. `boundaries:check` passes.
- Ports with adapters (AD-9): `PdfScanner` with `none` (default) and `clamav` (clamd `INSTREAM` over TCP with `node:net`, optional, Docker; no SDK). Env `PDF_MAX_BYTES` (default 20971520, never above 20971520), `ANTIVIRUS=none|clamav`, `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`, all in `.env.example` with empty values and documented. No new npm dependency, no external account, no deployment, no docker-compose change (Epic 12). An unknown `ANTIVIRUS` value fails at start-up. Tests use `none`, an injected fake scanner and, for the clamd client only, a local fake TCP server.
- Upload transport is a raw body (no multipart, no dependency): the upload route uses its own `express.raw({ type: "application/pdf" })` parser limited to the configured size (the global JSON parser only reads `application/json`, so it does not touch this body); all other routes keep their limits. Declared and read sizes are both enforced.
- File name hygiene: `X-File-Name` is percent-decoded, reduced to its base name, control characters and path separators removed, trimmed to 120 characters, and stored for display only; it never builds a storage key, a path, a header or a log line. Missing/blank → « Rapport.pdf ».
- OpenAPI first: operations, `StoredFile`, `StoredFileList`, error codes `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `FILE_STORAGE_FAILED`, `FILE_ATTEMPT_CONFLICT`, `FILE_NOT_RESCANNABLE`; then generated types, strict zod, typed client. `contracts:check` passes. Binary request/response media types documented. Web goes through Next route handlers with CSRF check and session cookie only; the content handler streams bytes with the same headers.
- Migration `0023` is additive; any test enumerating migrations is updated by adding it.
- Logs carry event, actor ID and a fixed class only (`file.pdf.stored` with status, `file.pdf.refused` with class `forbidden-role|not-found|not-confirmed|not-decided|too-large|unsupported-type|attempt-conflict|not-rescannable`, `file.pdf.scan-failed`, `file.pdf.downloaded`); never task or file IDs, file names, paths or content.
- All text in French in `packages/i18n` (`fr.pdfFile`, new section next to `fr.report`); internal identifiers English. `apps/mobile` untouched; no Employé access. Tests: synthetic PDFs generated in test code, `none` or fake scanner, in-memory storage, local PostgreSQL harness (zero skipped). No test deleted, skipped or weakened; no gate script edited. 11.1 web assertions « no upload control » are narrowed to « no designation control and no candidate-creation control; upload control only when eligible », all other coverage kept.

## Non-goals

- Creating a report candidate from a file, `origin` of a candidate, bindings to audit/summary/decision (11.3); designation, completion, locking (11.4); history and official download (11.5); asynchronous scanning queue or freshness against changed inputs (11.6; scanning here is synchronous in the request).
- Text/OCR extraction, page counting, PDF rendering or preview, repairing or sanitizing a PDF, signature verification, uploading non-PDF files, signed-scan or arbitrary evidence upload.
- Deleting or replacing a stored file; a quarantine review UI; deploying or provisioning ClamAV or object storage; email notifications.

## Success signal

PostgreSQL route tests (in-memory storage, `none` and fake scanners) prove: for a confirmed summary with a current decision, a well-formed PDF returns 201 `ready` with a stored object whose SHA-256 and size match the response and a scan note « analyse antivirus non effectuée (PoV) »; a fake `clean` scanner also gives `ready`; the downloaded bytes are exactly the upload with the required headers; each validator class (not a PDF despite `application/pdf`, truncated, corrupt xref, encrypted, active content) returns 201 with `rejected`/`quarantined`, the right class, no `ready`, rejected files not stored, quarantined files stored but 404 on download; fake `threat` → `quarantined`, fake `unavailable` (and a throwing scanner) → `scan-failed`, never `ready`, then a retry with a clean scanner → `ready`, and a retry on a quarantined/ready/rejected file → 409; a body over 20 MB → 413 and a wrong media type → 415 with nothing written; storage failure → 502 with a `storage-failed` check and no stored object; summary open → 409 `SUMMARY_NOT_CONFIRMED`, no decision → 409 `CONFORMITY_NOT_DECIDED`, Employé 403, every 404 class and every pre-validation refusal write nothing; replay of an attempt → 200 same file with no scanner/storage call, another task → 409, concurrent duplicates → one file; list is newest first, team-scoped, shows no storage key; after a reopening the list and download of a `ready` file still work; UPDATE, DELETE, TRUNCATE on both tables are refused; nothing in reports tables or `tasks.updated_at` changes; logs hold no IDs, names or paths.

Unit tests prove the validator on synthetic PDFs (valid classic xref, valid xref stream, header offset, EOF position, bad `startxref`, `/Encrypt`, each unsafe token) and the clamd client against a local fake server (clean, FOUND, error, timeout, closed connection → `unavailable`).

Web render tests prove: no upload control before eligibility, control when eligible, uploading state, each status label with its reason, scan note, download link for `ready` only, rescan control, French alerts for 413/415/409/502, no designation or candidate-creation control, no English text.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, AD-9, the code and Product Owner rules. None is a CETEM business rule.

- **Scan `none` counts as ready** (PO: antivirus adapter « none » default records « analyse antivirus non effectuée (PoV) »). This is an explicit, visible PoV result (`not-performed`), distinct from `unavailable`, which never counts as clean. With `ANTIVIRUS=clamav`, `not-performed` cannot occur.
- **Eligibility = 11.1 eligibility** (confirmed summary + current human decision), checked at upload only. Bindings and later freshness belong to 11.3/11.6; a reopening afterwards does not hide or alter the stored file.
- **Outcomes are visible, not hidden in errors**: a file that reached validation always yields a `StoredFile` record, so the Responsable "sees its validation/scan status"; only transport-level problems (size, media type, missing attempt) are 4xx without a record.
- **Rejected vs quarantined**: structural defects (`not-pdf`, `truncated`, `corrupt-structure`, `encrypted`) are rejected and not stored; unsafe-content findings and scanner `threat` are quarantined (stored privately, retained as evidence, never served).
- **Header-level checks, no PDF parser dependency**: structure is validated on raw bytes (header, EOF, `startxref` and cross-reference, trailer `/Root`, `/Encrypt`), consistent with 11.1's no-new-dependency choice. Limitation recorded: tokens hidden in compressed object streams are not visible to the validator; the scanner is the second line. A parser-based validator can replace it behind the same function.
- **Raw body upload with `X-Attempt-Id`** (client-generated UUID, the architecture « operation ID » convention, same as 11.1's `attemptId`).
- **Upload lives under the task** (`/tasks/{taskId}/pdf-files`) so ownership and eligibility reuse the 9.1/10.x task scoping; the `files` tables hold the task reference as an opaque scope and never join business tables.
- **Synchronous scan in the request**; an incomplete scan (crash between store and scan) is `scan-pending` and retryable, never `ready`.
- **Download only for `ready`**, only by the owning Responsable, through an authorized endpoint (no public or pre-signed URL).
- **Antivirus via clamd INSTREAM over TCP** without SDK; Docker/ClamAV provisioning is Epic 12.

## Open Questions

None blocking. For CETEM via the Product Owner (acceptance only, not this build): whether production use should require `ANTIVIRUS=clamav` rather than the PoV `none` default.
