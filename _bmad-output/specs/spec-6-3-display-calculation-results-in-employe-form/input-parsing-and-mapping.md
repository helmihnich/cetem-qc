# Input parsing and field mapping (`packages/domain`)

Both are pure functions in `packages/domain`, exported from its index next to `graphieCalculations`, so mobile now and the API later (Epic 7, Story 6.4) use the same code. Suggested file: `packages/domain/src/graphie-inputs.ts`.

## `parseGraphieReading(raw: string | undefined): Reading`

| Raw value (after `trim()`) | Result |
|---|---|
| `undefined`, `""` | `null` → domain `missing-input` |
| matches `^[+-]?\d+(?:[.,]\d+)?$` | `Number(value.replace(",", "."))` |
| anything else (`abc`, `1e3`, `1 000`, `1.000,5`, `N.A`, `5,`, `,5`, `1,2,3`, `Infinity`) | `Number.NaN` → domain `invalid-input` |

- Comma and point are both decimal separators: French users write a comma and `decimal-pad` keyboards emit either, depending on device locale.
- Leading zeros are allowed (`"007"` → 7). `"-0"` gives `-0`, which the domain treats like `0`.
- Negative values are accepted (6.6 confirmed decision). Range checks are a non-goal.
- The function never trims, rewrites or stores anything back. The caller keeps the raw string.
- `isInvalidGraphieReading(raw)` (or the equivalent) is true only for the last row of the table. The mobile field hint uses it, so the UI does not repeat the regex.

## `graphieTestInputsFromValues(values: Readonly<Record<string, string>>)`

It returns the five domain inputs, using exactly the 6.6 source field mapping:

| Domain input | Field IDs (Story 5.6) |
|---|---|
| `voltageAccuracy.rows[i]` | `voltage.accuracy.row{1..3}.kvDisplayed`, `.kvMeasured` |
| `voltageRepeatability.kvMeasured[5]` | `voltage.repeatability.row{1..5}.kvMeasured` |
| `outputRepeatability.kerma[5]` | `voltage.repeatability.row{1..5}.kerma` |
| `outputLinearity.dfcMeters` / `.rows[i]` | `output.linearity.dfc` / `output.linearity.row{1..3}.mas`, `.kerma` (→ `kermaDetector`) |
| `lightFieldCorrespondence.dfrMeters` / `.gapsMm[4]` | `lightField.dfr` / `lightField.gap{1..4}` |

These fields are never read: `voltage.repeatability.mas`, `voltage.repeatability.maMaxHalf`, `voltage.repeatability.rowN.kvDisplayed`, `output.linearity.maMaxHalf`, `output.linearity.rowN.kvDisplayed`, `lightField.kv`, `lightField.mas`.

Field IDs come from one constant table in this file. A domain test checks that every ID in it exists in the mobile catalogue (`graphie-pov-catalogue.test.ts`, because the domain must not import the app) and has type `number`.

## Mobile wiring

`apps/mobile/graphie-calculation-service.ts` gains one function, e.g. `calculateGraphieResults(identity, values)`. It calls the mapping once and then calls each of the five `graphieCalculations` through the existing identity-forwarding path. It returns the five results keyed by test name. It contains no parsing, arithmetic or comparison of its own.
