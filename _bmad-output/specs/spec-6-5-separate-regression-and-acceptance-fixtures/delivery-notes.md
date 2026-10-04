# Delivery notes

## Files affected

| File | Change |
|---|---|
| `packages/domain/src/graphie-calculations.approved-acceptance.ts` (new) | Types, empty dataset, `graphieAcceptanceStatus`, the guard helper and the runner used by the tests ([fixture-categories.md](fixture-categories.md)). |
| `packages/domain/src/graphie-calculations.approved-acceptance.test.ts` (new) | A1–A11. |
| `packages/domain/package.json` | `./approved-acceptance` export. |
| `packages/domain/src/graphie-calculations.test.ts` | Section headers for B/U/V state « rule-derived developer checks (printed tolerances, Story 6.6), not CETEM acceptance ». No assertion changes. |
| `docs/product/graphie-calculation-fixtures.md` (new) | Categories, approval fields, case kinds, procedure, status « blocked (DEP-02) » for all five tests. |
| `docs/product/graphie-calculation-rules-source-extraction.md` | One link to the new doc from the superseded section. |

Untouched: `graphie-calculations.source-regression.ts`, formulas, tolerances, identity, `graphie-inputs.ts`, `index.ts`, apps, API, OpenAPI, database, gate scripts, `.env`.

## Done at spec time

- `epics.md` Story 6.5 gains a traceability pointer to this spec.
- `sprint-status.yaml`: `6-5-separate-formula-regression-fixtures-from-approved-acceptanc: ready-for-dev`; `epic-6: in-progress`.
