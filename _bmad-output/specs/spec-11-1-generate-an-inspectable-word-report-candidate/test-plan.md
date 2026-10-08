# Test plan — Story 11.1

Local PostgreSQL harness, `memory` storage, synthetic names, real domain results. Zero skipped. Helpers follow 10.4 (`conformity-decision-routes.postgres.test.ts`).

## Task 0 (route extraction)
- **X1** The full existing API suite passes unmodified after the extraction (no test edited).
- **X2** A route-table check: the set of method + path pairs served is identical before and after (assert against a fixed list written from the pre-extraction `index.ts`).

## Route tests — `apps/api/src/report-candidate-routes.postgres.test.ts`
- **R1** Confirmed summary + `machine-conforme` decision → POST 201 `ready`; bindings equal current `auditId`/revision/`submissionId`, summary id+version, decision id+outcome; one candidate row, one outcome row, one stored object; `file.sha256` and `byteSize` match the stored bytes.
- **R2** Same with `machine-non-conforme`.
- **R3** Fixtures with every per-test verdict combination (all conforme, mixed, all indisponible, one non-conforme) generate for both outcomes.
- **R4** Summary open (never confirmed) → 409 `SUMMARY_NOT_CONFIRMED`; after reopening → same; no rows, no object.
- **R5** Confirmed, no decision → 409 `CONFORMITY_NOT_DECIDED`; after a reopening that invalidated the decision → same; no rows.
- **R6** Body without `attemptId`, non-UUID, extra property → 422, no rows.
- **R7** Employé → 403; malformed/unknown/other-team/draft/no-audit task → 404 identical to 9.1; nothing written, no generator call.
- **R8** Generator throws → 502 `REPORT_GENERATION_FAILED`; candidate row + `failed`/`generation-failed` outcome; no object referenced; summary, decision, audit, `tasks.updated_at` unchanged.
- **R9** Storage `put` throws → 502, outcome `storage-failed`, partial object removed.
- **R10** After R8/R9 a new `attemptId` → 201 `ready`; list holds failed + ready, newest first.
- **R11** Replay of a ready `attemptId` → 200 same candidate, generator and storage not called, no new row.
- **R12** Replay of a failed `attemptId` → 502, nothing created.
- **R13** One `attemptId` on another task of the same team → 409 `REPORT_ATTEMPT_CONFLICT`, nothing written.
- **R14** Two concurrent POSTs with one `attemptId` → one candidate row; both responses describe it.
- **R15** Generator blocked, reopen the summary meanwhile (lock-serialized), release → 409 `REPORT_INPUTS_CHANGED`, outcome `outdated`, object retained, never `ready`.
- **R16** Generator blocked, reopen then reconfirm + new decision meanwhile → `outdated` (bound ids differ).
- **R17** A `ready` candidate, then reopening: list shows `outdated`, no row written by the reopening to the report tables; after reconfirm + new decision, a new candidate is `ready` and the old stays `outdated`.
- **R18** List: team-scoped, newest first, derived statuses (`generating` for a candidate without outcome, forged directly in the table), no storage reference in the body.
- **R19** Download: exact stored bytes, media type, `Content-Disposition: attachment; filename="Rapport-LCQ-candidat-<yyyymmdd>-<8 hex>.docx"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`; outdated candidate still downloadable.
- **R20** Download of failed, generating, unknown, malformed-id, other-team candidate, and Employé → refusal, 404 body identical across classes (403 for Employé).
- **R21** No `official` field in any response; no write to evidence, summaries, reopenings, decisions, invalidations, insights, access rows, `tasks.updated_at` (row-count/snapshot comparison); no review-access row.
- **R22** UPDATE, DELETE, TRUNCATE on both new tables are refused; one outcome per candidate (second insert fails); `ready` outcome without file fields and `failed` with file fields violate the CHECK.
- **R23** Logs hold only event, actor ID and fixed class; none contains a task, candidate, summary or decision ID, file name, path or text.
- **R24** `AcceptedEvidenceResponse` unchanged (existing evidence tests untouched).
- **R25** Migration `0022` applies to a database with data from 0021 without rewriting rows; migration-enumeration test updated.

## Unit tests
- **D1** `buildReportDocument` with a full fixture reproduces every section/label/table of [report-template.md](report-template.md) in order (snapshot of the block tree, labels asserted against the paper-form strings).
- **D2** Sparse fixture (empty strings, missing results) → empty cells, no throw, no invented text.
- **D3** Verdict marks: conforme → OUI marked; non-conforme → NON marked; indisponible (each reason) → neither marked + reason line; light field always indisponible/no-tolerance; unsupported-version result → empty values and the version line.
- **D4** Both decision outcomes print the exact label in « Conclusion générale » followed by the summary text; paragraphs preserved; the outcome is not derived from verdicts (verdict permutations leave it unchanged).
- **D5** Signature cells (« Signature(s) », « Signature ») are empty; approver cells hold « HENIDI Rache » / « CHEF DE SERVICE »; no « candidat »/« officiel » text anywhere in the document.
- **D6** Numbers: full precision, decimal comma, never rounded; the 6.6 workbook regression fixture values appear verbatim.
- **D7** Determinism: the same input twice → identical block tree and identical `.docx` bytes.
- **W1** Word writer: output is a valid ZIP (central directory, CRC-32 verified by an independent read in the test with `node:zlib`), contains the required parts, `[Content_Types].xml` declares `png`, `word/header1.xml` references the logo, the media bytes equal `docs/product/source/cetem-logo.png`; XML is well-formed; special characters (`&`, `<`, quotes, accents, control chars) are escaped/stripped.
- **S1** Object storage `local`: put/get/remove round trip in a temp dir, atomic write, key traversal (`../`, absolute, backslash) rejected, missing key → `null`, `remove` idempotent. `memory` adapter parity.
- **S2** Env selection: default `local`; `FILE_STORAGE=memory` selects memory; unknown value fails at start-up with a clear error and no path in the message.

## Web render tests
- **U1** Summary open: no generate button, explanatory text shown.
- **U2** Confirmed, no decision: same explanatory text, no button.
- **U3** Eligible: « Générer le rapport Word » shown; click → loading label, button disabled, one request; success adds a list entry « Candidat — non officiel », « Prêt à inspecter », author, date, summary version, decision label, « Télécharger pour inspection » link to the handler URL.
- **U4** 502 → French failure message and « Réessayer »; the retry sends a new `attemptId` (different from the first).
- **U5** 409 states reload and show the French messages.
- **U6** After a reopening the existing candidate shows « Obsolète — les données ont changé »; its download link remains.
- **U7** No « Désigner comme officiel », upload or « officiel » control; no English text. The 10.4 « no report control » assertion is narrowed as stated in the SPEC.
- **U8** Next handlers: CSRF rejection on POST, session cookie required, status/body pass-through, 503 when the API is unreachable, file handler forwards headers and bytes.

## Gates
`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check`, `git diff --check`.
