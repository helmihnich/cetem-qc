# PDF candidate model (CAP-1 to CAP-7)

## Migration `apps/api/src/db/migrations/0024_report_pdf_candidates.sql`

Additive. History triggers stay; the migration only changes constraints and adds columns (follow real constraint names with `pg_constraint` lookup or drop-by-name from 0022: Postgres names them `report_candidates_origin_check` and `report_candidate_outcomes_check`; verify against a migrated database).

```sql
ALTER TABLE report_candidates DROP CONSTRAINT report_candidates_origin_check;
ALTER TABLE report_candidates ADD CONSTRAINT report_candidates_origin_check CHECK (origin IN ('generated-word', 'uploaded-pdf'));
ALTER TABLE report_candidates ALTER COLUMN template_id DROP NOT NULL;
ALTER TABLE report_candidates ALTER COLUMN template_version DROP NOT NULL;
ALTER TABLE report_candidates ADD COLUMN stored_file_id uuid REFERENCES stored_files(id) ON DELETE RESTRICT;
ALTER TABLE report_candidates ADD CONSTRAINT report_candidates_origin_shape CHECK (
  (origin = 'generated-word' AND stored_file_id IS NULL AND template_id IS NOT NULL AND template_version IS NOT NULL)
  OR (origin = 'uploaded-pdf' AND stored_file_id IS NOT NULL AND template_id IS NULL AND template_version IS NULL));
CREATE UNIQUE INDEX report_candidates_file_bindings_uidx
  ON report_candidates (stored_file_id, confirmed_summary_id, conformity_decision_id) WHERE stored_file_id IS NOT NULL;

ALTER TABLE report_candidate_outcomes DROP CONSTRAINT report_candidate_outcomes_check;
ALTER TABLE report_candidate_outcomes ADD CONSTRAINT report_candidate_outcomes_check CHECK (
  (outcome IN ('ready','outdated') AND file_name IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL AND failure_class IS NULL)
  OR (outcome = 'failed' AND failure_class IS NOT NULL AND storage_ref IS NULL AND file_name IS NULL AND byte_size IS NULL AND sha256 IS NULL));
```

The PDF candidate's outcome row is `ready` with `storage_ref` NULL and the file copies. The relaxed outcome `CHECK` cannot see the candidate's origin (separate table), so the Word invariant « `storage_ref` present for `ready`/`outdated` » is kept by `generateReportCandidate`, which already always supplies it, and by the existing 11.1 tests. `report_candidates.attempt_id` stays globally unique. `stored_file_id` is the only link to `files`; the FK is database integrity, not a code dependency.

## Command `attachPdfReportCandidate(deps, responsableId, taskId, fileId, attemptId)` in `modules/reports/commands/attach-pdf-report-candidate.ts`

`deps = { pool, now? }`. Returns `{ type: "attached" | "replayed" | "not-found" | "not-confirmed" | "not-decided" | "file-not-ready" | "already-attached" | "attempt-conflict" | "inconsistent"; candidate? }`. One transaction (`withTransaction`):

1. `lockTaskSummary(tx, taskId)`; `getAcceptedSubmissionForReview` + `isConsistentSnapshot` (as 11.1) → none: `not-found`.
2. Existing candidate with this `attempt_id`: same task, same `stored_file_id` → `replayed` (stored state, no side effect); anything else → `attempt-conflict`.
3. `getReadyFile(tx, { taskId, fileId })` from `files/index.ts`: undefined → distinguish unknown from not-ready without a `files` internal import: add to `files/index.ts` a query `getStoredFileStatus(executor, { taskId, fileId })` → `StoredFileStatus | undefined` (reuses `deriveStatus`; no storage key). Undefined → `not-found`; status ≠ `ready` → `file-not-ready`.
4. `getSummaryState` not confirmed → `not-confirmed`; `getCurrentConformityDecision` null → `not-decided`. Order of checks 3–4: not-found (task/file) → not-confirmed → not-decided → file-not-ready, so state refusals match 11.1/11.2 and an ineligible task never reveals file state.
5. Existing candidate with the same `stored_file_id`, `confirmed_summary_id`, `conformity_decision_id` → `already-attached`.
6. Insert candidate (`origin = 'uploaded-pdf'`, bindings, `stored_file_id`, `template_*` NULL, `requested_by`) and, in the same transaction, its outcome `ready` (file name, size, SHA-256 copied from `ReadyFile`; `storage_ref` NULL). Commit.

Unique violations (`attempt_id`, file+bindings index) under concurrency resolve to the replay or `already-attached` path by re-reading. The command calls no storage, no scanner, no generator, no AI provider and writes nothing else.

## Queries (changes in `queries/report-candidates.ts`)

- `candidateSelect` adds `candidate.origin`, `candidate.stored_file_id`, `outcome.storage_ref` is not selected for lists. `CandidateRow` gains `origin` and `stored_file_id`; `template_*` nullable.
- `toReportCandidate`: `origin` from the row, `template` null when `template_id` is null, `source: { fileId, scanResult } | null` where `scanResult` comes from `getReadyFile`-style metadata read through `files` (`clean` | `not-performed`); to avoid per-row cross-module reads in the list, `presentCandidateRows` batches `getFileScanResults(executor, fileIds)` exported from `files/index.ts` (returns `Map<fileId, "clean"|"not-performed"|null>`).
- `deriveStatus` is unchanged (PDF candidates always have an outcome). `ReportCandidate.origin: "generated-word" | "uploaded-pdf"`.
- `getReportCandidateFile` returns `{ origin, fileName, byteSize, sha256, storageRef: string | null, storedFileId: string | null }`; the existing `outcome IN ('ready','outdated')` filter holds for both origins.

## Routes (registrar `register-report-routes.ts`; `Cache-Control: no-store`)

| Route | Case | Status / body | Log |
|---|---|---|---|
| `POST /api/v1/tasks/{taskId}/pdf-files/{fileId}/report-candidate` | Employé | 403 `FORBIDDEN` | `report.candidate.refused` `forbidden-role` |
| | Malformed task/file id, unknown/other team/draft/no audit, unknown/other-task file | 404 `TASK_NOT_FOUND` (as 9.1) | `not-found` |
| | Missing/invalid `attemptId`, extra property | 422 `VALIDATION_FAILED` | none |
| | Summary not confirmed / no decision | 409 `SUMMARY_NOT_CONFIRMED` / `CONFORMITY_NOT_DECIDED` | `not-confirmed` / `not-decided` |
| | File not `ready` | 409 `REPORT_FILE_NOT_READY` | `file-not-ready` |
| | Same file and bindings already a candidate | 409 `REPORT_FILE_ALREADY_ATTACHED` | `already-attached` |
| | Attempt ID used by another task/file/Word attempt | 409 `REPORT_ATTEMPT_CONFLICT` | `attempt-conflict` |
| | Inconsistent snapshot / other | 500 `INTERNAL_ERROR` | none |
| | Attached | 201 `ReportCandidate` | `report.candidate.attached` |
| | Replay | 200 `ReportCandidate` | none |
| `GET …/report-candidates` | as 11.1, now both origins | 200 `ReportCandidateList` | none |
| `GET …/report-candidates/{candidateId}/file` | Word: unchanged. PDF: bytes via `readStoredFile(executor, storage, { taskId, fileId })`; undefined (file not ready, object missing) → 404 identical body | 200 bytes + headers (SPEC CAP-6) | `report.candidate.downloaded` |

Role check precedes body validation; for an invalid body the task is probed first so unknown tasks stay 404 (as 10.x/11.x). The route needs `ObjectStorage` for PDF download; it already receives `storage` for Word download. Messages (French): 409 not ready « Ce fichier n’est pas prêt : il doit être validé et analysé avant de devenir un candidat de rapport. »; 409 already attached « Ce fichier est déjà un candidat de rapport pour les données actuelles. »; 409 attempt « Cette demande est invalide. »; others as 11.1.

Download file name for PDF: `Rapport-LCQ-candidat-{yyyymmdd}-{first 8 hex of candidate id}.pdf`.

## Contract

- `ReportFromPdfRequest`: `{ attemptId: uuid }`, strict.
- `ReportCandidate` (extended, strict): `origin: "generated-word" | "uploaded-pdf"`; `template: { id, version } | null` (null for PDF); `source: { fileId: uuid, scanResult: "clean" | "not-performed" } | null` (null for Word); `file` as 11.1; `failureClass` null for PDF; no `official` property. Existing Word payloads differ only by `source: null`.
- Error codes `REPORT_FILE_NOT_READY`, `REPORT_FILE_ALREADY_ATTACHED`; `REPORT_ATTEMPT_CONFLICT` reused.

## Web

- `report-candidates.tsx`: origin label per candidate (`fr.report.origin.generatedWord` « Word généré », `uploadedPdf` « PDF importé »); PDF candidates show no « En cours »/« Échec de génération » states; scan note « Analyse antivirus non effectuée (PoV). » when `source.scanResult` is `not-performed`.
- `pdf-files.tsx`: for each `ready` file, when eligible and no candidate in the current list has `source.fileId` equal to the file and status `ready`, button « Créer un candidat de rapport » (`fr.pdfFile.createCandidate`, working label « Création en cours… »); otherwise « Candidat créé — non officiel ». Needs the candidate list: the report area passes candidates (refetched on every evidence reload and after each attach) to `pdf-files.tsx`; after success both lists refresh. New `crypto.randomUUID()` per click.
- Handler `apps/web/src/app/api/tasks/[taskId]/pdf-files/[fileId]/report-candidate/route.ts` (POST, CSRF check, session cookie only, status/body pass-through, 503 when unreachable). The existing candidate file handler already streams bytes; it forwards the upstream `Content-Type` (PDF here) unchanged.
- i18n: `fr.report` origin labels and the two 409 messages; `fr.pdfFile.createCandidate`, `creatingCandidate`, `candidateCreated`. No « officiel » control wording, no English text.
