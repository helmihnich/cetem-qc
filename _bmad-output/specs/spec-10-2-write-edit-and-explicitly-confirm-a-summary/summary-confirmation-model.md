# Summary confirmation model (CAP-1 to CAP-9)

## Migration `apps/api/src/db/migrations/0019_confirmed_summaries.sql`

```sql
CREATE TABLE confirmed_summaries (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  confirmed_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  revision_identity jsonb NOT NULL,
  initial_draft_id uuid REFERENCES summary_ai_drafts(id) ON DELETE RESTRICT,
  final_text text NOT NULL CHECK (char_length(final_text) BETWEEN 1 AND 5000 AND position(chr(0) in final_text) = 0),
  summary_input_set_id text NOT NULL CHECK (summary_input_set_id ~ '^[0-9a-f]{64}$'),
  input_set jsonb NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX confirmed_summaries_submission_idx ON confirmed_summaries (submission_id);
-- history_only + no_truncate triggers, exactly like audit_manual_insights (refuse_history_change, refuse_evidence_truncate)
```

No existing table changes. Update any test enumerating migrations only by adding 0019. Story 10.3 replaces the unique index when it introduces reopening.

## Command (`apps/api/src/modules/summaries/commands/confirm-summary.ts`)

`confirmSummary(pool, responsableId, taskId, { text, draftId? })` →
`{ type: "confirmed"; summary } | { type: "already-confirmed" } | { type: "invalid-draft" } | { type: "not-found" } | { type: "inconsistent" }`.

One transaction:
1. `getAcceptedSubmissionForReview` (same snapshot seam and `isConsistentSnapshot` as 10.1); none → `not-found`.
2. `pg_advisory_xact_lock(hashtextextended('summary:' || taskId, 0))`; then re-check `isSummaryConfirmed` → `already-confirmed`.
3. If `draftId`: load the row from `summary_ai_drafts` where `id`, `task_id`, `submission_id` match and `status = 'generated'`; none → `invalid-draft` (before any insert).
4. Evaluate proposals, read decisions and manual insights, `collectRetainedInsights`, `buildSummaryInputSet`, SHA-256 of `canonicalJson` (the exact 10.1 code path; extract a shared helper in `summaries` rather than duplicating).
5. Insert the row; join `identity_accounts` for the display name; return the summary with `initialDraft` from step 3.

No provider call. No access row.

## Public reads (`apps/api/src/modules/summaries/queries/`)

- `getConfirmedSummary(executor, submissionId)` → `ConfirmedSummary | null` (with `initialDraft` joined). Used by the evidence response and by 10.4/11.x as the only gate.
- `isSummaryConfirmed(executor, submissionId)` → boolean. Used by the lock.

## Lock (CAP-6)

`add-manual-insight`, `record-insight-decision` and `request-summary-draft` (its read transaction A) take the same advisory lock and call `isSummaryConfirmed` before doing anything; a confirmed summary → outcome `{ type: "summary-confirmed" }` → route 409 `SUMMARY_CONFIRMED`. The 10.1 provider call is not made when refused. Transaction B of the draft request re-takes the lock and re-checks: if a confirmation landed during the provider call, no row is inserted and the route answers 409 `SUMMARY_CONFIRMED`.

## Route

`POST /api/v1/tasks/{taskId}/summary-confirmation`, body `{ text, draftId? }` (strict), `Cache-Control: no-store`.

| Case | Status | Body | Server log |
|---|---|---|---|
| Employé | 403 `FORBIDDEN` | `ApiError` | `{ event: "summary.confirm_refused", class: "forbidden-role", actorId }` |
| Malformed/unknown/other team/draft/no audit | 404 `TASK_NOT_FOUND`, identical to 9.1 | `ApiError` | class `not-found` |
| Invalid body, empty/over-long/NUL text, unusable `draftId` | 422 `VALIDATION_FAILED` | `ApiError` | class `validation` |
| Already confirmed | 409 `SUMMARY_ALREADY_CONFIRMED` | `ApiError` | class `already-confirmed` |
| Inconsistent snapshot or other failure | 500 `INTERNAL_ERROR` | `ApiError` | none |
| Confirmed | 201 | `ConfirmedSummary` | `{ event: "summary.confirmed", actorId }` |

Locked routes (manual-insights, insight-decisions, summary-drafts) answer 409 `SUMMARY_CONFIRMED`, log `{ class: "locked" }` with the existing refusal event of that route. Role check precedes body validation; for an invalid body the task is probed first so unknown tasks stay 404 (as 9.3/9.4/10.1).

## Contract

- `ConfirmedSummary`: `{ id, text, confirmedAt, confirmedBy: { id, displayName }, summaryInputSetId, initialDraft: { id, text, provider, model, requestedAt, summaryInputSetId } | null }`; strict zod, `summaryInputSetId` `^[0-9a-f]{64}$`.
- Request `SummaryConfirmationRequest`: `{ text: string (1..5000 after trim, no NUL), draftId?: uuid }`, strict.
- `AcceptedEvidenceResponse.summary`: required, `ConfirmedSummary | null`. Existing evidence tests are updated only by adding the field.
- New error codes `SUMMARY_ALREADY_CONFIRMED`, `SUMMARY_CONFIRMED`; operations `confirmSummary` (201/403/404/409/422/500) and 409 added to `addManualInsight`, `recordInsightDecision`, `requestSummaryDraft`.

## Web (`summary-draft.tsx`, `accepted-evidence.tsx`)

- `SummaryDraftPanel` takes the evidence `summary`. When `summary` is null: 10.1 behaviour plus the button « Confirmer la synthèse » and the prompt « Confirmer cette synthèse ? Elle ne pourra plus être modifiée sans la rouvrir. » (« Confirmer » / « Annuler »). It tracks `draftId` of the draft that last filled or replaced the text; manual typing keeps it (the stored final text is compared server-side to nothing: the link records the draft the text started from).
- When `summary` is set: heading « Synthèse confirmée », text read-only, « Confirmée par {name} le {date} », the initial draft block « Brouillon IA initial — non confirmé » with provider/model/date when present, request-draft button, manual-insight form and decision controls disabled.
- Always visible while unconfirmed: « Tant que la synthèse n’est pas confirmée, la décision de conformité et le rapport restent indisponibles. »
- Handler `apps/web/src/app/api/tasks/[taskId]/summary-confirmation/route.ts`: POST, `rejectCrossOriginMutation`, session cookie only, `no-store`, passes API status/body through, 503 when unreachable. Existing manual-insight, decision and draft handlers already pass 409 through; verify with tests.
- i18n additions under `fr.summary` (all labels above, failure text « La synthèse n’a pas pu être confirmée. Votre texte est conservé. », 409 message « La synthèse est confirmée : cette action n’est plus possible. »). No « Machine conforme », « Rapport » control or wording.
