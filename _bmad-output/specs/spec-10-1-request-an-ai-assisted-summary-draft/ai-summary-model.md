# AI summary draft model (CAP-1 to CAP-8)

## Migration `apps/api/src/db/migrations/0018_summary_ai_drafts.sql`

```sql
CREATE TABLE summary_ai_drafts (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  requested_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  revision_identity jsonb NOT NULL,
  summary_input_set_id text NOT NULL CHECK (summary_input_set_id ~ '^[0-9a-f]{64}$'),
  input_set jsonb NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('generated', 'failed')),
  failure_class text CHECK (failure_class IN ('not-configured', 'timeout', 'provider-error', 'empty-output')),
  draft_text text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'generated' AND draft_text IS NOT NULL AND char_length(draft_text) > 0 AND failure_class IS NULL)
      OR (status = 'failed' AND draft_text IS NULL AND failure_class IS NOT NULL))
);
CREATE INDEX summary_ai_drafts_submission_idx ON summary_ai_drafts (submission_id, seq);
-- history_only + no_truncate triggers, exactly like audit_manual_insights (refuse_history_change, refuse_evidence_truncate)
```

No existing table changes. Update any test that enumerates migrations only by adding 0018. A failed row's `provider`/`model` are the configured names (`gemini` / the model env value, or `mock`).

## Domain (`packages/domain/src/summary-input.ts`, exported from index)

```ts
export interface SummaryInputSet {
  version: 1;
  identity: CalculationContext;                    // catalogue/schema/rule identity of the audit revision
  values: Record<string, string>;                  // payload.values: field ID -> stored raw string, sorted by key
  results: GraphieCalculationResults;              // stored results incl. per-test verdicts
  insights: Array<
    | { sourceType: "rule"; statement: string }
    | { sourceType: "manual"; text: string; justification: string | null }>;
}
export function buildSummaryInputSet(snapshot: { identity; values; results }, retained: readonly RetainedInsight[]): SummaryInputSet;
export function canonicalJson(value: unknown): string;              // sorted keys, no whitespace
export function summaryInputSetPlainObject(set: SummaryInputSet): unknown; // for storage
export function buildSummaryPrompt(set: SummaryInputSet): string;   // French instruction + the set; no other data
```

Rules:
- Pure, deterministic, no I/O, no mutation of inputs (deep-frozen input passes). The hash is computed in the API (`node:crypto` SHA-256 over `canonicalJson`), not in the domain.
- A rule insight carries only its rendered `statement` (from `InsightProposal`), no proposal or decision metadata, no actor names. A manual insight carries `text` and `justification`, no author, date or IDs. Order = `collectRetainedInsights` order.
- `values` and `results` are the stored snapshot parts only. Nothing from the task row, accounts or lineage enters the set.
- Prompt (French): summarize only the supplied data in the form of a short factual summary for the Responsable; invent no value, rule, tolerance or insight; state no overall conformity or approval; mention « indisponible » verdicts as unavailable. The prompt is built here once so both adapters send the same text.

## Port and adapters (`apps/api/src/modules/ai/`)

```ts
export interface SummaryDraftProvider {
  readonly name: string;                 // "mock" | "gemini"
  readonly model: string;
  generate(prompt: string, options: { signal: AbortSignal }): Promise<string>; // throws SummaryProviderError
}
export class SummaryProviderError extends Error { constructor(readonly failureClass: "not-configured" | "timeout" | "provider-error" | "empty-output") }
export function createSummaryDraftProvider(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): SummaryDraftProvider;
```

- `mock-provider.ts`: returns the fixed French text `fr.summary.mockDraft` (reminds that it is a demonstration draft to be reviewed and confirmed; contains no conformity verdict). Model name `mock-fixed-text`. No network.
- `gemini-provider.ts`: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key`, body `{ contents: [{ parts: [{ text: prompt }] }] }`; draft = trimmed `candidates[0].content.parts[*].text` joined. Model = `GEMINI_MODEL` or `gemini-2.5-flash`. Maps: no key → `not-configured` (no request made); abort → `timeout`; network error, non-2xx or malformed JSON → `provider-error`; no text or only whitespace → `empty-output`. Never reads or propagates the response body into an error message.
- `createSummaryDraftProvider`: `AI_PROVIDER` unset/empty/`mock` → mock; `gemini` → gemini; other → mock plus one `console.warn` JSON `{ event: "ai.provider_unknown_fallback" }` (value not logged).
- `AI_REQUEST_TIMEOUT_MS = 20000`, one constant; the command passes an `AbortSignal.timeout`.

## Command (`apps/api/src/modules/summaries/commands/request-summary-draft.ts`)

`requestSummaryDraft(pool, provider, responsableId, taskId)` →
`{ type: "generated"; draft: SummaryAiDraft } | { type: "failed"; failureClass } | { type: "not-found" } | { type: "inconsistent" }`.

1. Transaction A (read only): `getAcceptedSubmissionForReview`, same `reviewCommandTestSeams.snapshot` seam and `isConsistentSnapshot`; evaluate proposals with `evaluateProposalsForSnapshot`, read current decisions and manual insights (reuse 9.3/9.4 queries), `collectRetainedInsights`, `buildSummaryInputSet`, hash. No write, no access row. Commit.
2. Provider call outside any transaction, with timeout; the prompt exists only in memory.
3. Transaction B: insert one row (`generated` with text, or `failed` with class) joined to `identity_accounts` for the display name; return.

If `boundaries:check` forbids `summaries` importing `audits` commands/queries directly, `audits` exposes one public read function returning `{ snapshot, retained }` and `summaries` calls only that.

## Route

`POST /api/v1/tasks/{taskId}/summary-drafts`, body `{}` (strict, no properties), `Cache-Control: no-store`.

| Case | Status | Body | Server log |
|---|---|---|---|
| Employé | 403 `FORBIDDEN` | `ApiError` | `{ event: "summary.ai_draft_refused", class: "forbidden-role", actorId }` |
| Malformed/unknown/other team/draft/no audit | 404 `TASK_NOT_FOUND`, identical body to 9.1 | `ApiError` | class `not-found` |
| Non-empty or non-object body | 422 `VALIDATION_FAILED` | `ApiError` | class `validation` |
| Inconsistent snapshot or other failure | 500 `INTERNAL_ERROR` | `ApiError` | none (never log values) |
| Provider failure | 502 `AI_UNAVAILABLE` | `ApiError` (French message) | `{ event: "summary.ai_draft_failed", actorId, provider, class, durationMs }` |
| Generated | 201 | `SummaryDraftResponse` | `{ event: "summary.ai_draft_generated", actorId, provider, durationMs }` |

401 from `requireSession`. Role check precedes body validation, as in 9.3/9.4; for an invalid body the task is probed first so unknown tasks stay 404. The refused and probe paths never call the provider.

## Contract

- `SummaryDraftResponse`: `{ id, status: "generated", text, provider, model, requestedAt, requestedBy: { id, displayName }, summaryInputSetId }`; strict zod; `summaryInputSetId` matches `^[0-9a-f]{64}$`.
- New operation `requestSummaryDraft` with request `{}`, response and the 201/403/404/422/500/502 outcomes in the typed client; error code `AI_UNAVAILABLE` added to the error enum.
- `AcceptedEvidenceResponse` is unchanged.

## Web (W5 panel in `accepted-evidence.tsx`, or a sibling component file if the file grows)

- Component `SummaryDraftSection` below the insights section, rendered for every accepted audit.
- Elements: heading « Synthèse », note « Ce texte est un brouillon non confirmé. La décision de conformité reste celle du Responsable. », button « Demander un brouillon IA », loading text « Génération du brouillon en cours… » (button disabled while pending, `aria-busy`), text area « Texte de la synthèse » (always editable), label « Brouillon IA — non confirmé » + « Fournisseur {provider}, modèle {model} — {date} » after a success.
- Fill rule: empty text area → filled with the draft; non-empty → separate « Nouveau brouillon IA » block with the draft and the button « Remplacer le texte par ce brouillon ».
- Failure (502 or network): alert « Le brouillon IA n’est pas disponible. Réessayez ou rédigez la synthèse manuellement. », typed text kept.
- Handler `apps/web/src/app/api/tasks/[taskId]/summary-drafts/route.ts`: POST, `rejectCrossOriginMutation`, session cookie only, `no-store`, sends `{}`, passes API status/body through, 503 when unreachable.
- i18n additions under `fr.summary` (all labels above, `mockDraft`, error text). No « Enregistrer », « Confirmer », « Machine conforme » or similar control or wording.
