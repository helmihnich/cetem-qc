# Test plan — Story 11.4

Local PostgreSQL harness, `memory` storage, synthetic PDFs, scanner `none` or injected fake. Zero skipped. Helpers follow `report-candidate-routes.postgres.test.ts` and `pdf-report-candidate-routes.postgres.test.ts`.

## Route tests — `apps/api/src/official-report-routes.postgres.test.ts`
- **D1** Ready Word candidate (confirmed summary, current decision) → 201 `OfficialReport`; origin, actor, date, `taskId`/`auditId`/`auditRevision`/`submissionId`, summary id/version, decision id/outcome and file metadata equal the candidate's; exactly one `official_reports` row; no row added or changed in candidate/outcome/`stored_*`/evidence/summary/decision tables, `tasks.updated_at` unchanged, no storage call, no review-access row.
- **D2** Ready `uploaded-pdf` candidate → 201 with `source.fileId`, `template: null`. Both decision outcomes designate.
- **D3** Not ready: candidate generating (no outcome) and `failed` → 409 `REPORT_CANDIDATE_NOT_READY`, nothing written.
- **D4** Stale: after summary reopening; after re-confirmation + new decision (old candidate); `outdated` outcome (inputs changed during generation); candidate of another submission; PDF whose file is no longer `ready` (forged status via check rows) → 409 `REPORT_CANDIDATE_OUTDATED`, nothing written; the fresh candidate of the new bindings designates.
- **D5** Exactly one: re-designating the same candidate → 200, same payload, no new row; another ready candidate → 409 `REPORT_ALREADY_OFFICIAL`; two concurrent designations of the same candidate → 201 + 200, one row; of two different candidates → one 201, one 409, one row.
- **D6** Refusals: Employé 403; malformed task or candidate id, unknown task, other-team task, draft/no-audit task, unknown candidate, candidate of another task → 404 identical body (an unknown task never reveals candidates); body other than `{}` → 422; all write nothing.
- **D7** Statuses: after designation the list reads `official` for the designated candidate (also after the task is queried later) and `superseded` for other formerly `ready` candidates (Word and PDF); `outdated` and `failed` unchanged; no candidate row changed.
- **D8** Lock: after designation `POST …/report-candidates` and `POST …/pdf-files/{fileId}/report-candidate` → 409 `REPORT_OFFICIAL_DESIGNATED`, no row; unknown/other-team tasks still 404; a generation blocked in the seam at designation completes and its candidate reads `superseded` (retained evidence, not designatable); confirm, conformity decision, insight decision, manual insight and AI draft requests still refuse as before; no route can UPDATE/DELETE the official row.
- **D9** Participant: after designation `POST …/summary/reopen` → 409 `SUMMARY_DESIGNATED` with no reopening row and the conformity participant not notified; a task with only candidates reopens (200) and its candidates read `outdated`; the reports participant is registered once by `registerDefaultSummaryReopenParticipants()` (idempotent across several built apps) and answers per task and submission (designation on task A does not veto task B).
- **D10** `GET …/official-report`: 200 for the owner after designation (same body as the 201); 404 identical body before designation, unknown, other-team, malformed; Employé 403; no access row.
- **D11** DB: UPDATE, DELETE, TRUNCATE on `official_reports` refused; second row for the same task or the same candidate rejected by PostgreSQL; migration `0025` applies on top of `0022`–`0024` data; migration enumeration test lists it.
- **D12** Logs: `report.official.designated` / `report.official.refused` carry only event, actor ID and class; no IDs, names or paths.
- **D13** Existing 10.3 and 11.1/11.3 tests pass unmodified apart from additive status values; synthetic-participant 10.3 veto tests remain.

## Unit
- **U1** `deriveStatus` table: (outcome × current bindings × official context) → statuses, including `official` surviving changed bindings and `superseded` only from `ready`.
- **U2** `reportsReopenParticipant.hasOfficialDesignation` true/false per task+submission; `onSummaryReopened` writes nothing.

## Web render tests — `apps/web/src/app/report-candidates-render.test.tsx`, `pdf-files-render.test.tsx`
- **W1** « Désigner comme officiel » only on `ready` candidates and only without an official report; absent on every other status.
- **W2** Click opens the confirmation (« Cette désignation est définitive… ») with « Confirmer la désignation » / « Annuler »; cancel sends nothing; confirm sends one request, shows « Désignation en cours… » with controls disabled.
- **W3** After success: « Rapport officiel » with actor/date, « Remplacé — non officiel » on others, generate/retry/designate/attach controls hidden, download still present.
- **W4** French alerts for 409 `REPORT_CANDIDATE_NOT_READY` / `REPORT_CANDIDATE_OUTDATED` / `REPORT_ALREADY_OFFICIAL` / `REPORT_OFFICIAL_DESIGNATED` and 404; no English text.
- **W5** Next route handlers: CSRF rejection, session cookie only, status/body pass-through, 503 when unreachable; narrowed 11.1/11.3 « no designation control » assertions hold and all other web tests pass.

## Contract
- **C1** `contracts:check`: new operations, `OfficialReport`, extended status enum and four error codes in OpenAPI, generated types, zod and client; strict schemas reject extra properties; no storage key in any payload.
