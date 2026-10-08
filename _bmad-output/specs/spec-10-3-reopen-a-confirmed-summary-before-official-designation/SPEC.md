---
id: SPEC-10-3-reopen-a-confirmed-summary-before-official-designation
story: 10.3
status: approved
approved: 2026-10-08
baseline_commit: 4300bfb
companions:
  - summary-reopening-model.md
  - test-plan.md
  - ../spec-10-2-write-edit-and-explicitly-confirm-a-summary/summary-confirmation-model.md
  - ../spec-10-1-request-an-ai-assisted-summary-draft/ai-summary-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/specs/spec-10-2-write-edit-and-explicitly-confirm-a-summary/SPEC.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 10.3 — Reopen a confirmed summary before official designation

## Why

**Pain.** Story 10.2 makes a confirmed summary permanent: a wrong sentence found after confirmation cannot be corrected, and the lock on insights and drafts never lifts. FR-033, FR-035, FR-038, DR-005 and DR-009 require a correction path that keeps the old text and its confirmer as history, makes anything built on the old text non-current, and forces a fresh confirmation before the report sequence continues — until a report is officially designated.

**Story statement.** As a Responsable, I want to reopen a confirmed summary before report finalization, so that corrections preserve history and invalidate decisions/reports based on old text.

**What this delivers.** An insert-only reopening record and a version number on confirmed summaries; one reopen route; a current-summary state (`confirmed` / `open`) read through the `summaries` public contract; history of prior versions in the evidence response; a participant contract through which the future conformity (10.4) and report (11.x) modules veto and absorb a reopening without `summaries` reading their tables; the reopen control and version history in the W5 panel.

**Traceability.** FR-033, FR-035, FR-038, DR-005, DR-009, AD-8, UX-DR8, UX-DR10, OD-10. Depends on 10.1 and 10.2 (done). Hands off to 10.4 (fresh decision) and 11.x (candidates, designation).

## Capabilities

Table, commands, participant contract, route, contract and web details are in [summary-reopening-model.md](summary-reopening-model.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Reopen explicitly
  - **intent:** The Responsable of the owning team reopens the current confirmed summary of an accepted audit, in one explicit action.
  - **success:**
    - `POST /api/v1/tasks/{taskId}/summary-reopening` with body `{}` inserts one reopening row and returns 201 with the new open version: `version`, `reopenedAt`, `reopenedBy` (ID, display name), `previous` (the reopened `ConfirmedSummary`).
    - Actor and date come from the session and the server clock only. Role/ownership/404 refusal classes are those of 10.2.
    - Reopening writes nothing but the reopening row.
- **CAP-2** — History is preserved
  - **intent:** Old text, confirmer and date stay readable and unchanged (DR-009).
  - **success:**
    - The reopened `confirmed_summaries` row is never modified (insert-only triggers stay). Its initial draft link, input set and identity are untouched.
    - The evidence response lists every earlier version in `summaryHistory`, newest first, each with `version`, text, confirmer, `confirmedAt`, `reopenedBy`, `reopenedAt`, and its `initialDraft` or `null`.
- **CAP-3** — New unconfirmed version, same gates again
  - **intent:** After reopening there is no current confirmed summary until the Responsable confirms again.
  - **success:**
    - `getConfirmedSummary` returns `null` after a reopening and the new confirmed row after the next confirmation; `getSummaryState` (new) reports `{ state: "open", nextVersion }` or `{ state: "confirmed", summary }`.
    - The 10.2 confirm route works again; it stores `version = previous + 1` and rebuilds the actual input set at that moment. A second confirm without a reopening in between → 409 `SUMMARY_ALREADY_CONFIRMED`.
    - The 10.2 lock lifts while the summary is open: manual insights, insight decisions and draft requests work again, and lock again after the new confirmation.
    - The reopened text is offered as the starting text of the editor; it is not persisted as an unconfirmed server version (see decisions).
- **CAP-4** — Only one reopening per confirmation; nothing to reopen otherwise
  - **intent:** No duplicate or empty reopening.
  - **success:** Reopening when the summary is not confirmed (never confirmed, or already reopened) → 409 `SUMMARY_NOT_CONFIRMED`, no row. Concurrent reopens of one task produce exactly one row; the other gets 409. A concurrent confirm and reopen are serialized by the per-task lock of 10.2.
- **CAP-5** — Refused after official designation
  - **intent:** A designated report fixes its summary (AC).
  - **success:** The command asks each registered participant `hasOfficialDesignation(submissionId)`; if any says yes → 409 `SUMMARY_DESIGNATED`, no row, no participant notified. Production registers no participant yet (no designation can exist before Story 11.4), so the check passes; tests register synthetic participants. Story 11.4 must register its participant.
- **CAP-6** — Dependent decisions and reports become non-current through public contracts
  - **intent:** A conformity decision or report candidate built on the old text can no longer be treated as current or designated (AC).
  - **success:**
    - `summaries` defines the public participant interface `SummaryReopenParticipant` and a registry; in the reopen transaction, after the row is inserted, every participant's `onSummaryReopened(transaction, { taskId, submissionId, reopenedSummaryId, reopenedAt, actorId })` is called. A participant failure rolls the whole reopening back (→ 500, no row).
    - `summaries` never reads or writes conformity or report tables. Conformity and reports bind their records to the confirmed summary `id`; a record is current only if its bound `id` equals `getConfirmedSummary(...).id`. After a reopening that value is `null`, so every earlier-bound record is non-current without being deleted.
    - 10.4 and 11.x implement participants (mark decision historical; mark candidates outdated/superseded and non-designatable) and register them. This story ships the contract, the registry and tests with synthetic participants only.
- **CAP-7** — Evidence response and panel
  - **intent:** The Responsable sees the version state and reopens from the W5 panel.
  - **success:**
    - `AcceptedEvidenceResponse` gains required `summaryHistory` (array, possibly empty) and `summaryVersion` (`{ number, state: "confirmed" | "open" }`); `summary` keeps its 10.2 meaning (current confirmed or `null`) and `ConfirmedSummary` gains `version`.
    - Confirmed state: button « Rouvrir la synthèse » (secondary) opens a second-step prompt « Rouvrir cette synthèse ? Cette version restera dans l’historique ; la nouvelle version devra être confirmée à nouveau, et tout élément fondé sur l’ancien texte ne sera plus courant. » with « Rouvrir » / « Annuler »; Cancel changes nothing.
    - On 201 the panel switches to the editable state with the previous text prefilled and the note « Version {n} à confirmer — la version {n-1} reste dans l’historique. ». On 409 `SUMMARY_NOT_CONFIRMED`/`SUMMARY_DESIGNATED` it reloads evidence and shows the French message; any other failure shows « La synthèse n’a pas pu être rouverte. » and stays confirmed.
    - « Historique des synthèses » lists earlier versions read-only, each marked « Version n — remplacée » with confirmer and date. The panel shows no conformity-decision or report control.

## Constraints

- Written by reopening: only the new `summary_reopenings` row. Accepted evidence, `confirmed_summaries` rows, `summary_ai_drafts`, decisions, manual insights, access rows and `tasks.updated_at` are never written. Reopening calls no AI provider and no access row.
- No CETEM rule is invented. No reason field, delay, count limit or role beyond the Responsable of the owning team is added: the AC require none. Final conformity stays an explicit human decision; reopening neither sets nor infers one and makes any later one historical by binding (10.4).
- `summaries` exposes participants and queries only through its public entry (`summaries/` public exports); `audits`, future `conformity` and `reports` modules call those and never another module's tables or repositories. `boundaries:check` passes; where it rejects an import, move the call to a public function used by the route layer inside the same lock.
- Serialization: reopen, confirm and the locked commands all take the per-task advisory lock of 10.2 (`lockTaskSummary`). `isSummaryConfirmed` is redefined as « the latest confirmed row exists and has no reopening row »; every 10.2 caller keeps working unchanged.
- Migration `0020` is additive: new table, new `version` column on `confirmed_summaries` (existing rows get 1), unique index replaced by `(submission_id, version)`. Insert-only triggers on the new table; the existing triggers stay. No existing row is rewritten (the column default is applied by `ADD COLUMN`, which does not fire the UPDATE trigger).
- OpenAPI first: operation, `SummaryReopening` / `SummaryHistoryItem` schemas, `version` on `ConfirmedSummary`, `summaryHistory` and `summaryVersion` on `AcceptedEvidenceResponse`, error codes `SUMMARY_NOT_CONFIRMED` and `SUMMARY_DESIGNATED`; then generated types, strict zod, typed client. `contracts:check` passes. Web goes through a Next route handler with the CSRF check and session cookie only.
- Logs carry event, actor ID and fixed class only (`summary.reopened`, `summary.reopen_refused` with class `forbidden-role|not-found|not-confirmed|designated`); never text.
- All text in French in `packages/i18n`. `apps/mobile` untouched; no Employé access. Tests: synthetic names, mock provider, local PostgreSQL harness (zero skipped). No test deleted, skipped or weakened; no gate script edited. Existing evidence/10.2 tests change only by adding the new required fields.

## Non-goals

- The machine-conformity decision, its storage or its participant (10.4); report generation, candidates, designation or their participant (Epic 11). This story ships only the contract they plug into.
- Persisting unconfirmed text server-side; editing or withdrawing manual insights; deleting history.
- Reopening after designation (refused, not implemented as an exception); a reopening reason; undoing a reopening.
- Mobile or Employé access; deploying anything; calling a real AI provider.

## Success signal

PostgreSQL route tests prove: confirm then reopen returns 201 with `version: 2`, `previous` equal to the confirmed summary, and one reopening row with actor and server date; the reopened `confirmed_summaries` row is byte-identical afterwards; `getConfirmedSummary` is null and the evidence response shows `summary: null`, `summaryVersion { 2, open }` and the old version in `summaryHistory`; manual insight, decision and draft request succeed again, a new confirm stores `version 2`, a different input set when an insight was added, and the old row stays; a second confirm without a reopening → 409; reopen when unconfirmed or already reopened → 409 `SUMMARY_NOT_CONFIRMED`; two concurrent reopens leave one row; a synthetic participant reporting a designation gives 409 `SUMMARY_DESIGNATED`, no row, no `onSummaryReopened` call; synthetic participants receive `onSummaryReopened` once inside the transaction and a throwing participant rolls the reopening back (500, no row, summary still confirmed); a synthetic record bound to the old summary `id` is non-current while one bound to the new `id` is current; refusals (Employé 403, malformed/unknown/other-team/draft/no-audit 404 identical to 9.1, extra body property 422) write nothing; UPDATE, DELETE, TRUNCATE on `summary_reopenings` are refused; other tables and `tasks.updated_at` unchanged; logs hold no text.

Web render tests prove: reopen button only in the confirmed state, two-step prompt, Cancel inert, success shows the editable state with prefilled previous text and the version note, failure keeps the confirmed state with the French message, 409 reloads, history list read-only and ordered, request/insight/decision controls re-enabled after reopening and disabled again after re-confirmation, no conformity decision or report control, no English text.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, FR-033/035/038, DR-005/009, the 10.2 code and the Product Owner rules. None is a CETEM business rule.

- **Conformity decisions and report candidates do not exist yet,** so « becomes historical / outdated » is delivered as a contract, not as table changes: binding to the confirmed summary `id` makes older records non-current by construction, and a participant interface lets 10.4/11.x also mark them explicitly in the same transaction. The AC bullet on module contracts is satisfied by the interface and its tests.
- **Official designation cannot exist before 11.4,** so « after designation reopening is unavailable » is a participant veto (`hasOfficialDesignation`), exercised with synthetic participants. 11.4 must register one; this is recorded as its hand-off.
- **The new unconfirmed version is a version number plus the reopening row, not a persisted text.** This keeps the 10.2 decision (unconfirmed text is client-side; failed save never claims confirmation) and still creates a distinct « version n to confirm » that is historical-safe. The open question on server-side drafts stays with the PO.
- **Version = confirmation count per submission,** stored on the confirmed row; reopening is a separate insert-only record, never an UPDATE of the confirmed row.
- **Reopened input set is rebuilt at the next confirmation** (as in 10.2), so insights added during the open phase are in the new set; the old row keeps its own.
- **Unlock of the 10.2 lock while open** is required for corrections to be meaningful (insights/drafts feed the revised text); it re-locks on the next confirmation.
- **No reason, no extra role.** The AC and rules do not ask for one; adding one would invent a rule.
- **Reopen is Responsable-only for the owning team,** like every 9.x/10.x review action.

## Open Questions

None blocking. For the Product Owner, later: whether an unconfirmed revised summary should be saved server-side across sessions (carried from 10.2).
