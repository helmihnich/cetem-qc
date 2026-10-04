# Graphie Calculation Fixtures — Source Regression versus Approved Acceptance

Story 6.5 separates two kinds of calculation fixture so that reproducing workbook evidence is never read as CETEM BH business approval. Both modules live in `packages/domain/src/` and are reachable only through their subpaths; the production root entry `@cetem-qc/domain` exports neither.

| Category | Module | Subpath | Content today |
|---|---|---|---|
| `source-regression` | `graphie-calculations.source-regression.ts` | `@cetem-qc/domain/source-regression` | 18 workbook cells of [CALCUL_graphie_01.xls](CALCUL_graphie_01.xls) re-read under rule `cetem-paper-form` 2.0.0 |
| `approved-acceptance` | `graphie-calculations.approved-acceptance.ts` | `@cetem-qc/domain/approved-acceptance` | empty |

## Source regression

Each workbook-derived case carries `category: "source-regression"` and its workbook provenance (workbook name, SHA-256, sheet, cell, formula). These cases prove that the code reproduces the source workbook under the paper-form rule ([source extraction](graphie-calculation-rules-source-extraction.md)). They are not CETEM acceptance and can never carry approval fields. The synthetic boundary, unavailable and versioning tests (B/U/V) in `graphie-calculations.test.ts` are rule-derived developer checks from the printed tolerances (Story 6.6), not CETEM acceptance either.

## Approved acceptance

Only a CETEM-signed reference dataset can fill `GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES`. No workbook, paper-form, synthetic or test-only case is ever added to it. Each case has:

| Field | Meaning |
|---|---|
| `category` | always `approved-acceptance` |
| `id` | case number as written in the CETEM approval document; never a workbook cell |
| `test` | one of the five paper tests |
| `caseKind` | `normal`, `abnormal`, `invalid` or `boundary` |
| `approval.approvedBy` | CETEM signatory as written on the approval |
| `approval.approvedOn` | approval date, ISO `YYYY-MM-DD` |
| `approval.documentRef` | approval document identifier |
| `approval.ruleId`, `approval.ruleVersion` | rule identity the case was approved against; must equal the current `GRAPHIE_CALCULATION_IDENTITY` |
| `values` | paper-form field ID → value as entered |
| `expected.values`, `expected.verdict` | expected result values (by path, e.g. `deviationPercent.0`) and per-test verdict, as written by CETEM |
| `match` | `exact`, or `approx` (\|actual − expected\| ≤ 1e-9) |

Every approved case runs in `pnpm -r test` through `calculateGraphieResults`, the same domain function mobile and server use. A guard test rejects empty approval fields, a non-ISO date, a duplicate `id`, a workbook `source` and a rule identity other than the current one.

## Adding a CETEM dataset

1. Get the signed approval document. Record its identifier, signatory and date.
2. Add one fixture per case, copying the values exactly as written by CETEM. Never derive expected values from the code.
3. Run `pnpm -r test`. A failing approved case is a defect or a rule disagreement to raise with CETEM, never a reason to edit the expectation.
4. If the rule version changes, the old approvals stop counting and fail the guard until CETEM re-approves them.

## Acceptance status

`graphieAcceptanceStatus(fixtures)` returns, per paper test in paper order, `blocked` with the missing case kinds, or `covered` once current-rule approved cases cover all four kinds. `covered` only means the dataset is complete; it is not business acceptance and never feeds a verdict, a UI text or an overall conformity. Final machine conformity stays an explicit decision of the Responsable. Light field stays `blocked` while the paper form prints no tolerance.

| Paper test | Status |
|---|---|
| Exactitude de la tension | blocked (DEP-02) |
| Répétabilité de la tension | blocked (DEP-02) |
| Reproductibilité et répétabilité du rayonnement de sortie | blocked (DEP-02) |
| Linéarité du rayonnement de sortie | blocked (DEP-02) |
| Correspondance champ lumineux / champ de rayons X | blocked (DEP-02, no printed tolerance) |

All four case kinds are missing for every test until CETEM supplies the approved reference dataset (DEP-02).
