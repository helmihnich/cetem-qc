# Test plan

Synthetic names only. Test rules are defined inside tests and passed as the `registry` argument. PostgreSQL tests use the local harness, zero skipped, and reach accepted audits through the existing `sync-fixture.ts` path.

## Domain (`packages/domain/src/insight-rules.test.ts`)

- **I1** `INSIGHT_RULE_REGISTRY` is empty and `validateInsightRegistry` accepts it. A guard test lists the registry rule IDs and fails if a rule lacks a fixture test in `insight-rules.approved-fixtures.test.ts`.
- **I2** `evaluateInsightProposals` with the production registry returns `unavailable` / `no-approved-rules`, empty proposals, the registry version.
- **I3** Registry validation throws for: empty approval reference, duplicate `(ruleId, ruleVersion)`, non-positive version, empty or unknown `sources`, missing French template.
- **I4** Synthetic approved registry with two rules: output has full provenance fields, French statement from template and params only, `origin: "deterministic"`.
- **I5** Determinism: ten runs on deep-equal input give deep-equal output. Reordering the registry array or the `values` keys does not change output order. Order is ruleId, ruleVersion, source keys. `proposalId` follows the documented format.
- **I6** A registry whose rules do not fire returns `available` with zero proposals (distinct from I2).
- **I7** Purity: the evaluator does not mutate its input (deep-frozen input passes) and does not call `Date`, `Math.random` or `fetch` (spies not called).
- **I8** A rule that throws propagates the error.

## Schemas and client

- **K9** `acceptedEvidenceResponseSchema` requires `insights`, parses both statuses, refuses extra properties, a proposal missing provenance, `unavailable` with proposals, and an unknown reason. `contracts:check` passes.
- **K10** The typed client still returns typed outcomes for 200, 403, 404, 500 and exposes `insights` on 200.

## API (extend `evidence-review-routes.postgres.test.ts`)

- **R12** With the production registry an own-team open returns `insights` `unavailable`; exactly one access row; all 9.1 assertions (R1–R11) still pass unchanged.
- **R13** With a test seam supplying a synthetic registry, the open returns the expected proposals once and writes one access row. Repeated opens return identical `insights`.
- **R14** A throwing rule returns 500 `INTERNAL_ERROR`, no access row, no evidence field.
- **R15** All refusals (Employé, malformed, unknown, other team, draft, no audit) are byte-identical to 9.1 and contain no `insights` field.
- **R16** Evidence tables and `tasks.updated_at` are byte-identical after opens with proposals; no new table exists.

## Web (`accepted-evidence-render.test.tsx`)

- **W8** `unavailable`: the message « Propositions d’insights indisponibles : aucune règle CETEM approuvée. » appears once; no proposal item, no retain, discard, approve or conformity control.
- **W9** `available` with zero proposals shows « Aucune observation proposée par les règles approuvées. ».
- **W10** `available` with two synthetic proposals shows statement, rule ID and version, approval reference and source labels read-only; still no action control; the final-conformity note appears once.
- **W11** The component performs no evaluation (render with a proposal whose statement differs from any template shows it unchanged).
- **W12** i18n: `fr.insights` strings exist; a test scans the section for English text.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check` (domain imports nothing from apps), `pnpm contracts:check`, `git diff --check`.
