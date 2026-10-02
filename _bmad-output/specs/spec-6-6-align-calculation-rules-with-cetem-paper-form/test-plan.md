# Test plan

All tests use full-precision `assert.equal` unless marked ≈. A ≈ comparison uses |actual − expected| ≤ 1e-9, and only where the workbook value comes from Excel's 0.49 arithmetic.

## Workbook regression (`graphie-calculations.source-regression.ts` + `graphie-calculations.test.ts`)

Keep the fixtures with category `source-regression`, and add a `paperRule` note wherever the paper changes the reading.

| # | Function | Inputs (workbook cells) | Expected |
|---|---|---|---|
| R1 | `voltageAccuracy` | D13/E13 = 50/49.2, D14/E14 = 70/69.6, D15/E15 = 120/119.8 | −1.5999999999999945, −0.5714285714285796, −0.16666666666666904 (= −F13, −F14, −F15). Verdict `conforme`. |
| R2 | `voltageRepeatability` | C20:C24 = 69.7, 69.6, 69.7, 69.6, 69.7 | mean 69.66 (D26), min 69.6 (B26), max 69.7 (C26), minDev −0.08613264427218242 (D20), maxDev 0.057421762848128416 (E20). Verdict `conforme`. |
| R3 | `outputRepeatability` | L25:L29 = 2.677, 2.708, 2.705, 2.708, 2.705 | kermaMean 2.7006 (N25). Deviations −0.8738798785455107, 0.27401318225579774, 0.1629267570169577, 0.27401318225579774, 0.1629267570169577 (P25–P29). Verdict `conforme`. |
| R4 | `outputLinearity` | DFC 0.70, mas 10/40/160, kerma 0.672/2.708/11 | k2 = 0.03326283333333333 (O40, exact in JS). Deviations ≈ −1.006629020378098, −0.2700712005892382, 1.2767002209673364 (P40–P42). Verdict `conforme`. |
| R5 | fixtures file | — | P14, O25 and Q40 fixtures are removed. No fixture references 0.49 except as a note that DFC 0.70 reproduces it. |

## Boundary cases (inputs chosen so the percentage is exact in IEEE doubles)

| # | Function | Inputs | Value | Verdict |
|---|---|---|---|---|
| B1 | `voltageAccuracy` | rows 50/55, 70/70, 100/100 | +10 | `conforme` (≤) |
| B2 | `voltageAccuracy` | rows 50/45, 70/70, 100/100 | −10 | `conforme` |
| B3 | `voltageAccuracy` | row 1 = 100/110.001 | > 10 | `non-conforme` |
| B4 | `voltageRepeatability` | 95, 105, 100, 100, 100 | mean 100, minDev −5, maxDev +5 | `conforme` (≤) |
| B5 | `voltageRepeatability` | 94.9, 105, 100, 100, 100.1 | minDev < −5 | `non-conforme` |
| B6 | `outputRepeatability` | 110, 90, 100, 100, 100 | ±10 | `non-conforme` (<) |
| B7 | `outputRepeatability` | 109, 91, 100, 100, 100 | ±9 | `conforme` |
| B8 | `outputLinearity` | DFC 1, mas 1/1/1, kerma 115/85/100 | k2 100, deviations +15, −15, 0 | `non-conforme` (<) |
| B9 | `outputLinearity` | DFC 1, mas 1/1/1, kerma 114/86/100 | ≈ ±14 (14.000000000000002) | `conforme` |
| B10 | `lightFieldCorrespondence` | DFR 1, gaps 2, −3, 1, −4 | sum 10 mm, result 1 % | `indisponible` / `no-tolerance` |

| B11 | `voltageAccuracy` | one row with deviation 10.000000000000002 (verdict helper fed directly) | 10.000000000000002 | `conforme` (≤, noise absorbed) |
| B12 | `outputRepeatability` / verdict helper | deviation exactly 10 | 10 | `non-conforme` (<) |
| B13 | `outputRepeatability` / verdict helper | deviation 9.99999999 | 9.99999999 | `conforme` (<; 10 − x ≈ 1.0000000827e-8 > ε) |
| B14 | verdict helper | 10.001 under ≤ 10 | — | `non-conforme` (the epsilon does not widen the tolerance) |
| B15 | code check | — | — | the `<` comparison is written `limit - Math.abs(x) > TOLERANCE_EPSILON` (code review or a source assertion; 9.99999999 in B13 passes under both forms, so B13 alone does not catch the wrong form) |

B11–B14 may call the exported comparison helper (e.g. `judgeTolerance(values, tolerance)`) with explicit numbers. Inputs that make the formula produce exactly those doubles are not required.

Assert the exact numeric value before asserting the verdict, so that a floating-point drift fails loudly.

## Unavailable and verdict-precedence cases

| # | Case | Expected |
|---|---|---|
| U1 | `voltageAccuracy` row 3 kvDisplayed `null`, rows 1–2 valid | rows 1–2 calculated, row 3 `missing-input`, verdict `indisponible` / `missing-input` |
| U2 | `voltageAccuracy` row 1 out of tolerance and row 3 `null` | verdict `indisponible` (not `non-conforme`) |
| U3 | kvDisplayed = 0 | that row `zero-denominator`, verdict `indisponible` / `zero-denominator` |
| U4 | `voltageRepeatability` with 4 readings, or one `null` | all values `missing-input` |
| U5 | any reading `NaN` / `Infinity` | `invalid-input` |
| U6 | `outputLinearity` DFC `null` | kermaAt1m, k1, k2 and deviations unavailable; verdict `indisponible` |
| U7 | `outputLinearity` one mas = 0 | that k1 `zero-denominator`; k2 and deviations unavailable |
| U8 | `lightFieldCorrespondence` DFR = 0 | sum calculated, result `zero-denominator` |
| U9 | overflow (`Number.MAX_VALUE` readings) | `invalid-input`, never `Infinity` (keeps the existing test) |

## Versioning and provenance

| # | Case | Expected |
|---|---|---|
| V1 | each function with the old rule tuple, and with each single field mismatched (catalogueId, catalogueVersion, schemaVersion, ruleId, ruleVersion `"1.0.0"`) | `unsupported-version` with the context echoed |
| V2 | `GRAPHIE_CALCULATION_IDENTITY` | `graphie-mobile-pov` / `2.0.0` / `3` / `cetem-paper-form` / `2.0.0` |
| V3 | every result's `formulaSource` | `ruleId` `cetem-paper-form`, plus page/section/photo per the provenance table. `workbookExample.cells` is present exactly for voltage-repeatability, output-repeatability and output-linearity. |
| V4 | domain exports | no `outputReproducibility*`, `initialLinearity`, `outputRepeatabilityMeans` or `unresolved-source-rule` (type-level check plus `Object.keys(graphieCalculations)` snapshot) |
| V5 | no overall verdict | `Object.keys(graphieCalculations)` equals exactly the 5 functions |

## Adapters and mobile (no UI change)

- `apps/mobile/graphie-calculation-service.test.ts`: mobile parity with the domain for all 5 functions. A draft with the old rule returns `unsupported-version`.
- `apps/api/src/modules/calculations/calculations.test.ts`: API parity with mobile for all 5 functions. The `calculateGraphie` cast type no longer names `rawKermaMean`.
- Mobile tuple fixtures are updated as described in [versioning-and-compatibility.md](versioning-and-compatibility.md). A `2.0.0`/`3` draft with the old rule shows the compatibility notice and its bytes stay unchanged.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, the boundary checker, the generated-contract check (expect no diff) and `git diff --check`.
