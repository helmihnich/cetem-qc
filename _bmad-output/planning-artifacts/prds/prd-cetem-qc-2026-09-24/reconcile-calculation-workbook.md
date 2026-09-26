# Calculation workbook input reconciliation

Date: 2026-09-25. Scope: reconcile the user's accepted extraction and three documentation corrections against the current [source extraction](../../../../docs/product/graphie-calculation-rules-source-extraction.md), [PRD](prd.md) and [addendum](addendum.md). This is documentation reconciliation, not CETEM BH approval of the derived specification or acceptance of implemented calculations. Historical logs remain unchanged.

## Coverage

| User requirement | Evidence and result |
|---|---|
| Neutral document title | The title is **Graphie Calculation Rules — CETEM BH Source Extraction**. The PRD and formula inventory link to the renamed source-extraction file. Covered. |
| Workbook provenance without implied Markdown approval | The extraction says CETEM BH supplied the workbook from which the specification was extracted, explicitly disclaims implied CETEM BH review/approval, and states the original remains unchanged. PRD §1 and DEP-01 retain that distinction. Covered. |
| Numerical calculation authorization | The extraction's implementation boundary and PRD FR-025/026 authorize automatic numerical calculations for explicitly defined formulas only. Missing inputs and other rules cannot be invented. Covered. |
| Individual verdict prerequisites | The extraction, PRD FR-026 and addendum explicitly require the applicable formula plus an established CETEM BH acceptance threshold, boundary semantics and comparison rule. The workbook alone does not authorize tolerance/pass-fail verdicts. Covered. |
| Formula relationships and traceability | All six relationship groups remain: voltage accuracy, repeated kV, output reproducibility, output repeatability, linearity and linearity relative to initial mean. Signed percentages, fixed divisors, denominators, the 0.49 factor and AVERAGE wrapper remain documented. The JSON and exact-formula inventory remain linked. Covered. |
| Open rules remain open | The extraction retains thresholds/boundaries/comparison, rounding, N.A./blank/invalid/zero handling, required/optional fields, missing kVmax/K2, initial linearity baseline and additional insight rules as unresolved. PRD DEP-01/02 retain the missing-rule and acceptance-dataset gates. Covered. |
| Human final machine decision | The extraction prohibits aggregation into automatic overall conformity. PRD non-goals, FR-026/038 and the addendum reserve final machine conformity to the Responsable. Covered. |

## Evidence checks

- The workbook's current SHA-256 matches the retained value: `C438DCB202ED71A6CD6FCD3E685FF48449EE1F2CAB788A6F8013798005AF49C4`.
- The [cell extraction](source-analysis/calcul-graphie-01-cells.json) contains 137 populated cells and 36 formulas. Each formula's exact cell/formula pair appears in the [formula inventory](source-analysis/calcul-graphie-01-formulas.md); no mismatches were found.
- B26 and C26 remain literal extrema, not inferred MIN/MAX formulas. O42 is absent from the populated-cell extraction; Q40 retains its formula and displayed `#DIV/0!`. No baseline or numerical replacement was supplied.
- The workbook was not reopened in Excel or edited for this reconciliation. These checks validate preservation and documentation consistency; they do not independently approve the workbook's example results as an acceptance dataset.

## Remaining gates and interpretation

No uncovered requirement from the three requested documentation corrections was identified. Existing PRD journey/display references to individual tolerance feedback describe conditional target behavior and must be read under FR-026; they do not establish missing verdict rules. The addendum repeats this prerequisite for both interfaces.

DEP-01 is only partially supplied. CETEM BH still needs to establish the missing calculation/application policies and each verdict's threshold, boundary semantics and comparison rule. DEP-02 still requires approved expected results and normal, abnormal, invalid and boundary cases; workbook examples do not close it. The missing O42 baseline and kVmax/K2 rules remain explicit gaps. No automatic overall machine-conformity rule is to be implemented even if those individual rules are later completed.

The PRD may proceed through documentation finalization with these gates visible. Documentation completion does not imply CETEM BH approval, implemented-rule acceptance, closure of other PRD open decisions, or production readiness.
