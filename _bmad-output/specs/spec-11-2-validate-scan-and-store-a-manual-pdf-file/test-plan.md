# Test plan — Story 11.2

Local PostgreSQL harness, `memory` storage, synthetic PDFs built in test code (no real client data), scanner `none` or an injected fake. Zero skipped. Helpers follow 11.1 (`report-candidate-routes.postgres.test.ts`).

## Unit — `apps/api/src/modules/files/pdf-validator.test.ts`
- **V1** Minimal valid classic-xref PDF → `passed`; valid xref-stream PDF → `passed`; PDF 2.0 header → `passed`; trailing bytes after `%%EOF` within 1024 → `passed`.
- **V2** Not a PDF (text, PNG, ZIP renamed, `%PDF` not at offset 0) → `rejected/not-pdf`.
- **V3** Cut before `%%EOF` → `truncated`; cut mid-body → `truncated` or `corrupt-structure` (first match).
- **V4** `startxref` missing, offset beyond length, offset not at `xref`/object, no `/Root` → `corrupt-structure`.
- **V5** `/Encrypt` in trailer → `encrypted`.
- **V6** Each of `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/SubmitForm`, `/ImportData`, `/GoToR`, `/GoToE` → `quarantined/active-content`; `/JSON`-like names and `/OpenAction` alone do not.
- **V7** Precedence: encrypted + JS → `encrypted`; truncated + JS → `truncated`.
- **V8** Empty and over-limit buffers do not pass; limit boundary exact bytes (20 971 520) is accepted by the size gate.

## Unit — scanner and config — `pdf-scanner.test.ts`
- **S1** `none` → `not-performed`. `createPdfScanner`: default `none`, `clamav` selects the adapter, unknown value throws a message without paths.
- **S2** clamd client against a local fake TCP server: `stream: OK` → `clean`; `stream: Eicar FOUND` → `threat`; `ERROR` reply, garbage reply, early close, connection refused, timeout → `unavailable`. The fake server receives `zINSTREAM\0`, correct length-prefixed chunks and the zero terminator for a multi-chunk payload.
- **S3** `resolvePdfMaxBytes`: default, valid lower value, invalid/zero/negative/above 20 MB → 20 971 520.

## Route tests — `apps/api/src/pdf-file-routes.postgres.test.ts`
- **R1** Confirmed summary + current decision, valid PDF, `none` → 201 `ready`, `scan.result: "not-performed"`; one file row, validation+storage+scan rows, one object; `sha256`/`byteSize` match the bytes and the stored object.
- **R2** Fake `clean` scanner → `ready`, scan result `clean`. Both decision outcomes upload.
- **R3** Each validator class via the route: not-a-PDF with `application/pdf`, truncated, corrupt structure, encrypted → 201 `rejected` with the class, no object stored, no scan call; active content → 201 `quarantined`, object stored, no scan call.
- **R4** Fake `threat` → `quarantined`; fake `unavailable` and a throwing scanner → `scan-failed`, never `ready`; download 404 for all.
- **R5** Rescan: `scan-failed` + now-`clean` scanner → 200 `ready`, new scan row appended; still unavailable → `scan-failed`; forged `scan-pending` (file + validation + storage rows only) rescans to `ready`.
- **R6** Rescan of `ready`, `quarantined`, `rejected`, `storage-failed` → 409 `FILE_NOT_RESCANNABLE`, nothing written; unknown/other-team file → 404.
- **R7** Body over limit (configured small limit in the test, plus declared `Content-Length` over 20 MB without sending the body) → 413 `FILE_TOO_LARGE`; `text/plain` or `application/json` → 415; empty body, missing/invalid `X-Attempt-Id` → 422; none writes rows or objects and none calls the scanner.
- **R8** Storage `put` throws → 502 `FILE_STORAGE_FAILED`, storage `failed` check, status `storage-failed`, partial object removed; a new attempt ID → 201 `ready`; replay of the failed attempt → 502 with no storage call.
- **R9** Summary open → 409 `SUMMARY_NOT_CONFIRMED`; confirmed without decision → 409 `CONFORMITY_NOT_DECIDED`; after a reopening that invalidated the decision → same; no rows, no object.
- **R10** Employé → 403; malformed/unknown/other-team/draft/no-audit task → 404 body identical to 9.1; size/type problems on an unknown task answer 404, not 413/415; nothing written, no scanner call.
- **R11** Replay of a stored attempt → 200 same `StoredFile`, scanner/storage not called, no new row; same attempt on another task → 409 `FILE_ATTEMPT_CONFLICT`, nothing written; two concurrent POSTs with one attempt → one file row.
- **R12** List: newest first, team-scoped, derived statuses incl. forged `scan-pending`, no storage key or `official` field; after a summary reopening the list and the download of a `ready` file still work (no eligibility needed).
- **R13** Download: exact bytes, `application/pdf`, `Content-Disposition: attachment; filename="Rapport-LCQ-manuel-<yyyymmdd>-<8 hex>.pdf"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`; `rejected`, `quarantined`, `scan-failed`, `storage-failed`, unknown, malformed, other-team → 404 identical body; Employé 403.
- **R14** `X-File-Name` hygiene: `../../etc/passwd`, `a\b.pdf`, percent-encoded control characters and a 500-character name are reduced/trimmed; the storage key is always `files/pdf/<uuid>.pdf`; absent name → « Rapport.pdf ».
- **R15** No write to reports tables, evidence, summaries, decisions, insights, access rows or `tasks.updated_at` (row-count/snapshot comparison); no review-access row; no candidate created from a `ready` file.
- **R16** `UPDATE`, `DELETE`, `TRUNCATE` on `stored_files` and `stored_file_checks` are refused.
- **R17** Logs: only event, actor ID and fixed class/status; no task/file IDs, names, paths or bytes; `raw` upload parser does not change the 32 kB JSON limit on other routes (an oversized JSON on another route still answers 413 `PAYLOAD_TOO_LARGE`).
- **R18** Boundaries: `files` imports no business module (covered by `boundaries:check`); migration `0023` listed in the migration enumeration test.

## Web render tests — `apps/web/src/pdf-files/`
- **W1** Not eligible: explanatory text, no upload control. Eligible: file input (PDF only) and « Importer un rapport PDF ».
- **W2** Uploading: « Envoi en cours… », control disabled, one request; success appends the file with its status.
- **W3** Each status label with its French reason and scan note; download link only for `ready`; « Relancer l’analyse » only for `scan-failed`/`scan-pending`.
- **W4** Client pre-check refuses a non-PDF type or > 20 Mo with the French message and sends nothing; server 413/415/409/502 show French alerts; retry uses a new attempt ID, an automatic transport retry reuses it.
- **W5** No « Désigner comme officiel » and no « Créer un candidat » control; no English text; file name rendered as text (an HTML-like name is not interpreted).
- **W6** Next route handlers: CSRF rejection on POST, session cookie only, raw bytes and headers forwarded, content handler streams with the required headers, 404 pass-through, 503 when unreachable.
- **W7** The narrowed 11.1 assertion (no designation control, no candidate-creation control) holds in the existing report panel tests.

## Contract
- **C1** OpenAPI documents the four operations, `StoredFile`, `StoredFileList`, the new error codes and the binary request/response; generated types, zod schemas and client agree; `contracts:check` passes; `StoredFile` carries no `official`/storage-key property.
