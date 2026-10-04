# Shared calculation and presentation code

Two pieces that Story 6.3 left in `apps/mobile` move to shared packages, so the web review and the mobile form use one implementation. Mobile output must not change: every existing mobile test passes unchanged.

## `packages/domain` — all five results for one value map

| Item | From | To |
|---|---|---|
| `GraphieCalculationResults` (type) | `apps/mobile/graphie-calculation-service.ts` | `packages/domain/src/graphie-inputs.ts` (or a sibling file), exported from the index |
| `calculateGraphieResults(context: CalculationContext, values: Readonly<Record<string, string>>)` | same | same |

- Behaviour is identical to the 6.3 mobile function: map once with `graphieTestInputsFromValues`, then call each of the five `graphieCalculations` with the given context. An unsupported identity gives five `unsupported-version` results.
- The mobile service keeps its exported names (`calculateGraphieResults`, `GraphieCalculationResults`) and delegates to the domain, so `App.tsx` and the 6.3 tests are untouched.
- Epic 7.3 will call the same function on the server when it records the accepted calculation snapshot. 6.4 does not add that call.

## `packages/i18n` — French text model

New module `packages/i18n/src/graphie-results.ts`, exported as `@cetem-qc/i18n/graphie-results`. `@cetem-qc/i18n` gains a dependency on `@cetem-qc/domain` (pure package; allowed by the boundaries check).

| Export | Origin | Notes |
|---|---|---|
| `GRAPHIE_RESULT_ORDER` | new | The five calculation names in paper order: voltageAccuracy, voltageRepeatability, outputRepeatability, outputLinearity, lightFieldCorrespondence. |
| `GraphieResultPresentation`, `presentGraphieResult(name, result)` | moved from `apps/mobile/graphie-test-result.tsx` | Same signature and same strings; returns `undefined` when the result has no `formulaSource`. Includes `formatNumber` (shortest round-trip, decimal comma, never rounded). |
| `GraphieMeasurementPresentation`, `presentGraphieMeasurements(name, values)` | new | Measured-value lines for the web review (below). |

`apps/mobile/graphie-test-result.tsx` imports the presenter and re-exports `presentGraphieResult` (the 6.3 render test imports it from there). `GRAPHIE_RESULT_BLOCKS_BY_SECTION` and the React Native block stay in mobile.

## `presentGraphieMeasurements(name, values)`

It returns one line per formula input of that test, in paper order. Field IDs come from `GRAPHIE_CALCULATION_FIELD_IDS` (domain); no other field is read. The raw stored string is shown as is: never trimmed, parsed, reformatted or rounded.

| Test | Lines (label : value unit) |
|---|---|
| voltageAccuracy | per row KV min / KV / KV max: « <row> — kV affiché : … kV · kV mesuré : … kV » |
| voltageRepeatability | « Mesure n — kV mesuré : … kV », n = 1…5 |
| outputRepeatability | « Mesure n — Kerma : … mGy », n = 1…5 |
| outputLinearity | « DFC (distance foyer–chambre) : … m », then « Mesure n — mAs : … mAs · Kerma (dét) : … mGy », n = 1…3 |
| lightFieldCorrespondence | « D.F.R (distance foyer–récepteur) : … m », then « Écart n : … mm », n = 1…4 |

Labels and units are the Story 5.6 catalogue labels and units for those fields; a mobile catalogue test checks they match (see test-plan.md).

| Stored value | Shown |
|---|---|
| absent, `""` or whitespace only | « Non renseigné » (no unit) |
| parses (`parseGraphieReading` finite) | the raw string + unit, e.g. `49,2 kV` |
| does not parse (`isInvalidGraphieReading`) | the raw string + « (valeur numérique invalide) », no unit |

New strings go into `fr.graphieResults` (e.g. `notEntered`, `measuredValues`, the column labels and the DFC / D.F.R labels).
