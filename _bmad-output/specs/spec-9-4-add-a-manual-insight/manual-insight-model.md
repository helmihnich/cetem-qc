# Manual insight model (CAP-1 to CAP-7)

## Migration `apps/api/src/db/migrations/0017_audit_manual_insights.sql`

```sql
CREATE TABLE audit_manual_insights (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  author_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  revision_identity jsonb NOT NULL,
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type = 'manual'),
  insight_text text NOT NULL CHECK (char_length(insight_text) BETWEEN 1 AND 1000),
  justification text CHECK (justification IS NULL OR char_length(justification) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_manual_insights_submission_idx ON audit_manual_insights (submission_id, seq);
-- history_only + no_truncate triggers, exactly like audit_insight_decisions (refuse_history_change, refuse_evidence_truncate)
```

No existing table changes. Update any test that enumerates migrations only by adding 0017.

## Domain (`packages/domain/src/manual-insights.ts`, exported from index)

```ts
export const MANUAL_INSIGHT_TEXT_MAX = 1000;
export const MANUAL_INSIGHT_JUSTIFICATION_MAX = 1000;
export interface ManualInsight { id: string; text: string; justification: string | null; sourceType: "manual"; createdAt: string; author: { id: string; displayName: string } }
export type RetainedInsight =
  | { sourceType: "rule"; proposal: InsightProposal }
  | { sourceType: "manual"; insight: ManualInsight };
export function collectRetainedInsights(proposals: readonly InsightProposal[], decisions: readonly CurrentInsightDecision[], manualInsights: readonly ManualInsight[]): RetainedInsight[];
```

Pure. Retained proposals (via `selectRetainedInsights`) first, then all manual insights in the given order. `[]` is valid. The limits are used by the zod schema and the migration check is kept in step by a test.

## Command and query (`apps/api/src/modules/audits/`)

- `commands/add-manual-insight.ts`: `addManualInsight(pool, responsableId, taskId, input: { text; justification })` → `{ type: "added"; insight: ManualInsight } | { type: "not-found" } | { type: "inconsistent" }`. One transaction: `getAcceptedSubmissionForReview`, same seam and `isConsistentSnapshot` as `recordInsightDecision`, one insert joined to `identity_accounts` for the display name. No proposal evaluation is needed.
- `queries/manual-insights.ts`: `getManualInsights(client, submissionId)` → rows ordered by `seq` ASC. Used by `openAcceptedEvidenceForReview` after the access insert, read only, like `getCurrentInsightDecisions`.

## Route

`POST /api/v1/tasks/{taskId}/manual-insights`, body `{ text: string; justification?: string | null }` (strict; trimmed in the schema), `Cache-Control: no-store`.

| Case | Status | Body | Server log |
|---|---|---|---|
| Employé | 403 `FORBIDDEN` | `ApiError` | `{ event: "audit.manual_insight_refused", class: "forbidden-role", actorId }` |
| Malformed/unknown/other team/draft/no audit | 404 `TASK_NOT_FOUND`, identical body to 9.1 | `ApiError` | class `not-found` |
| Invalid or extra body | 422 `VALIDATION_FAILED` | `ApiError` | class `validation` |
| Inconsistent snapshot or other failure | 500 `INTERNAL_ERROR` | `ApiError` | none (never log values) |
| Added | 201 | `ManualInsightResponse = ManualInsight` | none |

401 from `requireSession`. Log lines are `console.info` JSON carrying IDs only, never the task ID, text or justification. Role check precedes body validation, as in 9.3.

## Contract

- `AcceptedEvidenceResponse.manualInsights` (required, may be empty): array of `ManualInsight`, strict zod objects. `insights` and `insightDecisions` are unchanged.
- New operation `addManualInsight` with request/response schemas and the 201/403/404/422/500 outcomes in the typed client.

## Web (W5 panel in `accepted-evidence.tsx`)

- New component `ManualInsightsSection` inside the existing insights section, always rendered for an accepted audit: heading « Insights manuels », list, form.
- Form: text area (required, `maxLength` 1000), optional « Justification » (`maxLength` 1000), submit « Ajouter l'insight ». Labels associated to fields. Hint states the insight must be factual and is not a conformity decision.
- Item: text, justification (when present), label « Ajout manuel », « Ajouté par {name} le {date} », styled like `insight-item`, no edit or delete.
- Handler `apps/web/src/app/api/tasks/[taskId]/manual-insights/route.ts`: POST, `rejectCrossOriginMutation`, session cookie only, `no-store`, passes API status/body through, 503 when unreachable.
- Pending disables submit; failure shows a French error, keeps typed text; success appends from the response and clears the form. The footer « Aucun insight retenu » is shown only when no proposal is retained and `manualInsights` is empty (change the existing condition).
- i18n additions under `fr.insights` (manual heading, labels, hint, submit, error, `manualLabel`, `addedBy`). No approve, reject or conformity wording; the final-conformity note still appears once.
