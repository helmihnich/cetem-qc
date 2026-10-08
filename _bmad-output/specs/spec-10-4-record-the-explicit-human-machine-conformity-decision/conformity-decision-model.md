# Conformity decision model (CAP-1 to CAP-6)

## Migration `apps/api/src/db/migrations/0021_conformity_decisions.sql`

```sql
CREATE TABLE conformity_decisions (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  confirmed_summary_id uuid NOT NULL UNIQUE REFERENCES confirmed_summaries(id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN ('machine-conforme', 'machine-non-conforme')),  -- no DEFAULT
  decided_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conformity_decision_invalidations (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id uuid NOT NULL UNIQUE REFERENCES conformity_decisions(id) ON DELETE RESTRICT,
  reopened_summary_id uuid NOT NULL REFERENCES confirmed_summaries(id) ON DELETE RESTRICT,
  invalidated_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  invalidated_at timestamptz NOT NULL
);
-- history_only + no_truncate triggers on both tables, exactly like confirmed_summaries / summary_reopenings
```

`UNIQUE (confirmed_summary_id)` enforces one decision per confirmed summary. The `confirmed_summary_id` FK carries the binding of 10.3; no foreign key from `summaries` tables to these. `invalidated_at` is the reopening's `reopenedAt` handed by the participant (same instant as the reopening row). Update any test enumerating migrations by adding 0021.

## Module `apps/api/src/modules/conformity/`

- `commands/record-conformity-decision.ts`, `queries/conformity-decision.ts`, `reopen-participant.ts` (exported through `index.ts`). Nothing else is public.
- Imports from `summaries`: only through the new `modules/summaries/index.ts` (below). From `audits`: `queries/accepted-submission.js`, `commands/record-review-access.js` (`isConsistentSnapshot`, `reviewCommandTestSeams`) exactly as 10.2/10.3 do.

### `summaries/index.ts` (new public entry)

Re-exports, unchanged in behaviour: `SummaryReopenParticipant`, `registerSummaryReopenParticipant`, `listSummaryReopenParticipants`, `summaryReopenParticipantTestSeams`, and from `queries/confirmed-summary.ts`: `getConfirmedSummary`, `getSummaryState`, `lockTaskSummary`, types `ConfirmedSummary`, `SummaryState`. Existing intra-module imports and the route layer keep working. If `boundaries:check` rejects a re-export shape, import the queries directly from `summaries/queries/...` (already public) and re-export only the participant API from `index.ts`.

## Command

`recordConformityDecision(pool, responsableId, taskId, outcome)` →
`{ type: "recorded"; decision } | { type: "not-confirmed" } | { type: "already-decided" } | { type: "not-found" } | { type: "inconsistent" }`.

`outcome` is the only caller-supplied value. One transaction:
1. `lockTaskSummary(transaction, taskId)`; `getAcceptedSubmissionForReview` (same seam and `isConsistentSnapshot`); none → `not-found`.
2. `getSummaryState`; not `confirmed` → `not-confirmed`.
3. Insert into `conformity_decisions` with `confirmed_summary_id = state.summary.id`. A unique violation on `confirmed_summary_id` (or an existing row read first) → `already-decided`; the lock makes the race deterministic, the unique index is the backstop.
4. Join the display name; return the decision with `summaryId` and `summaryVersion`.

The command reads no results, insights, drafts or summary text. No provider call, no access row, no `tasks.updated_at` change.

## Queries

- `getCurrentConformityDecision(executor, submissionId)` → `ConformityDecision | null`: calls `getConfirmedSummary`; if `null` → `null`; otherwise the decision with `confirmed_summary_id` equal to that `id`, else `null`. The invalidation row is not consulted (binding is the authority).
- `getConformityHistory(executor, submissionId)` → decisions that are not current, newest first: `{ id, outcome, decidedAt, decidedBy, summaryId, summaryVersion, invalidatedAt | null }` (`invalidatedAt` from the invalidation row, `null` if absent).
- Decisions bind to the summary version through a join on `confirmed_summaries.version`; `conformity` reads that table only through a `queries/` function of `summaries` (add `getConfirmedSummaryVersion(executor, summaryId)` there if the join cannot be avoided) and never writes it.

## Reopen participant

`conformityReopenParticipant: SummaryReopenParticipant = { name: "conformity", hasOfficialDesignation: async () => false, onSummaryReopened }`. `onSummaryReopened(tx, ctx)` inserts one `conformity_decision_invalidations` row for the decision whose `confirmed_summary_id = ctx.reopenedSummaryId`, with `invalidated_by = ctx.actorId`, `invalidated_at = ctx.reopenedAt`; if no decision exists it does nothing. It runs in the reopening transaction; a failure rolls the reopening back (10.3 R59).

Start-up helper `registerDefaultSummaryReopenParticipants()` (called where the API app is built, outside the modules) registers `conformityReopenParticipant` unless a participant of that name is already registered. 11.x adds its own in the same helper.

## Route

`POST /api/v1/tasks/{taskId}/conformity-decision`, body `{ outcome }` (strict), `Cache-Control: no-store`.

| Case | Status | Body | Server log |
|---|---|---|---|
| Employé | 403 `FORBIDDEN` | `ApiError` | `{ event: "conformity.refused", class: "forbidden-role", actorId }` |
| Malformed/unknown/other team/draft/no audit | 404 `TASK_NOT_FOUND`, identical to 9.1 | `ApiError` | class `not-found` |
| Missing/unknown `outcome`, extra property | 422 `VALIDATION_FAILED` | `ApiError` | none |
| Summary not confirmed | 409 `SUMMARY_NOT_CONFIRMED` | `ApiError` | class `not-confirmed` |
| Already decided for this summary | 409 `CONFORMITY_ALREADY_DECIDED` | `ApiError` | class `already-decided` |
| Inconsistent snapshot or other failure | 500 `INTERNAL_ERROR` | `ApiError` | none |
| Recorded | 201 | `ConformityDecision` | `{ event: "conformity.recorded", actorId }` |

Role check precedes body validation; for an invalid body the task is probed first so unknown tasks stay 404 (as 10.2/10.3). Messages: « La décision n’a pas pu être enregistrée. » (500), « La synthèse n’est pas confirmée : la décision ne peut pas être enregistrée. » (409), « Une décision est déjà enregistrée pour cette synthèse. » (409), « Cette décision est invalide. » (422).

## Contract

- `ConformityOutcome`: enum `machine-conforme | machine-non-conforme`.
- `ConformityDecisionRequest`: `{ outcome }`, strict.
- `ConformityDecision`: `{ id, outcome, decidedAt, decidedBy: { id, displayName }, summaryId, summaryVersion }`, strict.
- `ConformityHistoryItem`: `ConformityDecision` plus `invalidatedAt` (date-time | null), strict.
- `AcceptedEvidenceResponse`: required `conformityDecision: ConformityDecision | null`, `conformityHistory: ConformityHistoryItem[]`.
- New error code `CONFORMITY_ALREADY_DECIDED`; operation `recordConformityDecision` (201/403/404/409/422/500).
- The evidence route (`GET /tasks/{taskId}/accepted-evidence`) fills both fields from the two queries.

## Web

- `summary-draft.tsx` (or a new `conformity-decision.tsx` rendered below it by `InsightProposalsPanel`, preferred to keep files small) shows the decision area per CAP-6. State: `idle` / `prompt(outcome)` / `saving` / `failed`; buttons are plain equal `button-secondary` style (no primary, no focus default on either); « Annuler » returns focus to the button that opened the prompt.
- The summary reopening flow (10.3 `onReopened`) clears the current decision in client state and shows it under « Décisions précédentes » after the evidence reload (reload is the source of truth).
- Handler `apps/web/src/app/api/tasks/[taskId]/conformity-decision/route.ts`: POST, `rejectCrossOriginMutation`, session cookie only, `no-store`, status/body pass-through, 503 when unreachable.
- i18n under `fr.conformity` (all labels and messages above, plus outcome labels « Machine conforme » / « Machine non conforme »). No report, « Rapport » or « Conclusion générale » wording; no English text.
