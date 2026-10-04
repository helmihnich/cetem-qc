# Test plan

All tests run under `pnpm -r test` (pattern-discovered since Story 6.7). The fixtures are source-regression/paper-rule cases, not CETEM-approved acceptance cases (Story 6.5). Tests never use real client names.

## Domain — `packages/domain/src/graphie-inputs.test.ts`

| ID | Case | Expect |
|---|---|---|
| P1 | `undefined`, `""`, `"   "` | `null` |
| P2 | `"49,2"`, `"49.2"`, `" 49,2 "`, `"-3"`, `"+0,5"`, `"007"` | 49.2, 49.2, 49.2, −3, 0.5, 7 |
| P3 | `"abc"`, `"1e3"`, `"1 000"`, `"1.000,5"`, `"N.A"`, `"5,"`, `",5"`, `"1,2,3"`, `"Infinity"` | `NaN` (and `isInvalidGraphieReading` true) |
| P4 | `isInvalidGraphieReading("")` | false |
| G1 | Full value map → `graphieTestInputsFromValues` | each of the 5 inputs equals the 6.6 field mapping, in row order |
| G2 | Change every non-formula field (`voltage.repeatability.mas`, `…maMaxHalf`, `…rowN.kvDisplayed`, `output.linearity.maMaxHalf`, `…rowN.kvDisplayed`, `lightField.kv`, `lightField.mas`) | the 5 inputs are deep-equal to before |
| G3 | Workbook regression readings as comma strings → mapping → `graphieCalculations` | the same values as the 6.6 regression suite (e.g. −1.5999999999999945, moy 69.66, Kerma moy 2.7006) |
| G4 | One kV mesuré blank / `"abc"` | that test's verdict is `indisponible` / `missing-input` / `invalid-input`; others unaffected |

## Catalogue binding — `apps/mobile/graphie-pov-catalogue.test.ts`

| ID | Case |
|---|---|
| C1 | Every field ID in the domain mapping table exists in `GRAPHIE_MOBILE_POV_CATALOGUE` with type `number`. |

## Mobile service — `apps/mobile/graphie-calculation-service.test.ts`

| ID | Case |
|---|---|
| S1 | `calculateGraphieResults(current identity, values)` returns 5 results equal to calling the domain directly (parity). |
| S2 | An old-rule identity (`cetem-workbook-explicit-formulas` 1.0.0) gives `unsupported-version` for all 5. |

## App render — `apps/mobile/App.render.test.tsx`

| ID | Case | Expect |
|---|---|---|
| R1 | New form, offline (no API mock called), voltage accuracy: type `49,2` in KV min kV mesuré | block shows « -1,5999999999999945 % », provenance with « cetem-paper-form 2.0.0 » and « page 2 »; KV max row « Indisponible — mesure manquante »; verdict « Verdict indisponible : mesure manquante » |
| R2 | Fill all 3 rows within 10 % | « Conforme (suggestion) » and « Tolérance : \|écart\| ≤ 10 % » |
| R3 | One row at 11 % | « Non conforme (suggestion) » |
| R4 | Repeatability section, 5 kV + 5 Kerma readings | two blocks; Kerma moy and 5 écarts; tolerances ≤ 5 % and < 10 % |
| R5 | Linearity with DFC `0,7` | K2 and 3 écarts; « < 15 % » |
| R6 | Light field with D.F.R `1` and 4 écarts | Σ and résultat shown; always « Verdict indisponible : aucune tolérance imprimée sur le formulaire officiel » |
| R7 | Type `abc` in a number field | « Valeur numérique invalide » under the input; input still shows `abc`; block shows « valeur numérique invalide »; save still works |
| R8 | Save, unmount, remount offline, resume | same result texts; saved payload `values` contain only the typed strings (no derived keys, no reformatted values) |
| R9 | Whole rendered tree in every section | no « Machine conforme », no overall verdict, no text `0` standing in for an unavailable value; « décidée par le Responsable » line present in each block |
| R10 | Verdict accessibility | the verdict element's `accessibilityLabel` contains the full words, not only ✓/✗ |
| R11 | Draft stamped with the old rule | compatibility notice shown; no result block rendered |
| R12 | Tablet layout | blocks render without truncation |

## Regression

Existing Story 5.x/6.x suites (save/resume/delete, unreadable delete, offline authorization, catalogue defaults, domain 6.6 suite, API calculations parity) pass unchanged.
