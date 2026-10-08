# Test plan

Synthetic names only. Mock provider or injected fake; no network. PostgreSQL tests use the local harness, zero skipped, and reach accepted audits through `sync-fixture.ts`. The conformity participant is registered through `registerDefaultSummaryReopenParticipants()` in test setup (after any `summaryReopenParticipantTestSeams.clear()`); synthetic participants are used only where a veto or failure is needed.

## Schemas and client

- **K27** `conformityDecisionSchema`, `conformityDecisionRequestSchema`, `conformityHistoryItemSchema` strict; `outcome` accepts exactly the two values; request has no other property.
- **K28** `acceptedEvidenceResponseSchema` requires `conformityDecision` (nullable) and `conformityHistory`.
- **K29** Typed client `recordConformityDecision` outcomes 201/403/404/409/422/500; error code `CONFORMITY_ALREADY_DECIDED`. `contracts:check` passes.
- **K30** Migration 0021: no default on `outcome`; CHECK refuses other values; one decision per confirmed summary; one invalidation per decision; triggers refuse UPDATE/DELETE/TRUNCATE on both tables.

## API (`apps/api/src/conformity-decision-routes.postgres.test.ts`)

- **R65** Confirm then record `machine-conforme`: 201, `summaryId` equals the confirmed summary `id`, `summaryVersion 1`, one row (actor, server date, task, submission); same for `machine-non-conforme` on another audit.
- **R66** Independence: audits whose per-test verdicts are all « indisponible », all conforming, all non-conforming and mixed accept both outcomes; the stored row and response are identical in shape; the command source contains no read of results/insights/drafts (the command takes `outcome` only).
- **R67** Never confirmed → 409 `SUMMARY_NOT_CONFIRMED`, no row; after a reopening (open) → 409 `SUMMARY_NOT_CONFIRMED`, no row.
- **R68** Missing `outcome`, unknown value, `null`, extra property, non-object body → 422, no row; no default is applied.
- **R69** Second record for the same summary (same or other outcome) → 409 `CONFORMITY_ALREADY_DECIDED`, first row byte-identical; two concurrent records → one 201, one 409, one row.
- **R70** Reopen after a decision: one invalidation row (decision, reopened summary, actor, `invalidatedAt` = reopening date) in the reopening transaction; `getCurrentConformityDecision` null; evidence response `conformityDecision: null` and `conformityHistory[0]` has the old outcome, actor, date, summary version and `invalidatedAt`; the decision row is byte-identical.
- **R71** Reopen without a decision writes no invalidation row; reopen then reconfirm then record: new decision current (`summaryVersion 2`), old one only in history; the prior outcome is not returned as current, copied or preselected.
- **R72** Binding authority: with the invalidation row removed from the test database (superuser bypass of the trigger in the harness), a decision bound to the older summary `id` is still not current once the summary is reopened or reconfirmed.
- **R73** Concurrent reopen and record end consistent: either the record wins and is then invalidated by the reopening, or the reopening wins and the record is 409 `SUMMARY_NOT_CONFIRMED`; never a current decision on an open summary.
- **R74** A throwing synthetic participant registered after `conformity` rolls the reopening back: no reopening row, no invalidation row, decision still current; a synthetic participant with `hasOfficialDesignation` true still gives 409 `SUMMARY_DESIGNATED` and no invalidation (10.3 R58 with the real participant present).
- **R75** Registration is idempotent: calling `registerDefaultSummaryReopenParticipants()` twice does not throw and registers `conformity` once.
- **R76** Refusals write nothing: Employé 403; malformed, unknown, other-team, draft, no-audit tasks give 404 bodies byte-identical to 9.1; inconsistent snapshot → 500.
- **R77** Other tables (evidence, `confirmed_summaries`, `summary_reopenings`, drafts, insight decisions, manual insights, access rows, `tasks.updated_at`) unchanged by recording; no provider called.
- **R78** Log lines (`conformity.recorded`, `conformity.refused` classes) carry event, actor ID, fixed class only: no task or decision IDs, no outcome.
- **R79** Existing 10.2/10.3 tests (R41–R64) pass with only the added `conformityDecision`/`conformityHistory` fields; 10.3 reopening tests that clear the registry keep their meaning.
- **R80** `boundaries:check` passes: `conformity` imports `summaries` only through its public surface; `summaries` has no reference to `conformity`.

## Web (`conformity-decision-render.test.tsx`, route handler test; updated 10.3 wording assertions)

- **W44** Summary open: no decision buttons, explanatory text shown; summary confirmed with no decision: both buttons present, neither selected, pressed, focused or styled primary.
- **W45** Click a button opens the prompt with that label and the summary version; « Annuler » sends nothing and restores focus; « Enregistrer » sends `{ outcome }` only.
- **W46** 201 shows « Décision : … — enregistrée par … le … » and removes the buttons; both outcomes behave the same (no different colour, warning or report wording).
- **W47** Failure (500/network/422) shows « La décision n’a pas pu être enregistrée. » and no decision; 409 `SUMMARY_NOT_CONFIRMED` / `CONFORMITY_ALREADY_DECIDED` reloads evidence and shows its French message.
- **W48** Reopening a summary with a current decision clears it from the current area and lists it under « Décisions précédentes » (read-only, newest first, version and actor/date); a decision after reconfirmation is current.
- **W49** Per-test verdicts, calculations, insights and AI draft text shown on the page never alter the buttons (same render with different evidence); no report control, no English text; markup in names shown as text.
- **W50** Route handler: CSRF rejection, cookie-only forwarding, `no-store`, status/body pass-through (incl. 409, 422), 503 when unreachable.
- **W51** The 10.3 W42 / i18n wording assertions are updated as stated in the SPEC (report control and « Conclusion générale » still forbidden; decision wording allowed only in the conformity area).

## Gates

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check`, `git diff --check`.
