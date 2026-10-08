# Test plan — Story 11.5

Local PostgreSQL harness, `memory` storage, synthetic PDFs, scanner `none` or injected fake, zero skipped. Helpers follow `official-report-routes.postgres.test.ts`, `evidence-review-routes.postgres.test.ts` and `replacement-routes.postgres.test.ts`.

## Route tests — `apps/api/src/history-routes.postgres.test.ts`
- **H1** Completed Word task: Responsable and assigned Employé each get the task in `GET /history` (all list fields, replacement relations empty); an accepted task without official report, a draft task, another team's task and another Employé's task are absent; empty history → `{ records: [] }`; order newest designation first.
- **H2** `GET /history/{taskId}` for both roles: values and stored results equal the accepted snapshot; insights, retain/discard decisions and manual insights present; confirmed summary with provenance and `summaryHistory`; conformity decision and `conformityHistory` (both outcomes); `officialReport` equals the 11.4 payload; same body content for both roles (task context equal).
- **H3** Uploaded-PDF task: record shows `origin: uploaded-pdf`, `source.fileId`, `template: null`.
- **H4** Download Word: exact stored bytes, docx media type, `attachment`, `Content-Length`, `nosniff`, `no-store`; SHA-256 equals stored. Download PDF: exact bytes, `application/pdf`, official name pattern. With several candidates on the task (superseded Word and PDF), only the official candidate's bytes are served; no id in the request selects another.
- **H5** Fail closed: PDF made not `ready` (forged check rows) → 409 `REPORT_FILE_NOT_READY`, no bytes; missing Word object or altered stored bytes → 500, no bytes, nothing logged beyond the fixed class.
- **H6** Authorization 404 matrix on all three routes, identical bodies (byte-for-byte equal to 9.1's): malformed id, unknown id, other-team task (Responsable), other Employé's task, Employé reassigned away (8.4), draft task, accepted task without official report. Unauthenticated → 401. `GET /history?x=1` → 400.
- **H7** Lineage: replacement pair where both tasks are completed — original shows `replaced-by`, replacement shows `replacement-of`, ids present for the authorizing Responsable; for an Employé assigned only to the original the `replaced-by` relation is `accessible: false` with `taskId`, `auditId`, `completed` null; recovery source/successor behave the same; after the replacement exists the original record, its measurements and `officialReport` are byte-identical to before; `completed` false when the target has no official report yet.
- **H8** No side effects: snapshot of every table row count/content (including `audit_review_accesses`, `report_candidates`, `stored_files`, `official_reports`) and `tasks.updated_at` before and after repeated list/record/download calls of both roles; no storage `put`/`delete`, no scan, no provider call.
- **H9** Inconsistent snapshot (seam reshaping results identity) → record 500 `INTERNAL_ERROR`, no data in the body; list and download unaffected for other tasks.
- **H10** Logs: `history.list.opened`, `history.record.opened`, `history.report.downloaded`, `history.refused` carry only event, actor id and class; no task/audit id, name, file name or path.
- **H11** Existing 9.1 and 11.x route tests pass unmodified; W4 still writes its access row and the candidate download route still serves candidates unchanged.

## Unit
- **U1** `listAuthorizedTaskIds` / `getAuthorizedTaskSummary` per role and `—Inactif` assignee; malformed uuid → undefined.
- **U2** Lineage visibility resolver: accessible/inaccessible/completed combinations.
- **U3** Download filename and media-type selection per origin.

## Contract / client
- **C1** `contracts:check`: three operations, schemas strict (extra properties rejected), no storage key or URL in any payload; binary response declared.
- **C2** `packages/api-client`: `listHistory`, `getHistoryRecord` send the bearer token and parse the contract; `downloadOfficialReport` returns bytes, parsed file name and media type, and maps 404/409/500.

## Web render tests — `apps/web/src/app/history-render.test.tsx`
- **W1** List: loading, empty message, error with « Réessayer », rows with « Consulter », order as returned.
- **W2** Record: section order (task context, evidence, results, insights with decisions, summary, decision, « Rapport officiel », lineage); read-only (no decide/add/confirm/reopen/designate/replace/approve control); the final-conformity note appears once; « Retour à l’historique ».
- **W3** Lineage lines for accessible and inaccessible relations; « Ouvrir » only when accessible and completed.
- **W4** Download: click → one request, « Téléchargement en cours… », controls disabled, success clears; French alerts for 404, 409, 500/network; no English text.
- **W5** Next handlers: only the session cookie forwarded, `no-store`, status/body/binary headers passed through, 503 when unreachable; no CSRF requirement for GET.
