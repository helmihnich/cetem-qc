# Test plan

Synthetic names only. All tests use the mock provider or an injected fake; none reaches the network. PostgreSQL tests use the local harness, zero skipped, and reach accepted audits through the existing `sync-fixture.ts` path. A synthetic insight registry (existing `reviewCommandTestSeams.insightRegistry`) is used where a retained rule insight is needed.

## Domain (`packages/domain/src/summary-input.test.ts`)

- **D1** `buildSummaryInputSet` returns identity, sorted values, results and insights (retained rule statements, then manual text/justification); no task, establishment, service, employee, author, account, date or ID field exists in the output.
- **D2** Discarded and undecided proposal content never appears; zero retained insights gives `insights: []`.
- **D3** Pure: deep-frozen input passes and is not mutated; same input gives byte-identical `canonicalJson`; a changed value, result or insight changes it.
- **D4** `buildSummaryPrompt` contains the French instruction, the supplied data and nothing else; it forbids invented values and overall conformity.

## Schemas and client

- **K16** `summaryDraftResponseSchema` is strict, requires a 64-hex `summaryInputSetId` and `status: "generated"`; the request schema accepts only `{}`.
- **K17** Typed client `requestSummaryDraft` returns typed outcomes for 201, 403, 404, 422, 500, 502. `contracts:check` passes.
- **K18** The migration status/failure-class checks match the adapter failure classes.

## Adapters (`apps/api/src/modules/ai/*.test.ts`)

- **A1** `createSummaryDraftProvider`: unset, empty and `mock` give the mock; `gemini` gives gemini; an unknown value gives the mock and one warning that does not contain the value.
- **A2** Mock returns the fixed French text, model `mock-fixed-text`, no `fetch` call, no conformity wording.
- **A3** Gemini with an injected `fetch`: correct URL and model (default and `GEMINI_MODEL`), key only in `x-goog-api-key`, body holds the prompt, text parts are joined and trimmed.
- **A4** Gemini failures: missing key → `not-configured` and no `fetch` call; abort → `timeout`; rejected fetch, non-2xx, invalid JSON → `provider-error`; blank or missing text → `empty-output`. Error messages contain no provider body and no key.

## API (`apps/api/src/summary-draft-routes.postgres.test.ts`)

- **R32** A request returns 201 and inserts exactly one `generated` row with requester, server date, task, audit, submission, revision, identity, `input_set`, `summary_input_set_id` (equals the hash of the stored input set), provider `mock`, model, and text; the response matches the row.
- **R33** The stored input set holds exactly the retained insights at request time: a retained rule proposal and a manual insight appear; a discarded and an undecided proposal do not; a manual insight added later appears only in the next request's set; zero insights works with the production registry.
- **R34** Two requests keep two rows; the same data gives the same `summary_input_set_id`, changed insights give a different one.
- **R35** Provider failure (injected provider) inserts one `failed` row with the class and no text, returns 502 `AI_UNAVAILABLE`, and a retry with a working provider returns 201; the failed row carries no provider text.
- **R36** Refusals write no row and never call the provider: Employé 403; malformed, unknown, other-team, draft and no-audit tasks give byte-identical 404 bodies equal to 9.1's; non-empty body or extra property 422; inconsistent snapshot 500.
- **R37** UPDATE, DELETE and TRUNCATE on `summary_ai_drafts` are refused.
- **R38** Evidence tables, `audit_insight_decisions`, `audit_manual_insights`, `audit_review_accesses` and `tasks.updated_at` are byte-identical after requests; requests write no access row.
- **R39** The provider is called outside a transaction (no open write transaction during the call) and receives a prompt built only from the stored input set; a spy shows it contains no task ID, establishment, service or account name.
- **R40** Captured log lines contain actor ID, provider, status, class and duration only: no prompt, input value, draft text, key or task ID.

## Web (`accepted-evidence-render.test.tsx` and route handler test)

- **W24** The block, note, button and always-editable text area render for every accepted audit (proposals available, unavailable, empty).
- **W25** Pending shows the loading text, disables the button and sets `aria-busy`; a success fills an empty text area and shows « Brouillon IA — non confirmé » with provider, model and date.
- **W26** With typed text, a new draft appears in the separate block and replaces the text only after « Remplacer le texte par ce brouillon ».
- **W27** Failure (502 and network) shows the French alert, keeps typed text, and the button is enabled for retry.
- **W28** No save, confirm, conformity or approval control or wording; the final-conformity note is not duplicated; a scan finds no English text in the section; markup in the draft is shown as text.
- **W29** Route handler: CSRF rejection, cookie-only forwarding, `no-store`, status/body pass-through (incl. 502), 503 when unreachable.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check`, `git diff --check`.
