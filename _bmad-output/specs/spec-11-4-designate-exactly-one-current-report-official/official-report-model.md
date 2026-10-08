# Official report model (CAP-1 to CAP-7)

## Migration `apps/api/src/db/migrations/0025_official_reports.sql`

Additive. History triggers (`history_only` UPDATE/DELETE refusal and `no_truncate`) are created exactly as in `0022_report_candidates.sql`; follow the real function and trigger names there.

```sql
CREATE TABLE official_reports (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL UNIQUE REFERENCES report_candidates(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  designated_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  designated_at timestamptz NOT NULL DEFAULT now()
);
```

Linkage (audit, revision, summary, decision, origin, file) is read from the candidate row by join, never copied, so it cannot diverge. `UNIQUE (task_id)` is the database backstop for « exactly one ». If a real column name differs, follow the real schema.

## Command `designateReportCandidate(deps, responsableId, taskId, candidateId)` in `modules/reports/commands/designate-report-candidate.ts`

`deps = { pool, now? }`. Returns `{ type: "designated" | "replayed" | "not-found" | "not-ready" | "outdated" | "already-official" | "inconsistent"; official? }`. One transaction (`withTransaction`):

1. `lockTaskSummary(tx, taskId)`; `getAcceptedSubmissionForReview` + `isConsistentSnapshot` (as 11.1) → none: `not-found`.
2. Load the candidate with its outcome by `id` and `task_id`; none → `not-found`.
3. Existing `official_reports` row for the task: same `candidate_id` → `replayed`; otherwise `already-official`.
4. Outcome absent (generating) or `failed` → `not-ready`.
5. Freshness: outcome `ready`; `candidate.confirmed_summary_id` equals the current summary id (`getSummaryState` confirmed) and `conformity_decision_id` equals `getCurrentConformityDecision(...).id`; `candidate.submission_id` and `audit_revision` equal the snapshot's. Any mismatch (including `outdated` outcome, reopened summary, no current decision) → `outdated`. Reuse `deriveStatus`/`getCurrentBindings` from the candidate queries; do not duplicate the rule.
6. PDF origin: `getStoredFileStatus(tx, { taskId, fileId: stored_file_id })` from `files/index.ts` must be `ready`, else `outdated`.
7. Insert the `official_reports` row; unique violation (`task_id`, `candidate_id`) under concurrency is resolved by re-reading to `replayed` / `already-official`. Return the joined `OfficialReport`.

Calls no storage, scanner, generator or provider; writes nothing else. Check order is deliberate: not-found → already-official/replay → not-ready → outdated.

## Candidate commands (changes)

`generateReportCandidate` Tx A and `attachPdfReportCandidate` check, after the snapshot (so unknown tasks stay 404) and before any insert: official row for the task → outcome `official-designated` → 409 `REPORT_OFFICIAL_DESIGNATED`, nothing written. Generation Tx B is unchanged (retains evidence; the candidate then derives `superseded`).

## Queries (`queries/report-candidates.ts`, new `queries/official-report.ts`)

- `ReportCandidateStatus` = `generating | ready | failed | outdated | official | superseded`. `deriveStatus` gains the official context `{ officialCandidateId: string | null }`: candidate id equals it → `official`; otherwise, if an official exists and the status would be `ready` → `superseded`; other statuses unchanged. `presentCandidateRows` reads the official candidate id once per list. `official` precedes the `submission_id` current check (an official report is permanent).
- `getOfficialReport(executor, responsableId, taskId)` → `OfficialReport | undefined` for an owned task with accepted submission (same ownership/404 semantics as `listReportCandidates`). Read only; no access row.
- `hasOfficialReport(executor, taskId, submissionId?)` internal to `reports`, used by the commands and the participant.

## Reopen participant (`modules/reports/reopen-participant.ts`)

```ts
export const reportsReopenParticipant: SummaryReopenParticipant = {
  name: "reports",
  hasOfficialDesignation: (tx, { taskId, submissionId }) => /* SELECT 1 FROM official_reports WHERE task_id = $1 AND submission_id = $2 */,
  onSummaryReopened: async () => {},
};
export function registerReportsReopenParticipant(): void; // idempotent by name, like conformity
```

Exported from `reports/index.ts`; `apps/api/src/register-participants.ts` calls it after the conformity registration. Imports `summaries/index.ts` only. Tests that clear the registry (`summaryReopenParticipantTestSeams.clear`) re-register as needed.

## Routes (registrar `register-report-routes.ts`; `Cache-Control: no-store`)

| Route | Case | Status / body | Log |
|---|---|---|---|
| `POST /api/v1/tasks/{taskId}/report-candidates/{candidateId}/designate` | Employé | 403 `FORBIDDEN` | `report.official.refused` `forbidden-role` |
| | Malformed task/candidate id, unknown/other team/draft/no audit, unknown/other-task candidate | 404 `TASK_NOT_FOUND` | `not-found` |
| | Invalid body (anything but `{}`) | 422 `VALIDATION_FAILED` | none |
| | Generating / failed | 409 `REPORT_CANDIDATE_NOT_READY` | `not-ready` |
| | Stale bindings / file no longer ready | 409 `REPORT_CANDIDATE_OUTDATED` | `outdated` |
| | Another candidate already official | 409 `REPORT_ALREADY_OFFICIAL` | `already-official` |
| | Inconsistent snapshot / other | 500 `INTERNAL_ERROR` | none |
| | Designated | 201 `OfficialReport` | `report.official.designated` |
| | Replay | 200 `OfficialReport` | none |
| `GET /api/v1/tasks/{taskId}/official-report` | Employé 403; 404 classes incl. no official report | as above | refused |
| | OK | 200 `OfficialReport` | none |
| `POST …/report-candidates`, `POST …/pdf-files/{fileId}/report-candidate` | official exists | 409 `REPORT_OFFICIAL_DESIGNATED` | `report.candidate.refused` `official-designated` |

Role check precedes body validation; for an invalid body the task is probed first so unknown tasks stay 404. French messages: not ready « Ce rapport n’est pas prêt : il doit être généré avant d’être désigné. »; outdated « Les données ont changé : ce rapport est obsolète et ne peut pas être désigné. »; already official « Un rapport officiel est déjà désigné pour ce contrôle. »; official designated « Un rapport officiel est désigné : aucun nouveau candidat ne peut être créé. »; 422 « Cette demande est invalide. ».

## Contract

- `ReportDesignateRequest`: `{}`, strict.
- `ReportCandidateStatus` extended with `official`, `superseded`. Candidate payload otherwise unchanged; no new property on `ReportCandidate`.
- `OfficialReport` (strict): `{ id, candidateId, origin, designatedAt, designatedBy: { id, displayName }, taskId, auditId, auditRevision, submissionId, bindings: { summaryId, summaryVersion, conformityDecisionId, conformityOutcome }, template: { id, version } | null, source: { fileId } | null, file: { name, byteSize, sha256 } }`. No storage key.
- Error codes listed in the SPEC. Update the generated types and typed client; the `api-client` result union gains the new 409 codes.

## Web

- `report-candidates.tsx`: status labels `official` « Rapport officiel », `superseded` « Remplacé — non officiel »; designation actor/date on the official candidate; on `ready` candidates, « Désigner comme officiel » opens an inline confirmation (`fr.report.designate.*`: prompt, « Confirmer la désignation », « Annuler », « Désignation en cours… »); one request at a time. When the official report exists, the generate button, retry, and designate controls are hidden; the candidate list stays visible with download.
- `pdf-files.tsx`: « Créer un candidat de rapport » hidden when the official report exists (the report area passes `official` to it).
- The report area fetches `GET …/official-report` with every evidence reload and after designation, and refetches the candidate list after designation.
- Handlers: `apps/web/src/app/api/tasks/[taskId]/report-candidates/[candidateId]/designate/route.ts` (POST, CSRF check, session cookie only, status/body pass-through, 503 when unreachable) and `apps/web/src/app/api/tasks/[taskId]/official-report/route.ts` (GET).
- i18n `fr.report`: labels, confirmation text and the four 409 messages. No English text.
