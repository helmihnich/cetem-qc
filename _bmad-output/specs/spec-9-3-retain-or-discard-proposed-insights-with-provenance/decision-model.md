# Decision model (CAP-1 to CAP-7)

## Migration `apps/api/src/db/migrations/0016_audit_insight_decisions.sql`

```sql
CREATE TABLE audit_insight_decisions (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  revision_identity jsonb NOT NULL,          -- the five revision identity columns
  proposal_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('retained','discarded')),
  proposal jsonb NOT NULL,                   -- full InsightProposal snapshot (rule ID/version, registry version, approval ref, source keys, statement)
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_insight_decisions_submission_idx ON audit_insight_decisions (submission_id, proposal_id, seq);
-- history_only + no_truncate triggers, exactly like audit_review_accesses (refuse_history_change, refuse_evidence_truncate)
```

No existing table changes. Check the migration runner/test that enumerates migrations and update its expectation only by adding 0016.

## Domain (`packages/domain/src/insight-decisions.ts`, exported from index)

```ts
export type InsightDecisionValue = "retained" | "discarded";
export interface CurrentInsightDecision { proposalId: string; decision: InsightDecisionValue; decidedAt: string; decidedBy: { id: string; displayName: string } }
export function selectRetainedInsights(proposals: readonly InsightProposal[], decisions: readonly CurrentInsightDecision[]): InsightProposal[];
```

Pure. Returns proposals (in the given order) whose decision is `retained`. Discarded, undecided and decisions without a matching proposal contribute nothing. `[]` is valid.

## Command and query (`apps/api/src/modules/audits/`)

- `commands/record-insight-decision.ts`: `recordInsightDecision(pool, responsableId, taskId, proposalId, decision)` → `{ type: "recorded"; current: CurrentInsightDecision } | { type: "not-found" } | { type: "inconsistent" } | { type: "unknown-proposal" }`. One transaction: `getAcceptedSubmissionForReview`, consistency check (reuse `isConsistentSnapshot`), evaluate proposals exactly as `openAcceptedEvidenceForReview` does (same seam, same registry), find `proposalId`, insert one row, return the current decision.
- `queries/insight-decisions.ts`: `getCurrentInsightDecisions(client, submissionId)` → latest row per `proposal_id` (`DISTINCT ON (proposal_id) ... ORDER BY proposal_id, seq DESC`) joined to `identity_accounts` for display name. Used by `openAcceptedEvidenceForReview` after the access insert path validated; read only.
- Extract the shared "evaluate proposals for a snapshot" step so open and decide cannot diverge.

## Route

`POST /api/v1/tasks/{taskId}/insight-decisions`, body `{ proposalId: string; decision: "retained" | "discarded" }` (strict), `Cache-Control: no-store`.

| Case | Status | Body | Server log |
|---|---|---|---|
| Employé | 403 `FORBIDDEN` | `ApiError` | `{ event: "audit.insight_decision_refused", class: "forbidden-role", actorId }` |
| Malformed/unknown/other team/draft/no audit | 404 `TASK_NOT_FOUND`, identical body to 9.1 | `ApiError` | class `not-found` |
| Invalid body, unknown `proposalId` | 422 `VALIDATION_FAILED` | `ApiError` | class `validation` |
| Inconsistent snapshot or other failure | 500 `INTERNAL_ERROR` | `ApiError` | none (never log values) |
| Recorded | 200 | `InsightDecisionResponse = CurrentInsightDecision` | none |

401 from `requireSession`. Log lines are `console.info` JSON carrying IDs only, never the task ID, proposal ID or statement.

## Contract

- `AcceptedEvidenceResponse.insightDecisions` (required, may be empty): array of `CurrentInsightDecision` plus `registryVersion`, `ruleId`, `ruleVersion` read from the stored snapshot; strict zod objects.
- New operation `recordInsightDecision` with request/response schemas and the 200/403/404/422/500 outcomes in the typed client. `insights` (9.2) is unchanged.

## Web (W5 panel in `accepted-evidence.tsx`)

- Per proposal item: « Retenir » and « Écarter » buttons (the active choice is `aria-pressed`), state line « Retenu / Écarté / Non décidé », and « Décidé par {name} le {date} » when decided.
- Footer line « Aucun insight retenu » when no proposal is retained and the panel has `available` proposals.
- `unavailable` and zero-proposal states keep the 9.2 text and no control.
- Handler `apps/web/src/app/api/tasks/[taskId]/insight-decisions/route.ts`: POST, `rejectCrossOriginMutation`, session cookie only, `no-store`, passes API status/body through, 503 when unreachable.
- Pending state disables both buttons; an error shows a French message and keeps the previous state. Decisions update local state from the response only; the panel never evaluates.
- i18n additions under `fr.insights` (retain, discard, states, decided-by, none-retained, error). The final-conformity note still appears once and no approve, reject or conformity wording is added.
