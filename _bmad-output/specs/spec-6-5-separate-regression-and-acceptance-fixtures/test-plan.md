# Test plan

New file `packages/domain/src/graphie-calculations.approved-acceptance.test.ts`, discovered by the existing `src/**/*.test.ts` pattern. Test-only sample cases are built inside the test file and never added to the dataset. No real client names.

| ID | Case | Expect |
|---|---|---|
| A1 | Shipped dataset | `GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES` is an empty array |
| A2 | Category separation | every source-regression fixture has `category: "source-regression"`, a workbook `source` and no `approval`/`caseKind` key; every approved fixture has `category: "approved-acceptance"`, no `source`, and an `id` not among the source-regression cells |
| A3 | Approval guard (helper `assertApprovedFixture`) on test-only samples | accepts a complete sample; rejects a blank `approvedBy`, a blank `documentRef`, `approvedOn: "04/10/2026"`, `ruleVersion: "1.0.0"` and a duplicate `id`. The same helper runs over the real dataset |
| A4 | Runner on a test-only correct sample (workbook-free synthetic readings, e.g. voltage accuracy 100/105) | the expected value and verdict match `calculateGraphieResults` |
| A5 | Runner on the same sample with a wrong expected value or verdict | the runner reports a mismatch (assert.throws) |
| A6 | Runner over the real dataset | runs each case; zero cases today, passes |
| A7 | `graphieAcceptanceStatus(GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES)` | 5 entries in paper order, each `blocked` with `["normal","abnormal","invalid","boundary"]` |
| A8 | Status with test-only samples covering all four kinds for voltage-accuracy | voltage-accuracy `covered`, others `blocked`. Three kinds only gives `blocked` with the one missing kind. Samples with another rule version do not count |
| A9 | Light field with four test-only kinds | still `blocked` |
| A10 | Exports | the root `@cetem-qc/domain` (`index.ts`) exports no fixture symbol; `package.json` has `./approved-acceptance` and `./source-regression` subpaths |
| A11 | Docs | `docs/product/graphie-calculation-fixtures.md` exists and contains « blocked » and « DEP-02 » |

## Existing suites

- R1–R5, B1–B15, U1–U11, V1–V5 and `graphie-inputs.test.ts` pass with unchanged assertions. Only the B/U/V section header comments change.
- `apps/api` calculations tests pass unchanged.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` (contract unchanged), `git diff --check`.
