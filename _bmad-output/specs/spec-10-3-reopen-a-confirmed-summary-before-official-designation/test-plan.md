# Test plan

Synthetic names only. Mock provider or injected fake; no network. PostgreSQL tests use the local harness, zero skipped, and reach accepted audits through `sync-fixture.ts`. Synthetic reopen participants are installed and cleared through a test seam; a synthetic insight registry (`reviewCommandTestSeams.insightRegistry`) is used where a retained rule insight is needed.

## Schemas and client

- **K23** `summaryReopeningSchema`, `summaryHistoryItemSchema` strict; `version` ≥ 2 on reopening; `ConfirmedSummary.version` required.
- **K24** `acceptedEvidenceResponseSchema` requires `summaryHistory` and `summaryVersion`.
- **K25** Typed client `reopenSummary` outcomes 201/403/404/409/422/500; error codes `SUMMARY_NOT_CONFIRMED`, `SUMMARY_DESIGNATED`. `contracts:check` passes.
- **K26** Migration 0020: existing rows get version 1; unique `(submission_id, version)`; one reopening per confirmed summary; triggers refuse UPDATE/DELETE/TRUNCATE on `summary_reopenings`.

## API (`apps/api/src/summary-reopening-routes.postgres.test.ts`)

- **R53** Confirm then reopen: 201, `version 2`, `previous` equals the confirmed summary, one reopening row (actor, server date, task, submission); the `confirmed_summaries` row is byte-identical.
- **R54** After reopening: `getConfirmedSummary` null, `isSummaryConfirmed` false, `getSummaryState` open with `nextVersion 2`; evidence response `summary: null`, `summaryVersion { 2, open }`, `summaryHistory[0]` has old text, confirmer, dates, initial draft.
- **R55** While open: manual insight, insight decision and draft request succeed (409 `SUMMARY_CONFIRMED` of 10.2 no longer applies); re-confirm stores `version 2`, rebuilds the input set (different identity when an insight was added, old row unchanged), then the three actions are 409 again.
- **R56** Reopen when never confirmed, and a second reopen without confirmation → 409 `SUMMARY_NOT_CONFIRMED`, no row; confirm twice without reopening → 409 `SUMMARY_ALREADY_CONFIRMED`; two cycles give versions 1, 2, 3 and history of two items.
- **R57** Two concurrent reopens → one 201, one 409, one row; a concurrent confirm and reopen end in a consistent state (never two current).
- **R58** Synthetic participant with `hasOfficialDesignation` true → 409 `SUMMARY_DESIGNATED`, no row, `onSummaryReopened` not called, summary still confirmed; with false, every participant receives exactly one `onSummaryReopened` with the reopened summary ID, inside the same transaction (it can read the new row).
- **R59** Participant that throws → 500, no reopening row, summary still confirmed, later participants not left half-applied.
- **R60** Synthetic records bound to summary IDs: bound to the old ID → non-current after reopening, bound to the new ID after re-confirmation → current; `summaries` source holds no reference to conformity/report tables (`boundaries:check`).
- **R61** Refusals write nothing: Employé 403; malformed, unknown, other-team, draft, no-audit tasks give 404 bodies byte-identical to 9.1; extra body property → 422; inconsistent snapshot → 500.
- **R62** Other tables (evidence, `summary_ai_drafts`, decisions, manual insights, access rows, `tasks.updated_at`) unchanged by reopening; no provider called.
- **R63** Log lines (`summary.reopened`, `summary.reopen_refused` classes) carry event, actor ID, fixed class only: no text or IDs of tasks.
- **R64** Existing 10.2 tests (R41–R52) pass with only the added `version`/`summaryHistory`/`summaryVersion` fields.

## Web (`accepted-evidence-render.test.tsx`, `summary-draft` tests, route handler test)

- **W37** Reopen button only in the confirmed state; click opens the prompt; « Annuler » sends nothing and changes nothing; « Rouvrir » sends `{}`.
- **W38** 201 shows the editable state with the previous text prefilled, the version note, and the 10.2 unconfirmed controls enabled; « Confirmer la synthèse » works again and the confirmed state returns with the new version.
- **W39** Reload while open (`summary: null`, `state: "open"`): empty editor, version note, « Reprendre le texte de la version n » button inserts the previous text.
- **W40** Failure (500/network/422) keeps the confirmed state and shows « La synthèse n’a pas pu être rouverte. »; 409 `SUMMARY_NOT_CONFIRMED` / `SUMMARY_DESIGNATED` reloads evidence and shows its French message.
- **W41** « Historique des synthèses » is read-only, newest first, each « Version n — remplacée » with confirmer and date; absent when empty; markup shown as text.
- **W42** No conformity-decision or report control; no English text.
- **W43** Route handler: CSRF rejection, cookie-only forwarding, `no-store`, status/body pass-through (incl. 409, 422), 503 when unreachable.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check`, `git diff --check`.
