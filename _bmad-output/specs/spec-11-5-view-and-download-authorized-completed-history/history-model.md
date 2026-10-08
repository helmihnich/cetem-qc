# History model (CAP-1 to CAP-7)

No migration. Follow real names in the code where this file says « the existing … ». Registrar: new `apps/api/src/routes/register-history-routes.ts`, wired where the other registrars are; all responses `Cache-Control: no-store`; session required as for every `/api/v1` route.

## Authorization (`tasks` module, `queries/authorized-task.ts`)

```ts
type HistoryActor = { id: string; role: "responsable" | "employe" };
listAuthorizedTaskIds(pool, actor): Promise<string[]>            // all tasks the actor may see
getAuthorizedTaskSummary(pool, actor, taskId): Promise<AuthorizedTaskSummary | undefined>
// AuthorizedTaskSummary = { id, type, establishment, service, assignee }  (assignee « — Inactif » rule as getOwnTeamTaskSummary)
```

- Responsable: same predicate as `getOwnTeamTaskId` / `getOwnTeamTaskSummary` (team → assignment → employee of the team).
- Employé: `task_assignments.employee_id = actor.id` (as `getAssignedEmployeeTask`), employee account `role = 'employe'`.
- Malformed uuid → `undefined`. The registrar passes only IDs returned here to the other modules; nothing from the request reaches a query before authorization.

## Reads composed by the registrar

| Need | Owner | Function |
|---|---|---|
| Completed + official report | `reports` | `listOfficialReports(pool, taskIds)` → `OfficialReport[]` (batch over `readOfficialReport`); `getOfficialReportFile(pool, taskId)` (see Download) |
| Accepted snapshot without owner check | `audits` | new `getAcceptedSubmissionByTask(pool, taskId)`; `getAcceptedSubmissionForReview` is refactored to call it after `getOwnTeamTaskId` with identical output |
| Evidence, insights, decisions, manual insights | `audits` | new `readCompletedEvidence(pool, taskId)` in `queries/`: snapshot, `isConsistentSnapshot` check (inconsistent → 500 `INTERNAL_ERROR`, nothing returned), `evaluateProposalsForSnapshot`, `getCurrentInsightDecisions`, `getManualInsights`; **no access insert** |
| Summary, summary history | `summaries` | `getSummaryState`, `getSummaryHistory` via `index.ts` / existing imports used by `register-evidence-routes.ts` |
| Decision, history | `conformity` | `getCurrentConformityDecision`, `getConformityHistory`, `getConformityOutcomes` |
| Lineage | `audits` | `readTaskAcceptanceAndLineage` (existing) |

`openAcceptedEvidenceForReview` (W4) is not changed; the shared pieces (`isConsistentSnapshot`, `evaluateProposalsForSnapshot`) are reused, not copied.

## Lineage with visibility

For each relation found by `readTaskAcceptanceAndLineage` (`replacementOf`, `replacedBy`, `recoverySource`, `recoverySuccessorTaskId`) the registrar asks `listAuthorizedTaskIds` once and resolves:

```ts
HistoryLineageRelation = {
  relation: "replacement-of" | "replaced-by" | "recovery-source" | "recovery-successor";
  accessible: boolean;
  taskId: string | null;   // null when not accessible
  auditId: string | null;  // null when not accessible or the target has no audit yet
  completed: boolean | null; // null when not accessible; true when the target has an official report
}
```

An inaccessible relation carries no id and no `completed` flag. « Ouvrir » in the web is offered only when `accessible && completed`.

## Routes

| Route | Case | Status / body | Log |
|---|---|---|---|
| `GET /api/v1/history` | Query string present | 400 `VALIDATION_ERROR` (as `employee/tasks`) | none |
| | OK | 200 `HistoryListResponse` | `history.list.opened` |
| `GET /api/v1/history/{taskId}` | Malformed id, unknown, other team, unassigned/reassigned-away, no accepted submission, no official report | 404 `TASK_NOT_FOUND` « Tâche introuvable. » identical body | `history.refused` `not-found` |
| | Inconsistent snapshot | 500 `INTERNAL_ERROR` « Le contrôle terminé n’a pas pu être chargé. » | `history.refused` `inconsistent` |
| | OK | 200 `HistoryRecordResponse` | `history.record.opened` |
| `GET /api/v1/history/{taskId}/official-report/file` | 404 cases as above | 404 | `not-found` |
| | PDF not `ready` | 409 `REPORT_FILE_NOT_READY` « Le fichier du rapport officiel n’est pas disponible. » | `file-not-ready` |
| | Bytes missing or hash mismatch | 500 `INTERNAL_ERROR` « Le rapport n’a pas pu être téléchargé. » | `inconsistent` |
| | OK | 200 bytes | `history.report.downloaded` |

No role check returns 403: both roles are valid, and authorization is the 404 predicate. A list is never partially authorized: it holds only authorized, completed tasks.

## Download (`reports` module)

`getOfficialReportFile(client, taskId)` (read only, in `queries/official-report.ts`): joins `official_reports` → `report_candidates` → `report_candidate_outcomes`, returning `{ origin, fileName, storageRef | null, storedFileId | null, designatedAt, byteSize, sha256 }` for the official candidate only. The registrar:

1. `uploaded-pdf`: `readStoredFile(pool, storage, { taskId, fileId })` from `files/index.ts`; `undefined` → 409 `REPORT_FILE_NOT_READY`. Media type `application/pdf`; name `Rapport-LCQ-officiel-<yyyymmdd of designation>-<first 8 hex of candidate id>.pdf`.
2. `generated-word`: `storage.get(storageRef)`; `undefined` → 500. Media type docx; name = stored `fileName`.
3. SHA-256 of the bytes must equal `sha256` (use the same digest helper the module already uses to store it); mismatch → 500 `inconsistent`, no bytes.

The storage instance is the one `register-report-routes.ts` uses (`reportCommandTestSeams.storage` in tests); share one factory rather than creating a second configured storage. No candidate id, file id or key is read from the request.

## Contract

- `HistoryListItem` (strict): `{ taskId, type, establishment, service, assignee, auditId, auditRevision, acceptedAt, designatedAt, conformityOutcome, reportOrigin, lineage: HistoryLineageRelation[] }`.
- `HistoryListResponse`: `{ records: HistoryListItem[] }`, ordered by `designatedAt` desc then task id.
- `HistoryRecordResponse` (strict): the fields of `AcceptedEvidenceResponse` (`task`, `submission`, `identity`, `values`, `results`, `insights`, `insightDecisions`, `manualInsights`, `summary`, `summaryVersion`, `summaryHistory`, `conformityDecision`, `conformityHistory`) with `summary` and `conformityDecision` non-null (a completed control has both), plus `officialReport: OfficialReport` and `lineage: HistoryLineageRelation[]` replacing the 9.1 lineage object. `task` uses the 9.1 shape from `getAuthorizedTaskSummary`.
- Download: `200` with `content: { docx media type, application/pdf }`, `format: binary`, and headers `Content-Disposition`, `Content-Length`.
- Generated types, `packages/schemas` zod, `packages/api-client` (`listHistory`, `getHistoryRecord`, `downloadOfficialReport` → `{ bytes, fileName, mediaType }` with filename parsed from `Content-Disposition`; non-200 statuses map to the same result-union style as the existing client calls).

## Web (Responsable only)

- Panel `apps/web/src/app/history.tsx` mounted under the task list (`page.tsx` / `task-list.tsx` area), titled « Historique des contrôles » (`fr.history.*`). States: loading (`role="status"`), empty, error + « Réessayer ».
- `HistoryRecordView` reuses `EvidenceInputSections`, the 9.1 results/insights/summary/decision presenters in read-only mode (no `onDecide`/`onAdd`, `locked`), and a « Rapport officiel » block: origin label, designated by/date, file name, size in Ko, short SHA-256, conformity outcome of the decision. Lineage lines: « Remplacement de l’audit X » / « Remplacé par l’audit Y » for accessible targets, « … un audit hors de votre périmètre » otherwise; recovery lines as in 9.1.
- « Télécharger le rapport officiel » fetches the handler as a blob, saves via an object-URL anchor; « Téléchargement en cours… », controls disabled; alerts: 404 « Tâche introuvable. », 409 « Le fichier du rapport officiel n’est pas disponible. », other « Le rapport n’a pas pu être téléchargé. ».
- Handlers: `apps/web/src/app/api/history/route.ts`, `…/history/[taskId]/route.ts`, `…/history/[taskId]/official-report/file/route.ts`: GET, forward only the session cookie, `no-store`, status/body (binary and `Content-Type`/`Content-Disposition`/`Content-Length`) unchanged, 503 when the API is unreachable.
- i18n `fr.history`: heading, empty, retry, open, back, record sections reuse existing `fr` labels, report-block labels, download states, alerts. No English text.
