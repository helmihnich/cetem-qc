# Test plan

Synthetic names only. PostgreSQL tests use the local harness, zero skipped, and reach accepted audits through the existing `sync-fixture.ts` path. The production registry is used as is; a synthetic registry (existing `reviewCommandTestSeams.insightRegistry`) is needed only in the merge test M5.

## Domain (`packages/domain/src/manual-insights.test.ts`)

- **D1** `collectRetainedInsights` returns retained proposals (proposal order, `sourceType: "rule"`) then manual insights (given order, `sourceType: "manual"`).
- **D2** Discarded and undecided proposal content is absent from the output; no discarded statement appears.
- **D3** Nothing retained and no manual insight returns `[]`; deep-frozen input passes; manual insights alone yield a non-empty set.

## Schemas and client

- **K13** `acceptedEvidenceResponseSchema` requires `manualInsights`, parses empty and populated, refuses extra properties and `sourceType` other than `manual`. The add request schema is strict, trims, rejects blank and over-limit text and justification, and treats blank justification as absent.
- **K14** Typed client `addManualInsight` returns typed outcomes for 201, 403, 404, 422, 500. `contracts:check` passes.
- **K15** The migration length checks equal the domain constants.

## API (`apps/api/src/manual-insight-routes.postgres.test.ts`)

- **R25** Adding returns 201 and inserts exactly one row with text, justification, author, server date, source type `manual`, task, audit, submission, revision and revision identity.
- **R26** Two adds (including identical text) keep two rows; evidence open lists both oldest first with author display name and date; another submission's open lists none.
- **R27** Refusals write no row: Employé 403; malformed, unknown, other-team, draft and no-audit tasks give byte-identical 404 bodies equal to 9.1's; missing, blank, over-limit text, over-limit justification and extra properties (`authorId`, `createdAt`, `sourceType`) give 422; inconsistent snapshot gives 500.
- **R28** UPDATE, DELETE and TRUNCATE on `audit_manual_insights` are refused.
- **R29** Evidence tables, `audit_insight_decisions` and `tasks.updated_at` are byte-identical after adds; opens still write exactly one access row each and adds write none.
- **R30** Zero manual insights leaves the open and any later read working; log lines contain actor ID and class only (no text, justification or task ID).
- **R31** Text containing markup or script is stored and returned verbatim as plain text.

## Web (`accepted-evidence-render.test.tsx` and route handler test)

- **W18** The form renders for an accepted audit whether proposals are `available`, `unavailable` or empty; labels are associated; no file input exists.
- **W19** Manual insights render text, justification when present, « Ajout manuel », author and date, and no edit or delete control; markup in text is shown as text.
- **W20** « Aucun insight retenu » shows only when no proposal is retained and no manual insight exists, and is not styled as a warning.
- **W21** Submit calls the handler once, disables while pending, appends from the response and clears the form; on failure shows the French error, keeps typed text and the list unchanged.
- **W22** No approve, reject or conformity wording; the final-conformity note appears once; a scan finds no English text in the section.
- **W23** Route handler: CSRF rejection, cookie-only forwarding, `no-store`, status/body pass-through, 503 when unreachable.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check`, `git diff --check`.
