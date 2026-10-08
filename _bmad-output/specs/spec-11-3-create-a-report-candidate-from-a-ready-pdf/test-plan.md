# Test plan — Story 11.3

Local PostgreSQL harness, `memory` storage, synthetic PDFs built in test code, scanner `none` or an injected fake. Zero skipped. Helpers follow 11.1/11.2 (`report-candidate-routes.postgres.test.ts`, `pdf-file-routes.postgres.test.ts`).

## Route tests — `apps/api/src/pdf-report-candidate-routes.postgres.test.ts`
- **P1** Confirmed summary + current decision, `ready` file (`none`) → 201 `origin: "uploaded-pdf"`, `status: "ready"`, bindings equal current audit revision / summary id+version / decision id, `source.fileId`, `source.scanResult: "not-performed"`, `template: null`, file name/size/SHA-256 equal the stored file; one candidate row (`stored_file_id` set, `template_*` NULL) and one outcome row (`storage_ref` NULL); no new object in storage; no storage key in any reports column or response.
- **P2** Fake `clean` scanner → `source.scanResult: "clean"`. Both decision outcomes attach.
- **P3** Not-ready files: `rejected` (via real upload), `quarantined` (active content and fake `threat`), `scan-failed` (fake `unavailable`), forged `scan-pending`, `storage-failed` → 409 `REPORT_FILE_NOT_READY`; zero rows written; after a successful rescan to `ready` the same file attaches.
- **P4** Refusals: Employé 403; malformed task or file id, unknown task, other-team task, draft/no-audit task, unknown file, file of another task → 404 body identical to 9.1 (an unknown task never reveals file state); invalid body (missing/non-UUID `attemptId`, extra property) → 422; summary open → 409 `SUMMARY_NOT_CONFIRMED`; confirmed without decision → 409 `CONFORMITY_NOT_DECIDED`; none writes a row.
- **P5** Idempotency: replay of an attempt (same task and file) → 200 same candidate, no new row; same attempt for another file, another task or an existing Word attempt → 409 `REPORT_ATTEMPT_CONFLICT`; same file + same bindings with a new attempt → 409 `REPORT_FILE_ALREADY_ATTACHED`; two concurrent POSTs with one attempt → one candidate; two concurrent POSTs with different attempts for the same file → one 201 and one 409.
- **P6** Freshness: after a summary reopening the candidate lists as `outdated` and stays downloadable; a conformity re-decision gives the same; after re-confirmation and a new decision the same file attaches again (new candidate, history of two candidates kept, old one `outdated`); a candidate bound to another submission never reads `ready`.
- **P7** List: Word and PDF candidates together, newest first, team-scoped, `origin` correct, `source` null for Word, no `official` or storage-key property. Existing Word candidate payloads unchanged except `source: null`.
- **P8** Download of a PDF candidate: exact uploaded bytes, `application/pdf`, `Content-Disposition: attachment; filename="Rapport-LCQ-candidat-<yyyymmdd>-<8 hex>.pdf"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`; other-team, unknown, malformed candidate id → 404 identical body; Employé 403; Word download unchanged (11.1 tests pass unmodified).
- **P9** No writes elsewhere: `stored_files`, `stored_file_checks`, evidence, summaries, decisions, insights, access rows, drafts and `tasks.updated_at` unchanged (row-count/snapshot comparison); no review-access row; no storage call (counting storage); no scanner call.
- **P10** `UPDATE`, `DELETE`, `TRUNCATE` on `report_candidates` and `report_candidate_outcomes` still refused; DB constraints: `uploaded-pdf` without `stored_file_id`, `generated-word` with `stored_file_id`, duplicate file+bindings, outcome `ready` without file name → rejected by PostgreSQL.
- **P11** Logs: `report.candidate.attached` and refused classes carry only event, actor ID and class; no task/file/candidate IDs, names or paths.
- **P12** Migration `0024` applies on top of data created by `0022`/`0023` (existing Word rows remain valid); migration enumeration test lists `0024`; `boundaries:check` shows `reports` → `files` only via `files/index.ts` and `files` → no `reports`.

## Unit
- **U1** `files` exports `getStoredFileStatus` (all six statuses, unknown → undefined) and `getFileScanResults` (clean / not-performed / null for not-ready); both use the single `deriveStatus`.

## Web render tests — `apps/web/src/app/pdf-files-render.test.tsx`, `report-candidates-render.test.tsx`
- **W1** Create control only on `ready` files when eligible; absent on every other status and when not eligible.
- **W2** Creating state « Création en cours… », control disabled, one request; success shows « Candidat créé — non officiel » and a PDF candidate in the list with « PDF importé », « Candidat — non officiel » and « Télécharger pour inspection ».
- **W3** French alerts for 409 `REPORT_FILE_NOT_READY` / `REPORT_FILE_ALREADY_ATTACHED` / summary and decision refusals and 404; retry uses a new attempt ID, an automatic transport retry reuses it.
- **W4** Outdated PDF candidate shows « Obsolète — les données ont changé »; the file shows the create control again once eligible with new bindings.
- **W5** No « Désigner comme officiel » control; no English text; file name rendered as text; the narrowed 11.2 assertion holds and all other 11.1/11.2 web tests pass.
- **W6** Next route handler: CSRF rejection, session cookie only, status/body pass-through, 503 when unreachable.

## Contract
- **C1** OpenAPI documents the new operation, `ReportFromPdfRequest`, extended `ReportCandidate`, the two new error codes; generated types, zod and client agree; `contracts:check` passes; no `official` or storage-key property.
