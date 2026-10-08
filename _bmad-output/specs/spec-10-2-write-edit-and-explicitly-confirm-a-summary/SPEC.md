---
id: SPEC-10-2-write-edit-and-explicitly-confirm-a-summary
story: 10.2
status: approved
approved: 2026-10-08
baseline_commit: 0f30601
companions:
  - summary-confirmation-model.md
  - test-plan.md
  - ../spec-10-1-request-an-ai-assisted-summary-draft/ai-summary-model.md
  - ../spec-9-4-add-a-manual-insight/manual-insight-model.md
  - ../spec-9-3-retain-or-discard-proposed-insights-with-provenance/decision-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/specs/spec-10-1-request-an-ai-assisted-summary-draft/SPEC.md
  - _bmad-output/implementation-artifacts/epic-9-retro-2026-10-08.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 10.2 — Write, edit and explicitly confirm a summary

## Why

**Pain.** Story 10.1 leaves the summary as client-side text: it is lost on reload, nothing records who approved it, and nothing stops insights or drafts from changing after the Responsable considers the text final. FR-031–FR-033, DR-005, DR-008, DR-009 and SEC-011 (AI control) require an explicit, attributed confirmation that keeps the initial AI draft, the final text and the inputs actually used, so the report sequence (Stories 10.4 and 11.x) proceeds only from approved text.

**Story statement.** As a Responsable, I want to edit an AI draft or write a manual summary and explicitly confirm it, so that the report sequence proceeds only from my approved text.

**What this delivers.** One insert-only table of confirmed summaries, one confirm route, a public read function for later stories, a lock on insight and draft changes once confirmed, the confirmed summary in the evidence response, and the confirm control and confirmed read-only state in the W5 panel. Reopening is Story 10.3; the conformity decision is 10.4; reports are Epic 11.

**Traceability.** FR-031–FR-033, DR-005, DR-008, DR-009, SEC-011 (AI control), UX-DR2 (summary-editor, button-primary), UX-DR8. Depends on 9.1–9.4 and 10.1 (done). Hands off to 10.3 (reopen), 10.4 (decision gate), 11.x (report gate).

## Capabilities

Table, route, lock, contract and web details are in [summary-confirmation-model.md](summary-confirmation-model.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Confirm a summary
  - **intent:** The Responsable of the owning team saves the final text and explicitly confirms it in one action.
  - **success:**
    - `POST /api/v1/tasks/{taskId}/summary-confirmation` with `{ text, draftId? }` inserts one row and returns 201 with the confirmed summary: `id`, `text`, `confirmedAt`, `confirmedBy` (ID, display name), `summaryInputSetId`, `initialDraft` (or `null`).
    - Text is trimmed, 1–5000 characters after trim, no NUL. The server never accepts actor, date, input set or provider data from the body.
    - Only an accepted, consistent own-team audit can be confirmed; the 9.1 refusal classes apply with the same bodies.
- **CAP-2** — Preserve initial draft, final text, actor/date and actual input set
  - **intent:** The confirmed summary can be audited against what the AI first produced and what it was based on (DR-009).
  - **success:**
    - With `draftId`, the row links the `summary_ai_drafts` row (`generated`, same submission) and the response `initialDraft` carries its ID, text, provider, model, `requestedAt` and `summaryInputSetId`. The draft row is never modified. The final text may equal or differ from the draft.
    - The row stores confirmer ID, server date, task, audit, submission, revision, revision identity, the final text, the **actual** input set (rebuilt by the server at confirmation from the stored snapshot and the retained insights as of that moment) and its SHA-256 `summaryInputSetId`. That identity may differ from the draft's; both are kept and returned.
- **CAP-3** — Manual-only summary
  - **intent:** Writing without AI follows the same gate with no invented AI metadata.
  - **success:** Without `draftId` the row has no draft link and the response has `initialDraft: null`. No provider, model or draft text is stored or shown. A `draftId` that is unknown, failed, or belongs to another submission or task → 422 `VALIDATION_FAILED`, no row.
- **CAP-4** — Zero retained insights does not block
  - **intent:** A summary can be confirmed with no insight.
  - **success:** An audit with zero retained insights (production registry, no manual insight) confirms; the stored input set has `insights: []`.
- **CAP-5** — One confirmation per audit version; insert-only
  - **intent:** A confirmation is never rewritten or lost, and cannot be silently duplicated (DR-009).
  - **success:**
    - UPDATE, DELETE and TRUNCATE on the table are refused by trigger.
    - A second confirm for a submission that already has a confirmed summary → 409 `SUMMARY_ALREADY_CONFIRMED`, no row, text unchanged. Concurrent confirms for one task produce exactly one row.
- **CAP-6** — Lock after confirmation
  - **intent:** Once confirmed, the inputs the summary rests on no longer change under it (epic 9 retro item 3; 10.1 hand-off).
  - **success:** After confirmation, `POST …/manual-insights`, `POST …/insight-decisions` and `POST …/summary-drafts` for that task → 409 `SUMMARY_CONFIRMED` with a French message, no row, no provider call. Before confirmation they behave exactly as before. The check and the confirm are serialized under one per-task lock, so a concurrent add/decision/draft either lands before confirmation (and is in the confirmed input set) or is refused.
- **CAP-7** — No confirmation until explicit and successful
  - **intent:** Nothing downstream may treat unconfirmed text as approved, and a failure never claims confirmation.
  - **success:**
    - `summaries` exports a public read `getConfirmedSummary(executor, submissionId)` returning the confirmed summary or `null`; Stories 10.4 and 11.x must use it as their only gate. Until a row exists it returns `null`.
    - Saving or editing text, requesting a draft, adding insights or deciding proposals never create a confirmed summary.
    - A failed confirm (4xx/5xx or network) shows no confirmed state in the UI and keeps the typed text; the UI shows confirmation only after a valid 201.
    - No conformity decision or report control exists or is enabled in this story; the panel states that the conformity decision and the report stay unavailable until the summary is confirmed.
- **CAP-8** — Evidence response and read-only state
  - **intent:** After reload the Responsable sees the confirmed text, who confirmed it and when.
  - **success:** `AcceptedEvidenceResponse` gains required `summary` (`ConfirmedSummary | null`). When non-null, the W5 panel shows the confirmed text read-only with « Synthèse confirmée », confirmer and date, the initial AI draft block when present (labelled « Brouillon IA initial — non confirmé »), and disables the request-draft button, the manual-insight form and the proposal decision controls. Opening the review still writes only the access row (9.1).
- **CAP-9** — Panel editing and confirm control
  - **intent:** The Responsable edits and confirms in the W5 panel.
  - **success:**
    - Before confirmation the text area from 10.1 stays always editable. A button « Confirmer la synthèse » (primary, UX-DR2) is disabled while the trimmed text is empty or a request is pending, and sends `{ text, draftId }` where `draftId` is the ID of the latest draft that filled or replaced the text (absent for manual text).
    - Confirmation requires a second explicit step: a dialog/inline prompt « Confirmer cette synthèse ? Elle ne pourra plus être modifiée sans la rouvrir. » with « Confirmer » and « Annuler ». Cancel changes nothing.
    - On 201 the panel switches to the confirmed read-only state; on 409 `SUMMARY_ALREADY_CONFIRMED`/`SUMMARY_CONFIRMED` it reloads the evidence and shows the confirmed state; on any other failure it shows « La synthèse n’a pas pu être confirmée. Votre texte est conservé. », keeps the text and allows retry.

## Constraints

- Only the new insert-only table is written by confirmation. Accepted evidence tables, `summary_ai_drafts`, `audit_insight_decisions`, `audit_manual_insights`, `audit_review_accesses` and `tasks.updated_at` are never written by it.
- The confirmed input set is computed by the server with `buildSummaryInputSet` and `collectRetainedInsights` (10.1); the client supplies no input. Hash computed in the API, as in 10.1. No AI provider is called by confirmation.
- No CETEM rule is invented. The 5000-character bound is a technical limit like the 1000 in 9.4; it is one constant, not a business rule. The confirmation carries no conformity value and does not set, infer or enable the machine-conformity decision; that stays an explicit human decision (Story 10.4).
- Confirmed text, draft text and input values never appear in logs. Log lines (`console.info` JSON) carry event, actor ID, fixed class only (`summary.confirmed`, `summary.confirm_refused` with class `forbidden-role|not-found|validation|already-confirmed|locked`).
- Lock enforcement: `audits` commands (`add-manual-insight`, `record-insight-decision`) and `summaries` `request-summary-draft` call the public query `isSummaryConfirmed(transaction, submissionId)` from `summaries/queries/` after taking the shared per-task advisory lock; no module reads another module's tables directly. `boundaries:check` passes; if it rejects the audits→summaries import, move the check into a public function the route layer calls inside the same lock.
- OpenAPI first: new operation, `ConfirmedSummary` schema, `summary` on `AcceptedEvidenceResponse`, error codes `SUMMARY_ALREADY_CONFIRMED` and `SUMMARY_CONFIRMED`; then generated types, `packages/schemas` zod (strict), typed client. `contracts:check` passes. Web goes through a Next route handler with the CSRF check and session cookie only.
- All text in French in `packages/i18n`. `apps/mobile` untouched; no Employé access. Tests use synthetic names, the mock provider, the local PostgreSQL harness (zero skipped). No test deleted, skipped or weakened; no gate script edited.

## Non-goals

- Reopening a confirmed summary, summary versions, invalidating decisions/reports (10.3).
- The machine-conformity decision and any overall conformity (10.4); report generation or designation (Epic 11).
- Persisting unconfirmed edits (see decisions); listing past drafts; editing or withdrawing manual insights.
- Mobile or Employé access; deploying anything; calling a real AI provider.

## Success signal

PostgreSQL route tests prove: a manual-only confirm returns 201 and inserts one row with confirmer, server date, task, audit, submission, revision, identity, text, actual input set and its hash, no draft link, and `initialDraft: null`; an AI-based confirm with an edited text keeps the draft row unmodified, links it, and returns both texts and both input-set identities; adding a manual insight between the draft and the confirmation gives different identities, the confirmed one including it; zero insights confirms; a second confirm gives 409 and one row; two concurrent confirms leave one row; after confirmation manual-insight add, insight decision and draft request give 409 `SUMMARY_CONFIRMED` with no row and no provider call, while before confirmation they still work; refusals (Employé 403, malformed/unknown/other-team/draft/no-audit 404 identical to 9.1, bad text or unusable `draftId` 422, inconsistent snapshot 500) write nothing; UPDATE, DELETE and TRUNCATE are refused; other tables and `tasks.updated_at` are unchanged; the evidence response carries `summary` (null before, the summary after); logs hold no text; `getConfirmedSummary` returns null before and the row after.

Web render tests prove: the confirm button is disabled for empty text, the two-step prompt, Cancel is inert, success shows the read-only confirmed state, a failed confirm keeps the text and shows no confirmed state, 409 reloads into the confirmed state, request/insight/decision controls are disabled once confirmed, the initial draft block shows only when present, no conformity or report control or wording appears, no English text.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, FR-031–FR-033, SEC-011, the 9.x/10.1 code and the Product Owner rules. None is a CETEM business rule.

- **Save-and-confirm is one action.** The AC « saves edits and confirms » is met by a single explicit confirmation that persists the final text. Unconfirmed edits stay client-side as in 10.1 (the draft rows are the audit trail of AI output). 10.3 introduces any unconfirmed persisted version when reopening. This keeps « failed save never claims confirmation » trivially true: no confirmed state exists without a committed row.
- **Explicit confirmation = button plus confirm prompt.** Satisfies « explicitly confirm » (SEC-011) without a default or implicit path; nothing confirms on blur, save or request.
- **Actual input set is rebuilt at confirmation,** not copied from the draft, because the retained set may have changed since the draft; the draft's own identity stays on its row and is returned for comparison (DR-009).
- **Manual-only follows the same gate;** absence of `draftId` means no model metadata is stored (AC).
- **Lock after confirmation covers manual insights, decisions and draft requests** (epic 9 retro action 3; 10.1 decision « 10.2 must refuse drafts after confirmation »). Answers retro open item for 10.2 scope; editing/withdrawing manual insights stays out of scope (9.4 add-only).
- **Reopen unlock belongs to 10.3.** 10.2 ships the lock keyed on « a confirmed summary row exists for the submission »; 10.3 changes the definition of current with its reopen record. The unique-per-submission index is therefore replaced there, not here.
- **Serialization by per-task advisory lock** (`pg_advisory_xact_lock(hashtextextended('summary:' || taskId, 0))`), as the codebase already does for audits. Concurrent confirms produce one row; add/decision/draft either precede confirmation or are refused.
- **Gate for later stories is `getConfirmedSummary`.** Conformity decision and report designation do not exist yet; 10.2 makes the gate available and states in the UI that they are unavailable until confirmation. Final conformity stays an explicit human decision (PO rule); confirmation does not imply any.
- **Text bound 5000, NUL refused.** Technical limits only; NUL refused by the schema to avoid the PostgreSQL 500 recorded in `deferred-work.md`.
- **Confirmed summary appears in the evidence response** so reload shows the state; opening review remains read-only apart from the 9.1 access row.

## Open Questions

None blocking. For the Product Owner, later: whether an unconfirmed summary should be saved server-side between sessions (currently a reload loses unconfirmed text; the AI draft remains in `summary_ai_drafts`).
