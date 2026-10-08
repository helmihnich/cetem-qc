# Summary reopening model (CAP-1 to CAP-7)

## Migration `apps/api/src/db/migrations/0020_summary_reopenings.sql`

```sql
ALTER TABLE confirmed_summaries ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version >= 1);
DROP INDEX confirmed_summaries_submission_idx;
CREATE UNIQUE INDEX confirmed_summaries_submission_version_idx ON confirmed_summaries (submission_id, version);

CREATE TABLE summary_reopenings (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  confirmed_summary_id uuid NOT NULL UNIQUE REFERENCES confirmed_summaries(id) ON DELETE RESTRICT,
  reopened_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  reopened_at timestamptz NOT NULL DEFAULT now()
);
-- history_only + no_truncate triggers, exactly like confirmed_summaries
```

`UNIQUE (confirmed_summary_id)` enforces one reopening per confirmation. Update any test enumerating migrations by adding 0020. The 10.2 migration test that asserts « one row per submission » is updated only to assert « one row per submission and version » (K22 of 10.2 keeps its other checks).

## State (`apps/api/src/modules/summaries/queries/summary-state.ts`)

- `getSummaryState(executor, submissionId)` → `{ state: "confirmed"; summary } | { state: "open"; nextVersion: number }`: the highest-`version` row for the submission; `confirmed` when it exists and has no reopening row; otherwise `open` with `nextVersion = (max version ?? 0) + 1`.
- `getConfirmedSummary` and `isSummaryConfirmed` (10.2) are redefined on that state. `ConfirmedSummary` gains `version`.
- `getSummaryHistory(executor, submissionId)` → earlier versions newest first: those with a reopening row, as `{ version, text, confirmedAt, confirmedBy, reopenedAt, reopenedBy, initialDraft }`.

## Command (`apps/api/src/modules/summaries/commands/reopen-summary.ts`)

`reopenSummary(pool, responsableId, taskId)` → `{ type: "reopened"; reopening } | { type: "not-confirmed" } | { type: "designated" } | { type: "not-found" } | { type: "inconsistent" }`.

One transaction:
1. `lockTaskSummary(transaction, taskId)`; `getAcceptedSubmissionForReview` (same seam and `isConsistentSnapshot` as 10.2); none → `not-found`.
2. `getSummaryState`; not `confirmed` → `not-confirmed`.
3. For each registered participant, `hasOfficialDesignation(transaction, { taskId, submissionId })`; any true → `designated` (nothing inserted, nothing notified).
4. Insert the `summary_reopenings` row; join the display name.
5. For each participant in registration order, `onSummaryReopened(transaction, { taskId, submissionId, reopenedSummaryId, reopenedAt, actorId })`. A throw rolls the transaction back and propagates (route → 500, no row).

No provider call, no access row, no `tasks.updated_at` change.

## Participant contract (`apps/api/src/modules/summaries/reopen-participants.ts`, exported by the module's public entry)

```ts
interface SummaryReopenParticipant {
  name: string;
  hasOfficialDesignation(tx: PoolClient, ctx: { taskId: string; submissionId: string }): Promise<boolean>;
  onSummaryReopened(tx: PoolClient, ctx: { taskId: string; submissionId: string; reopenedSummaryId: string; reopenedAt: string; actorId: string }): Promise<void>;
}
registerSummaryReopenParticipant(p): void   // duplicate name → throws
```

The production registry is empty (as the insight registry was in Epic 9). Tests use a test seam to install and clear synthetic participants. Participants run in the caller's transaction and use only their own module's tables. 10.4 registers a conformity participant (current decision → historical); 11.x registers a report participant (candidates outdated/superseded, non-designatable; `hasOfficialDesignation` true once one is official). Records of those modules bind to the confirmed summary `id` and are current only while it equals `getConfirmedSummary(...).id`.

## Changes to 10.2 code

- `confirm-summary.ts`: `already-confirmed` when the state is `confirmed`; insert `version` = `nextVersion` (computed under the lock); everything else unchanged.
- `add-manual-insight`, `record-insight-decision`, `request-summary-draft`: no code change beyond the redefined `isSummaryConfirmed`.
- `draftId` validation stays « generated draft of this submission ». A draft that predates an earlier version is allowed.

## Route

`POST /api/v1/tasks/{taskId}/summary-reopening`, body `{}` (strict, extra properties → 422), `Cache-Control: no-store`.

| Case | Status | Body | Server log |
|---|---|---|---|
| Employé | 403 `FORBIDDEN` | `ApiError` | `{ event: "summary.reopen_refused", class: "forbidden-role", actorId }` |
| Malformed/unknown/other team/draft/no audit | 404 `TASK_NOT_FOUND`, identical to 9.1 | `ApiError` | class `not-found` |
| Invalid body | 422 `VALIDATION_FAILED` | `ApiError` | none |
| Not confirmed / already reopened | 409 `SUMMARY_NOT_CONFIRMED` | `ApiError` | class `not-confirmed` |
| Official designation | 409 `SUMMARY_DESIGNATED` | `ApiError` | class `designated` |
| Inconsistent snapshot, participant failure, other | 500 `INTERNAL_ERROR` | `ApiError` | none |
| Reopened | 201 | `SummaryReopening` | `{ event: "summary.reopened", actorId }` |

Role check precedes body validation; the task is probed first so unknown tasks stay 404 (as 10.2).

## Contract

- `SummaryReopening`: `{ version: integer ≥ 2, reopenedAt, reopenedBy: { id, displayName }, previous: ConfirmedSummary }`, strict.
- `SummaryHistoryItem`: `{ version, text, confirmedAt, confirmedBy, reopenedAt, reopenedBy, initialDraft | null }`, strict.
- `ConfirmedSummary.version`: required integer ≥ 1.
- `AcceptedEvidenceResponse`: required `summaryHistory: SummaryHistoryItem[]` and `summaryVersion: { number, state: "confirmed" | "open" }` (`number` = the current confirmed version, or `nextVersion` when open).
- New error codes `SUMMARY_NOT_CONFIRMED`, `SUMMARY_DESIGNATED`; operation `reopenSummary` (201/403/404/409/422/500).

## Web

- `summary-draft.tsx`: confirmed state shows « Rouvrir la synthèse » and the prompt of CAP-7; success stores the returned `previous.text` as the editor text with `draftId` absent and the note « Version {n} à confirmer — la version {n-1} reste dans l’historique. »; the 10.2 unconfirmed controls (request draft, insight form, decisions, « Confirmer la synthèse ») are shown again. A reload while open shows `summary: null`, `summaryVersion.state: "open"` and an empty editor with the note (the previous text is read from `summaryHistory[0]` and may be re-inserted with a button « Reprendre le texte de la version {n-1} »; the editor is never prefilled silently after a reload).
- « Historique des synthèses »: read-only list from `summaryHistory`, each « Version n — remplacée », confirmer, date, text.
- Handler `apps/web/src/app/api/tasks/[taskId]/summary-reopening/route.ts`: POST, `rejectCrossOriginMutation`, session cookie only, `no-store`, status/body pass-through, 503 when unreachable.
- i18n under `fr.summary`: all labels above; 409 messages « La synthèse n’est pas confirmée : elle ne peut pas être rouverte. » and « Un rapport officiel est désigné : la synthèse ne peut plus être rouverte. »; failure « La synthèse n’a pas pu être rouverte. ». No « Machine conforme » and no report control.
