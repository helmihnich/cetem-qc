---
title: 'Story 6.1: Implement explicitly defined source-workbook calculations'
story: 6.1
status: done
baseline_commit: ed07e9bde56c27f896504d6e341e6dac70d4e020
planning_baseline:
  epic_definition: _bmad-output/planning-artifacts/epics.md#story-61-implement-explicitly-defined-source-workbook-calculations
  calculation_source: docs/product/graphie-calculation-rules-source-extraction.md
  catalogue_id: graphie-mobile-pov
  catalogue_version: 1.0.0
  schema_version: 2
---

# Story 6.1 implementation plan

## Exact story definition

**As an Employé,**
**I want derived numerical values calculated from the confirmed workbook relationships,**
**So that the field form reproduces CETEM BH's supplied calculation evidence.**

**Acceptance criteria (verbatim from `epics.md`):**

**Given** the inputs required by an explicitly defined source formula are present
**When** the calculation engine evaluates them
**Then** it preserves signed percentage deviations, fixed divisors, referenced readings and the distinction between normalized Kerma/mAs reproducibility and raw-Kerma repeatability
**And** it preserves the explicit 0.49 linearity factor and formula wrapper, and does not infer MIN/MAX extrema, mAs, kVmax, K2, baseline values, rounding or special-value handling
**And** missing/zero/invalid inputs whose behavior is undefined by CETEM remain unavailable/blocked rather than mapped to zero, N.A. or a pass.

**Traceability:** FR-025, DR-002, DR-003, AD-7. **Dependency:** DEP-01R for unspecified rules; source extraction authorizes only documented formulas.

This exact story scope does not include the later stories' shared mobile/server implementation (6.2), Employé presentation (6.3), Responsable presentation (6.4), or approved-fixture category and acceptance gate (6.5). It is calculation/domain behavior only. No contradiction with the newer catalogue decision was found: the catalogue is project-defined and versioned, while its workbook provenance does not claim CETEM approval.

## In scope

- Pure deterministic calculation of each explicitly recovered formula family below, using unrounded numeric inputs and preserving source relationships.
- Typed outputs sufficient to distinguish a computed number from an unavailable/blocked result. Undefined missing, invalid, blank, and zero-denominator cases must not become a number, N.A., or verdict. This does not choose a user-facing message or field-validation policy.
- Carry calculation definition provenance (formula/rule identifier and version) and catalogue/schema identity alongside calculation context so a later catalogue revision cannot silently reinterpret a stored measurement.
- Source-regression examples with workbook, sheet, cell, formula, input, and expected output provenance. These are not CETEM-approved acceptance fixtures.

## Confirmed source formulas

All cells are from `Feuil1` in `CALCUL_graphie_01.xls`; see the extraction and formula inventory linked there.

| Family | Formula relationships to preserve |
|---|---|
| Exactitude tension | Rows 13–15: `F=((D-E)/D)*100` (signed). |
| Tension repeated readings | `D26=SUM(C20:C24)/5`; `D20=SUM((B26-D26)/D26)*100`; `E20=((C26-D26)/D26)*100`. `B26=69.6`, `C26=69.7` are literal workbook values, not derived extrema. |
| Output reproducibility | Rows 14–16: `O=N/K`; `P14=(O14+O15+O16)/3`; each `Q=((O-P14)/P14)*100`. This is normalized Kerma/mAs. |
| Output repeatability | Rows 25–29: `M=L/K`; `N25=(L25+...+L29)/5`; `O25=(M25+...+M29)/5`; each `P=((L-N25)/N25)*100`. Deviations use raw Kerma. |
| Output linearity | `M40=AVERAGE(0.49*L40)` (wrapper retained); `M41=0.49*L41`; `M42=0.49*L42`; `N=M/K`; `O40=(N40+N41+N42)/3`; each `P=((N-O40)/O40)*100`. |
| Initial linearity | `Q40=(O40-O42)/O42*100`; source `O42` is blank and Excel yields `#DIV/0!`. Do not synthesize a baseline or map this error to zero/null/pass. The story's unavailable/blocked result applies. |

Do not add formulas for kVmax, K2, tolerance verdicts, or other measures. Do not infer mAs from mA/time. Preserve fixed divisors and signed percentages. No source-backed rounding rule exists.

## Deterministic source-regression fixture plan

Keep these cases labelled `source-regression` and separate from CETEM-approved acceptance data. Fixture records should include source workbook name/hash, sheet and relevant cell, verbatim formula, input values, expected numeric output or explicit source error/unresolved condition, and an explanatory note. Expected values below were verified against the extracted formula inventory; they are regression examples only.

| Case | Inputs/source | Expected result |
|---|---|---|
| Repeated-kV mean | `Feuil1!C20:C24`; formula `SUM(C20:C24)/5` | `Feuil1!D26 = 69.66` |
| Output reproducibility mean | `Feuil1!O14:O16`; formula `(O14+O15+O16)/3` | `Feuil1!P14 = 0.06325000000000001` (approximately `0.06325`) |
| Output repeatability raw mean | `Feuil1!L25:L29`; formula sum `/5` | `Feuil1!N25 = 2.7006` |
| Output repeatability normalized mean | `Feuil1!M25:M29`; formula sum `/5` | `Feuil1!O25 = 0.067515` |
| Linearity mean | `Feuil1!N40:N42`; formula sum `/3`, with `M40=AVERAGE(0.49*L40)` retained upstream | `Feuil1!O40 = 0.03326283333333333` |
| Initial-linearity unresolved case | `Feuil1!O42` blank; `Q40=(O40-O42)/O42*100` | Source displays `#DIV/0!`; application outcome remains unavailable/blocked, never a fabricated numeric value. |

Use the source SHA-256 recorded in `docs/product/graphie-calculation-rules-source-extraction.md`. Do not invent additional fixture readings or CETEM acceptance outcomes. DEP-02 approved cases remain a separate future gate.

## Proposed code and data placement

- Implement calculation primitives and typed result contracts in `packages/domain`, whose current public entry point is `packages/domain/src/index.ts` and which already exists as the shared domain boundary.
- Keep formula definitions in a dedicated calculation module under that package; do not place formula expressions in React components or in the mobile catalogue renderer.
- Put provenance-tagged source regression cases next to the domain calculation module/test boundary, visibly categorized as source evidence, not approved acceptance data.
- Mobile may call the pure package calculation locally/offline. API reuse and parity integration belong to Story 6.2; result UI belongs to Stories 6.3 and 6.4.

## Versioning

Bind calculation definitions to the current catalogue/schema pair (`graphie-mobile-pov` / `1.0.0` / `2`) and assign a calculation-rule version to the implemented formula set. Keep these identifiers distinct: catalogue/schema changes describe captured data shape, while rule version identifies formula semantics. Inputs/results must carry enough identity for later consumers to reject or explicitly handle unsupported versions. Do not build a migration framework or server negotiation in this story; Story 6.2 owns shared enforcement. Any future catalogue change that changes meaning requires an explicit rule-version change, never silent historical reinterpretation.

## Offline, security, and lifecycle constraints

Calculations are pure local work with no network dependency, AI, synchronization, or outbox. Preserve Story 5.2 authorization scoping and Story 5.3 encrypted-draft lifecycle. Calculation reads/writes remain within the already authorized employee/task context; do not copy identity or authorization claims into calculation data. Do not weaken stale-async protections or reveal data across employee/task switches. Submission immutability and server acceptance remain later-story behavior.

## Dependencies and later boundaries

- **Story 5.4:** catalogue ID/version and schema version exist in structured Graphie drafts. Story 6.1 associates its rule definitions with that versioned input shape; it does not alter catalogue fields or claim the project catalogue was CETEM-approved.
- **Story 5.5:** offline editing, employee/task-scoped authorization context, and stale asynchronous access protections are inherited. The retrospective requires deterministic provenance-tagged fixtures before calculation expansion; this spec supplies that plan.
- **Story 6.2:** shared mobile/server implementation and server parity/version enforcement.
- **Stories 6.3–6.4:** presentation of numerical output and unavailable rule status.
- **Story 6.5 / DEP-02:** distinct approved acceptance fixture set and acceptance blocking until normal, abnormal, invalid, and boundary cases are approved.
- Tolerance thresholds/boundaries, individual pass/fail, deterministic insights, and overall conformity are not in Story 6.1. Overall conformity remains an explicit Responsable decision.

## Open questions and readiness

| Uncertainty | Classification | Story 6.1 disposition |
|---|---|---|
| Thresholds, inclusive/exclusive boundaries, tolerance comparison, and approved CETEM cases (DEP-01R/DEP-02) | Not blocking numerical calculation; required for later verdict/acceptance behavior | Keep verdict unavailable; do not infer. |
| Display rounding and special-value presentation | Not blocking calculation of valid source formulas; belongs to later presentation/acceptance decisions | Preserve calculation precision; undefined inputs yield blocked/unavailable result. |
| Missing/blank/invalid/zero input application policy, including zero denominator | Blocking only for evaluating those affected cases; not blocking supported formulas when their required numeric inputs are valid and present | Return a nonnumeric unavailable/blocked state without choosing N.A./zero/pass semantics. Must be explicit in implementation contract before those cases are exercised. |
| Initial-linearity baseline `O42` | Not blocking other formulas; blocks a numeric initial-linearity result on current source evidence | Preserve unresolved source error as unavailable/blocked. |
| kVmax/K2 rules and mAs derivation | Not blocking documented formulas; belongs to unresolved DEP-01R work | No calculation is enabled for these rules. |
| Rule-version identifier naming and result envelope shape | Technical implementation choice | Select stable explicit identifiers during implementation; no product decision needed. |

**Readiness: READY FOR DEV, bounded to the documented formulas and valid, present inputs.** Unresolved business rules block affected verdicts and undefined-input outcomes, not the explicitly defined numerical calculations. No product code is authorized by this planning artifact itself. Story 6.2 must not begin as part of this work.

## Implementation review triage

- **Source-fixture coverage — patched:** regression tests now consume the recorded fixture readings, check the source formulas, exercise both raw and normalized repeatability means, and assert that the Q40 baseline remains blank with the workbook's `#DIV/0!` result. Expected workbook values were not changed.
- **Version-context review — no further findings:** independent reviews confirmed that the catalogue/schema/rule tuple is shared and validated before calculation, with unsupported contexts returned as unavailable without a calculation identity.
