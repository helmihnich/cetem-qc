# Test plan

Synthetic names only. Mock provider or injected fake; no network. PostgreSQL tests use the local harness, zero skipped, and reach accepted audits through `sync-fixture.ts`. A synthetic insight registry (`reviewCommandTestSeams.insightRegistry`) is used where a retained rule insight is needed.

## Schemas and client

- **K19** `confirmedSummarySchema` strict; `summaryInputSetId` 64-hex; `initialDraft` nullable; request schema rejects empty/over-5000/NUL text, extra properties, non-uuid `draftId`.
- **K20** `acceptedEvidenceResponseSchema` requires `summary`.
- **K21** Typed client `confirmSummary` outcomes 201/403/404/409/422/500; 409 typed on the three locked operations. `contracts:check` passes.
- **K22** Migration checks (text length, no NUL, one row per submission) match the schema bounds.

## API (`apps/api/src/summary-confirmation-routes.postgres.test.ts`)

- **R41** Manual-only confirm: 201, one row with confirmer, server date, task, audit, submission, revision, identity, text, `input_set`, `summary_input_set_id` (equals hash of stored set), no draft link, `initialDraft: null`.
- **R42** AI-based confirm with edited text: draft row byte-identical afterwards, row links it, response carries both texts, provider/model and both input-set identities; text equal to the draft also works.
- **R43** A manual insight added after the draft: draft identity differs from the confirmed identity; the confirmed input set includes the insight (actual inputs). Zero retained insights (production registry) confirms with `insights: []`.
- **R44** Unusable `draftId` (unknown, `failed` row, other submission/task) → 422, no row.
- **R45** Second confirm → 409 `SUMMARY_ALREADY_CONFIRMED`, one row, text unchanged; two concurrent confirms → exactly one 201 and one 409.
- **R46** After confirmation: manual-insight add, insight decision and draft request → 409 `SUMMARY_CONFIRMED`, no row, provider spy not called; before confirmation the same calls succeed (regression of 9.3/9.4/10.1 tests unchanged).
- **R47** Refusals write nothing: Employé 403; malformed, unknown, other-team, draft, no-audit tasks give 404 bodies byte-identical to 9.1; empty/whitespace/over-long/NUL text, extra property → 422; inconsistent snapshot → 500.
- **R48** UPDATE, DELETE, TRUNCATE on `confirmed_summaries` refused.
- **R49** Evidence tables, `summary_ai_drafts`, decisions, manual insights, access rows and `tasks.updated_at` unchanged by confirmation; confirmation calls no provider.
- **R50** Evidence response: `summary` null before, the confirmed summary after; opening review still writes only the access row.
- **R51** `getConfirmedSummary` null before, the row after; `isSummaryConfirmed` agrees. A failed insert (forced error) leaves no row and the response is not 201.
- **R52** Log lines for confirm and locked refusals carry event, actor ID, fixed class only: no text, input value, draft text or task ID.

## Web (`accepted-evidence-render.test.tsx`, `summary-draft` tests, route handler test)

- **W30** « Confirmer la synthèse » disabled for empty/whitespace text and while pending; enabled with text (draft-based or manual).
- **W31** Click opens the prompt; « Annuler » changes nothing and sends nothing; « Confirmer » sends `{ text, draftId }` (draftId only for AI-started text, absent for manual).
- **W32** 201 switches to the read-only confirmed state with confirmer, date and, when present, the initial draft block; manual-only shows no draft block and no model line.
- **W33** Failure (500/network/422) shows the French failure text, keeps the typed text, shows no confirmed state, retry possible; 409 reloads evidence into the confirmed state.
- **W34** Confirmed state disables request-draft, manual-insight form and decision controls; the unconfirmed note about conformity and report appears only before confirmation.
- **W35** No conformity, « Machine conforme », report control or wording; no English text; markup in the text is shown as text.
- **W36** Route handler: CSRF rejection, cookie-only forwarding, `no-store`, status/body pass-through (incl. 409, 422), 503 when unreachable.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check`, `git diff --check`.
