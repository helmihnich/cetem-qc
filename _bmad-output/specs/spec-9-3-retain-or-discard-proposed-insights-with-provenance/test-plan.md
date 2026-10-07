# Test plan

Synthetic names only. Synthetic registries are injected through `reviewCommandTestSeams.insightRegistry` (never exported from production modules). PostgreSQL tests use the local harness, zero skipped, and reach accepted audits through the existing `sync-fixture.ts` path.

## Domain (`packages/domain/src/insight-decisions.test.ts`)

- **D1** `selectRetainedInsights` returns only retained proposals in proposal order.
- **D2** Discarded and undecided proposals, and decisions without a matching proposal, contribute nothing; no discarded statement text appears anywhere in the output.
- **D3** No proposals, or nothing retained, returns `[]`; input is not mutated (deep-frozen input passes).

## Schemas and client

- **K11** `acceptedEvidenceResponseSchema` requires `insightDecisions`, parses empty and populated, refuses extra properties and an invalid decision value. The decision request schema is strict.
- **K12** Typed client `recordInsightDecision` returns typed outcomes for 200, 403, 404, 422, 500. `contracts:check` passes.

## API (`apps/api/src/insight-decision-routes.postgres.test.ts`)

- **R17** With a synthetic registry, retaining a proposal returns 200 and inserts exactly one row with actor, server date, task, audit, submission, revision, revision identity, proposal ID, rule ID/version, registry version, approval reference, source keys and statement.
- **R18** Discarding then retaining the same proposal keeps both rows; the current decision is the later one; an evidence open reports it with decider name and date.
- **R19** Refusals write no row: Employé 403; malformed, unknown, other-team, draft and no-audit tasks give byte-identical 404 bodies equal to 9.1's; unknown `proposalId` and invalid `decision` give 422; inconsistent snapshot gives 500.
- **R20** With the production registry every decision attempt is refused 422 and no row exists; evidence open returns `insightDecisions: []`.
- **R21** UPDATE, DELETE and TRUNCATE on `audit_insight_decisions` are refused.
- **R22** Evidence tables and `tasks.updated_at` are byte-identical after decisions; opens still write exactly one access row each and decisions write none.
- **R23** A decision body carrying extra proposal content is refused; stored statement equals the server-evaluated one.
- **R24** Zero decisions, or all discarded, leaves the evidence open and any later read working (no gate); log lines contain actor ID and class only.

## Web (`accepted-evidence-render.test.tsx` and route handler test)

- **W13** Available proposals render « Retenir » / « Écarter », state, and decider/date; `unavailable` and zero-proposal states render no control.
- **W14** « Aucun insight retenu » shows when nothing is retained and is not styled as a warning.
- **W15** Clicking calls the handler once, disables controls while pending, updates from the response, and on failure shows the French error with state unchanged.
- **W16** No approve, reject or conformity wording; the final-conformity note appears once; a scan finds no English text in the section.
- **W17** Route handler: CSRF rejection, cookie-only forwarding, `no-store`, status/body pass-through, 503 when unreachable.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check`, `git diff --check`.
