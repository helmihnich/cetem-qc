---
id: SPEC-11-5-view-and-download-authorized-completed-history
story: 11.5
status: in-review
approved: 2026-10-08
baseline_commit: 88ff8d8
companions:
  - history-model.md
  - test-plan.md
  - ../spec-11-4-designate-exactly-one-current-report-official/SPEC.md
  - ../spec-11-4-designate-exactly-one-current-report-official/official-report-model.md
  - ../spec-9-1-review-accepted-audit-evidence-read-only/SPEC.md
  - ../spec-9-1-review-accepted-audit-evidence-read-only/evidence-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md (FR-036, FR-040, DR-009, SEC-003)
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/EXPERIENCE.md (H1, history-record)
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md (AD-3, AD-6, AD-9)
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 11.5 — View and download authorized completed history

## Why

**Pain.** Story 11.4 makes a control complete (an `official_reports` row) but nobody can look back at it. The only readers are Responsable-only and task-by-task: W4 (`accepted-evidence`, writes an access row, shows work in progress) and the candidate download (`report-candidates/{id}/file`, any candidate, Responsable only). An Employé has no way to read a finished control or fetch its report (FR-036, FR-040), and the correct official file cannot be retrieved later.

**Story statement.** As an authorized Responsable or Employé, I want to view completed control history and download its official report, so that I can consult the correct evidence and report later.

**What this delivers.** Three read-only routes shared by both roles (completed list, completed record, official file download), server-side authorization by team (Responsable) or current assignment (Employé), a typed contract and client, and the H1 « Historique » panel in the web app for the Responsable. No migration and no write.

**Traceability.** FR-036, FR-040, DR-001, DR-006, DR-009, SEC-002, SEC-003, AD-3, AD-6, AD-9, UX-DR2 (`history-record`), UX-DR11, EXPERIENCE.md H1. Depends on 9.1 (evidence read), 8.3/8.4 (lineage), 10.x (summary, decision), 11.1–11.4 (done: official report). Siblings: 11.6 (asynchronous freshness). DEP-03 governs acceptance of report *content*; this story serves the stored official file and never inspects it.

## Capabilities

Routes, query composition, payloads and web details are in [history-model.md](history-model.md); test IDs in [test-plan.md](test-plan.md).

- **CAP-1** — Authorized list of completed controls
  - **intent:** A user lists the completed controls they may see: the Responsable those of their own team, the Employé those currently assigned to them. A control is completed when it has an official report (11.4).
  - **success:** `GET /api/v1/history` returns 200 `{ records }`, newest designation first, one item per completed task with task id, task type, establishment, service, assignee (with « — Inactif » when deactivated), audit id and revision, acceptance date, designation date, conformity outcome, official report origin, and replacement relations. Tasks without an official report, other teams' tasks and other Employés' tasks never appear. An empty history is `{ records: [] }`.
- **CAP-2** — Read-only completed record
  - **intent:** Selecting a record shows everything the control produced, unchanged.
  - **success:** `GET /api/v1/history/{taskId}` returns 200 with the task context, accepted submission (submitter, date, rule identity), measured values and stored calculation results, insights with retain/discard decisions and manual insights, the confirmed summary with its provenance and history, the current human conformity decision with its history, the `OfficialReport`, and the lineage. Values are the stored ones. The response has the same content for both roles; no section is withheld by role.
- **CAP-3** — Download the linked official file only
  - **intent:** The user downloads the one official file of a completed control through an authorized endpoint.
  - **success:** `GET /api/v1/history/{taskId}/official-report/file` returns 200 with the official candidate's bytes only (never another candidate's), `Content-Type` `application/vnd.openxmlformats-officedocument.wordprocessingml.document` or `application/pdf`, `Content-Disposition: attachment`, `Content-Length`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`. The SHA-256 of the served bytes equals the stored one, otherwise 500 with no bytes. A PDF whose file is no longer `ready` in `files` → 409 `REPORT_FILE_NOT_READY` (fail closed). No URL or storage key is ever returned, so no access path outlives the request.
- **CAP-4** — Authorization discloses nothing
  - **intent:** A request outside the user's team or assignment, or for a not-completed control, reveals no report or evidence data (SEC-003).
  - **success:** For all three routes: malformed id, unknown task, another team's task, a task not assigned to the Employé (including a task formerly assigned and since reassigned), a draft task, an accepted task without official report all → the same 404 `TASK_NOT_FOUND` body as 9.1. A Responsable never reaches another team's record by id, and an Employé never reaches a team-mate's. Each refusal logs one line with event, actor id and a fixed class only. Unauthenticated → 401 as for other routes. Query strings are rejected 400 `VALIDATION_ERROR` on the list.
- **CAP-5** — Replacement lineage without side effects
  - **intent:** The record shows how the control relates to replacements without changing anything.
  - **success:** The record and the list items show « Remplacement de l’audit X » on a replacement and « Remplacé par l’audit Y » on the original (from `audit_replacement_links`), and the 8.4 recovery source/successor, each as a relation with the linked task id and audit id **only when the viewer is authorized for that task**; otherwise the relation is present with `accessible: false` and no ids. Opening, listing or downloading writes nothing: no row in any table, `tasks.updated_at` unchanged, original measurements and state byte-identical after a replacement exists.
- **CAP-6** — H1 history panel for the Responsable
  - **intent:** The Responsable consults completed controls and downloads the official report from the web app.
  - **success:** A « Historique des contrôles » section lists the completed records (loading, empty « Aucun contrôle terminé pour le moment. », error with « Réessayer »). « Consulter » opens the read-only record (evidence, insights, summary, decision, « Rapport officiel » with origin, designation actor/date and file name/size, lineage lines) with « Télécharger le rapport officiel » and « Retour à l’historique ». The record has no editing, replacement, designation or approval control. A lineage line with an accessible target offers « Ouvrir » for that record when it is completed. The download shows « Téléchargement en cours… » and French alerts for 404, 409 and 500.
- **CAP-7** — Typed contract and client for both roles
  - **intent:** The Employé channel (mobile or any client) can call the same routes with its bearer session.
  - **success:** OpenAPI, generated types, strict zod schemas and `packages/api-client` expose `listHistory`, `getHistoryRecord`, `downloadOfficialReport`; the client sends the bearer token, parses the contract and returns bytes with the served file name and media type for the download.

## Constraints

- Read only. Nothing is written: no migration, no review-access row (`audit_review_accesses` is for W4 work in progress; history reads are logged as lines), no `tasks.updated_at` change, no object-storage write. Opening history must not trigger generation, scan, rescan, insight re-evaluation writes or any provider call.
- Authorization comes from the session only, enforced on the server on every call: Responsable → `getOwnTeamTaskId` predicate; Employé → current `task_assignments.employee_id` (same predicate as `getAssignedEmployeeTask`). No client-supplied role, team or id broadens access. Completed = an `official_reports` row for the task.
- Module boundaries (AD-3): `tasks` owns the authorization predicates; `audits` owns the accepted-snapshot read and lineage; `reports` owns the official report and its file read; `files` owns PDF binaries behind `index.ts`; the route registrar composes them. No module imports a sibling's internals; `boundaries:check` passes. History reads never import write commands.
- Only the official candidate's file is served. The route never accepts a candidate id, file id or storage key from the client.
- OpenAPI first: `HistoryListItem`, `HistoryListResponse`, `HistoryLineageRelation`, `HistoryRecordResponse` and the three operations; reuse `OfficialReport`, `ConfirmedSummary`, `ConformityDecision`, `ManualInsight`, and the evidence schemas of 9.1 unchanged; reuse existing error codes (`TASK_NOT_FOUND`, `FORBIDDEN` unused here, `REPORT_FILE_NOT_READY`, `VALIDATION_ERROR`, `INTERNAL_ERROR`). `contracts:check` passes. Existing payloads keep their values.
- Web goes through Next route handlers that forward only the session cookie, send `no-store`, and stream the download unchanged (GET needs no CSRF check). `apps/mobile` untouched; the web stays Responsable-only.
- No CETEM rule is invented. History displays stored results and the human decision as recorded; it computes nothing, infers no overall conformity and shows no approval wording. The note « La conformité finale de l’appareil est décidée par le Responsable. » is reused where the record shows per-test verdicts.
- Logs: events `history.list.opened`, `history.record.opened`, `history.report.downloaded`, `history.refused` (class `not-found|file-not-ready|inconsistent`), with actor id and fixed class only; never task/audit ids, names, file names or paths.
- All text in French in `packages/i18n` (`fr.history`); identifiers English. Tests: synthetic data and PDFs, in-memory storage, `none`/fake scanner, local PostgreSQL harness (zero skipped). No test deleted, skipped or weakened; no gate script edited. Existing W4 / report-panel behavior and access logging stay unchanged.

## Non-goals

- Mobile history screen and saving files on a device (apps/mobile has no file-system/share capability; adding dependencies is not part of this story). Employé access is delivered at API and typed-client level; the mobile screen is logged in `deferred-work.md`.
- Short-lived signed URLs or any download link; downloading non-official candidates, uploaded PDFs that are not official, or older versions (W7 keeps candidate inspection for the Responsable).
- Editing, reopening, un-designating or replacing from history; « Créer un contrôle de remplacement » stays on the task list (EXPERIENCE: only Responsable, from an accepted audit).
- Search, filters, pagination and export (Phase 1 history is a single list); an access-log viewer; email notification.
- Asynchronous candidate freshness (11.6); the task `state` column; report content inspection (DEP-03).

## Success signal

PostgreSQL route tests (in-memory storage) prove: after designation, the owning Responsable and the assigned Employé each get the completed task in `GET /history` and the full record from `GET /history/{taskId}` with values, results, insights/decisions, confirmed summary with provenance and history, conformity decision and history, `OfficialReport`, and lineage; the download returns exactly the official Word or PDF bytes with the headers above and matching SHA-256, never another candidate's; a task with accepted evidence but no official report, a draft task, another team's task, another Employé's task, a reassigned-away Employé, an unknown id and a malformed id all return the identical 404 body on all three routes and appear in no list; a PDF whose file is no longer ready → 409 `REPORT_FILE_NOT_READY` with no bytes; corrupted stored bytes → 500 with no bytes; a replacement pair shows « Remplacé par » / « Remplacement de » with ids only to a viewer authorized for the other task and `accessible: false` otherwise, while the original record is unchanged; every tested request leaves all table contents and `tasks.updated_at` unchanged and adds no review-access row; logs hold no ids, names or paths.

Web render tests prove: list loading/empty/error, record sections in order, « Rapport officiel » block, lineage lines, download in progress and French alerts, back navigation, no editing/designation/replacement/approval control, no English text; the Next handlers forward only the session cookie, pass status/body through (binary unchanged) and return 503 when unreachable. API-client tests cover the three calls.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, FR-036/FR-040/SEC-003, AD-3/AD-6/AD-9, the code and Product Owner rules. None is a CETEM business rule.

- **Completed = official row.** 11.4 made the `official_reports` row the single completion fact; history lists exactly those tasks. Accepted-but-unfinished work stays in W2/W4.
- **Authorization by team or assignment, not by section.** SEC-003 defines access by team (Responsable) and own assignment (Employé); FR-040 lists the sections of « authorized history » without role split. Both roles get the same read-only record. The only role difference is the absent replacement action (EXPERIENCE H1).
- **Employé = current assignee.** A task reassigned to another Employé (8.4) disappears from the previous assignee's history; a deactivated Employé cannot sign in. No assignment history is used for access.
- **One 404 for every non-authorized case**, like 9.1; refusals are log lines with a fixed class, never a table row or an ID.
- **No access row.** `audit_review_accesses` records the Responsable's review of work in progress (SEC-011 via 9.1). History is a consultation of a finished control, read-only and frequent for two roles; it is logged as structured lines, so a read-only role gets no table side effect.
- **Direct authorized endpoint, no signed URL.** The AC allows either; the endpoint keeps authorization on every request and returns no storage key. Integrity is checked against the SHA-256 stored at generation/upload.
- **Fail closed on the file.** A PDF whose file is no longer `ready` is not served (409 `REPORT_FILE_NOT_READY`); an official Word file whose bytes are missing or differ from the stored hash is 500 with no bytes.
- **Lineage visibility within permissions.** Ids of a related task are returned only when the viewer is authorized for it; otherwise only the relation type with `accessible: false` (no audit or task id, so no cross-team leak).
- **Recovery lineage** (8.4) is shown as a read-only relation like replacement, with the same visibility rule.
- **Insights are the stored, decided ones.** The record shows the proposals evaluated for the stored snapshot through the existing single evaluator, with the stored retain/discard decisions and manual insights, exactly as W4 does; nothing is re-decided.
- **Mobile screen deferred, not dropped.** The API, schemas and client serve the Employé now; the mobile screen and on-device saving need native capabilities outside this story and are recorded in `deferred-work.md`.

## Code review (2026-10-08)

Fresh review against this spec: authorization predicates (team / current assignment), uniform 404, read-only paths (no access row, no write), official-file-only download with SHA-256 and fail-closed 409/500, lineage visibility and module boundaries found conformant. No blocking finding; nothing patched or deferred. Rejected: silent skip of a completed task lacking an accepted snapshot in the list (cannot occur: an official report requires an accepted submission). All gates pass.

## Open Questions

None blocking. For CETEM via the Product Owner (acceptance only, not this build): whether an Employé should see the AI draft/insight sections or only evidence, summary, decision and report (this spec shows the same record to both, per FR-040 and SEC-003); retention duration of completed history beyond Phase 1.
