---
id: SPEC-6-5-separate-regression-and-acceptance-fixtures
story: 6.5
status: done
approved: 2026-10-04
baseline_commit: 8ca0508
depends_on: [6.1, 6.2, 6.6]
companions:
  - fixture-categories.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-6-6-align-calculation-rules-with-cetem-paper-form/calculation-functions.md
  - ../spec-6-6-align-calculation-rules-with-cetem-paper-form/tolerances.md
sources:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/implementation-artifacts/epic-6-context.md
  - docs/product/graphie-calculation-rules-source-extraction.md
  - docs/product/source/formulaire-cetem/
---

# Story 6.5 — Separate formula regression fixtures from approved acceptance fixtures

## Why

**Pain.** The only calculation fixtures are 18 workbook cases (`CALCUL_graphie_01.xls`) re-read under rule `cetem-paper-form` `2.0.0`. They prove the code reproduces the source, not that CETEM BH accepts the results. Nothing in the code holds a place for CETEM-approved cases, records who approved them, or states that calculation and verdict acceptance is still blocked (DEP-02). Without that, a passing regression suite can be read as business approval.

**Story statement.** As a developer, I want source-derived formula cases and CETEM-approved acceptance cases identified separately, so that reproducing workbook evidence is not mistaken for business approval.

## Capabilities

Each `success` is an acceptance criterion. Shapes and rules: [fixture-categories.md](fixture-categories.md). Tests: [test-plan.md](test-plan.md).

- **CAP-1** — Source-regression category, labelled and guarded
  - **intent:** Every workbook-derived case is identified as source-regression evidence with its workbook provenance and can never pass for an approved case.
  - **success:** All 18 existing fixtures keep `category: "source-regression"`, workbook name, SHA-256, sheet, cell and formula, and R1–R5 pass with unchanged assertions. A test fails if any source-regression fixture carries an approval field, or if any approved case has a workbook `source` or a cell that is in the source-regression set.
- **CAP-2** — Separate approved-acceptance category with approval provenance
  - **intent:** CETEM-approved reference cases have their own typed store, separate from regression evidence, and each one says who approved it, when, in which document, against which rule version, and which kind of case it is.
  - **success:** `@cetem-qc/domain/approved-acceptance` exports `ApprovedAcceptanceFixture` and `GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES`, which is empty. The type makes `category: "approved-acceptance"`, `approval.approvedBy`, `approval.approvedOn`, `approval.documentRef`, `approval.ruleId`, `approval.ruleVersion` and `caseKind` mandatory. A guard test rejects empty approval strings, a non-ISO date and a rule identity other than `GRAPHIE_CALCULATION_IDENTITY`. The root entry `@cetem-qc/domain` exports neither fixture module.
- **CAP-3** — Approved cases execute against the shared domain
  - **intent:** When CETEM supplies cases, they run in the normal test pipeline through the same domain function mobile and server use.
  - **success:** A test runs every approved case through `calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, case.values)` and compares the expected values and verdict for that case's test. A test-only sample case built in the test file (never added to the dataset) proves the runner detects a wrong expected value. With today's empty dataset the runner checks zero cases and passes.
- **CAP-4** — Acceptance status blocked until coverage exists
  - **intent:** The code states, per paper test, whether calculation/verdict acceptance is blocked, and why.
  - **success:** `graphieAcceptanceStatus(fixtures)` returns, for each of the five tests in paper order, `{ status: "blocked", missingCaseKinds }` unless approved cases for that test cover `normal`, `abnormal`, `invalid` and `boundary`, in which case it returns `covered`. For the shipped dataset all five are `blocked` with all four kinds missing, pinned by a test. Light field is always `blocked`. There is no overall, machine-level or `accepted` status.
- **CAP-5** — Written record for developers and the PO
  - **intent:** People reading the repository see the two categories, how CETEM data gets added, and that acceptance is blocked.
  - **success:** `docs/product/graphie-calculation-fixtures.md` describes both categories, the approval fields, the four case kinds, the procedure for adding a CETEM dataset, and the current status « blocked (DEP-02) » for all five tests. The B/U/V section headers in `graphie-calculations.test.ts` say they are rule-derived developer checks, not CETEM acceptance.

## Constraints

- Never invent approved data. No workbook, paper-form, synthetic or test-only case is added to `GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES`. Only a CETEM-signed dataset can fill it.
- No change to formulas, tolerances, identity, catalogue, `calculateGraphieResults`, API, OpenAPI, database, app UI or gate scripts. No existing test is removed, skipped or weakened.
- Fixture modules stay off the production root entry, reachable only through their subpaths, as decided in Story 6.2.
- `covered` means the dataset has the four kinds. It is not business acceptance and never feeds a verdict, a UI text or an overall conformity. Final machine conformity stays a human Responsable decision.

## Non-goals

- Producing or approving any reference case, or fixing the light-field tolerance (CETEM / DEP-02).
- Showing acceptance status in the mobile or web UI.
- Re-labelling inline workbook readings in i18n, web and mobile test files. They already carry a « not CETEM-approved » comment.
- Unresolved rules: display precision, requiredness, special values, insights (DEP-01R).

## Success signal

`pnpm -r test` runs the domain suite. R1–R5 pass unchanged against the 18 source-regression fixtures. The guard tests show the two categories are disjoint and approval provenance is mandatory. The approved-case runner runs over an empty dataset and catches a wrong expectation in its test-only sample. `graphieAcceptanceStatus(GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES)` returns `blocked` with `normal, abnormal, invalid, boundary` missing for all five tests. All gates pass.

## Confirmed decisions

Resolved from the code, the approved 6.1/6.2/6.6 specs, the epics, the paper form and the PO decisions in the pipeline rules (2026-10-04):

- **Keep the regression module.** `graphie-calculations.source-regression.ts` and its subpath stay as they are, so the domain and API tests that use them do not change. The approved category is a sibling module.
- **Empty approved dataset.** CETEM has supplied no approved reference dataset (DEP-02). The paper-form photos are blank apart from preset settings, so they add no example readings.
- **Case kinds** are the four named by the epics AC: normal, abnormal, invalid, boundary. Coverage is checked per test, and a test is `blocked` until all four exist for the current rule identity.
- **Stale approvals fail.** An approved case bound to another rule identity fails the guard test. It has to be re-approved, not silently reused.
- **Approved-case input** is the paper-form value map (field ID → string as entered), run through `calculateGraphieResults`. This is the path mobile uses and the server will use at acceptance.
- **Synthetic B/U/V tests** remain developer unit tests derived from the printed tolerances (Story 6.6). Their headers label them as such.
- Light field stays `blocked` / « indisponible » (PO rule). No overall conformity (PO rule).

## Open Questions

None blocks this story.

- **For CETEM (DEP-02):** supply the approved reference dataset (normal, abnormal, invalid and boundary cases per test, with the approval document) and the light-field tolerance. Until then acceptance stays `blocked`.

## Review Findings

Code review 2026-10-04 (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). 0 decision-needed, 9 patch (all applied), 3 defer, 10 rejected.

- [x] [Review][Patch] `graphieAcceptanceStatus` counted cases that fail the guard (blank approval, bad date, empty id). Only cases that pass `assertApprovedFixtures` count now. A8 pins it with an unsigned sample [packages/domain/src/graphie-calculations.approved-acceptance.ts:72]
- [x] [Review][Patch] The runner did not validate the fixture, so a stale-rule case could pass when the runner was called on its own. It now calls `assertApprovedFixtures([fixture])` first (A5) [packages/domain/src/graphie-calculations.approved-acceptance.ts:141]
- [x] [Review][Patch] Nothing checked the test-to-result mapping (`resultKey`) for four of the five tests. The runner now fails if the result's `test` differs from the fixture's, and A4b runs one case per paper test [packages/domain/src/graphie-calculations.approved-acceptance.ts:144]
- [x] [Review][Patch] `exact` used `Object.is`, so an expected `0` failed against a computed `-0`. It now uses `===` [packages/domain/src/graphie-calculations.approved-acceptance.ts:152]
- [x] [Review][Patch] No test separated `exact` from `approx`. A4/A5 now check `5 + 1e-12`: it passes under approx and throws under exact [packages/domain/src/graphie-calculations.approved-acceptance.test.ts]
- [x] [Review][Patch] The unavailable-reason mismatch branch was not pinned. A5 now expects `invalid-input` where the code returns `missing-input`, and asserts it throws [packages/domain/src/graphie-calculations.approved-acceptance.test.ts]
- [x] [Review][Patch] The guard accepted an empty `id`, and its category, case-kind and unknown-test branches had no tests. Added the id guard and A3 cases [packages/domain/src/graphie-calculations.approved-acceptance.ts:96]
- [x] [Review][Patch] A11 only matched the words « blocked » and « DEP-02 ». It now requires a `blocked (DEP-02` row for each of the five paper tests [packages/domain/src/graphie-calculations.approved-acceptance.test.ts]
- [x] [Review][Patch] The stale header « U1–U9 » now reads « U1–U11 » [packages/domain/src/graphie-calculations.test.ts:214]
- [x] [Review][Defer] Approved cases may have empty or partial `expected.values` and then pass on the verdict alone [packages/domain/src/graphie-calculations.approved-acceptance.ts] — deferred: what counts as a complete expectation depends on the shape of the CETEM dataset (DEP-02)
- [x] [Review][Defer] Keys in `values` are not checked against the paper-form field IDs, so a typo becomes missing input [packages/domain/src/graphie-calculations.approved-acceptance.ts] — deferred: worth adding when the first CETEM dataset is entered
- [x] [Review][Defer] Ids must be unique across the whole dataset, not per `documentRef`. Two CETEM documents that both number a case « 1 » would clash [packages/domain/src/graphie-calculations.approved-acceptance.ts:112] — deferred: depends on how CETEM numbers its cases (DEP-02)

### Rejected

- low, spec edit: light field shows `blocked` with an empty `missingCaseKinds` and no reason field. The shape is fixed by fixture-categories.md, and the doc records the reason (no printed tolerance).
- spec edit: comparing the verdict reason or tolerance. `expected.verdict` is defined as the status only.
- low: matching workbook-cell ids in other spellings (`f13`, `Feuil1!F13`). The spec requires no exact match with a source cell; only CETEM ids enter the dataset.
- low: no upper bound on `approvedOn` (future dates). It would be a guard with no named rule.
- low: A8's `notEqual(…, "accepted")` adds nothing. It is harmless and the union type already enforces it.
- false: "the spec is missing from the diff". The spec folder is untracked and is committed with the change.
- false: TypeError for an unknown `test` in the runner. The runner now validates first and reports « unknown test ».
- low: `approx` with ±Infinity. The domain never returns Infinity (U9).
- low: the helper is named `assertApprovedFixtures` (plural), not the singular in the test plan. The array form is needed for the duplicate-id check.
- low: the approved-acceptance module imports the source-regression fixtures. The disjointness guard requires it, and neither module reaches the root entry.
