# Calculation functions (rule `cetem-paper-form` 2.0.0)

These functions are exported as `graphieCalculations.<name>(context, input)` from `packages/domain`, each wrapped by the existing `withContext` version guard. All other functions are deleted (see SPEC CAP-9).

## Shared types

```ts
type Reading = number | null;            // null = missing; non-finite = invalid
type UnavailableReason = "missing-input" | "invalid-input" | "zero-denominator";

type GraphieValue =
  | { status: "calculated"; value: number }          // full precision
  | { status: "unavailable"; reason: UnavailableReason };

type GraphieTolerance = {
  comparison: "abs-lte" | "abs-lt";      // |x| ≤ limit  |  |x| < limit
  limitPercent: number;
};

type GraphieVerdict =
  | { status: "conforme" | "non-conforme"; tolerance: GraphieTolerance }
  | { status: "indisponible"; reason: UnavailableReason | "no-tolerance"; tolerance?: GraphieTolerance };

type GraphieFormulaSource = {
  ruleId: "cetem-paper-form";
  paperForm: { document: "Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie"; page: 2 | 3 | 4; section: string; photo: string };
  workbookExample?: { workbook: "CALCUL_graphie_01.xls"; workbookSha256: "C438DCB2…49C4"; sheet: "Feuil1"; cells: readonly string[] };
};

type GraphieTestResult<TValues> = GraphieCalculationIdentity & {
  test: "voltage-accuracy" | "voltage-repeatability" | "output-repeatability" | "output-linearity" | "light-field";
  formulaSource: GraphieFormulaSource;
  values: TValues;
  suggestedVerdict: GraphieVerdict;
};
// The unsupported-version result is unchanged: { status: "unavailable"; reason: "unsupported-version"; context }.
```

Verdict rule, shared by all tests:

1. If the test has no tolerance, return `indisponible` / `no-tolerance`.
2. If any compared value is unavailable, return `indisponible` with the reason of the first unavailable value in row order.
3. If any value breaks the tolerance under the 1e-9 noise rule in [tolerances.md](tolerances.md) (`abs-lte`: `Math.abs(x) - limit <= 1e-9`; `abs-lt`: `limit - Math.abs(x) > 1e-9`), return `non-conforme`.
4. Otherwise return `conforme`.

Values are never rounded.

## Functions

| Function | Input | `values` returned | Compared values → tolerance |
|---|---|---|---|
| `voltageAccuracy` | `{ rows: [3 × { kvDisplayed: Reading; kvMeasured: Reading }] }` (KV min, KV, KV max) | `deviationPercent: GraphieValue[3]`, each = (kvMeasured − kvDisplayed) / kvDisplayed × 100. Rows are independent. kvDisplayed = 0 → `zero-denominator`. | 3 deviations → `abs-lte` 10 |
| `voltageRepeatability` | `{ kvMeasured: Reading[5] }` | `mean`, `min`, `max` (MIN/MAX of the 5), `minDeviationPercent` = (min − mean)/mean × 100, `maxDeviationPercent` = (max − mean)/mean × 100. Any reading missing or invalid makes all 5 values unavailable. mean = 0 → deviations `zero-denominator`. | minDeviation, maxDeviation → `abs-lte` 5 |
| `outputRepeatability` | `{ kerma: Reading[5] }` | `kermaMean`, `deviationPercent: GraphieValue[5]`, each = (kerma − kermaMean)/kermaMean × 100. Any reading missing makes all values unavailable. | 5 deviations → `abs-lt` 10 |
| `outputLinearity` | `{ dfcMeters: Reading; rows: [3 × { mas: Reading; kermaDetector: Reading }] }` | `kermaAt1m[3]` = kermaDetector × (dfcMeters / 1)², `k1[3]` = kermaAt1m / mas, `k2` = mean of k1, `deviationPercent[3]` = (k1 − k2)/k2 × 100. kermaAt1m and k1 are per row; k2 and the deviations need all 3 k1. mas = 0 or k2 = 0 → `zero-denominator`. | 3 deviations → `abs-lt` 15 |
| `lightFieldCorrespondence` | `{ dfrMeters: Reading; gapsMm: Reading[4] }` | `sumAbsGapsMm` = Σ|gap|, `resultPercent` = sumAbsGapsMm / (dfrMeters × 1000) × 100. dfrMeters = 0 → `zero-denominator`. | none → always `indisponible` / `no-tolerance` |

The arithmetic order is as written: average with `(a+b+…)/n`, then `(x − ref) / ref * 100`. The workbook regression values depend on it (e.g. K2 at DFC 0.70 is bit-exact only with `kerma * (dfc/1)**2 / mas`).

## Source field mapping (consumed by Story 6.3, informational here)

| Function input | Story 5.6 field IDs |
|---|---|
| `voltageAccuracy.rows[i]` | `voltage.accuracy.row{1..3}.kvDisplayed`, `.kvMeasured` |
| `voltageRepeatability.kvMeasured` | `voltage.repeatability.row{1..5}.kvMeasured` |
| `outputRepeatability.kerma` | `voltage.repeatability.row{1..5}.kerma` |
| `outputLinearity` | `output.linearity.dfc`, `output.linearity.row{1..3}.mas`, `.kerma` |
| `lightFieldCorrespondence` | `lightField.dfr`, `lightField.gap{1..4}` |

These fields feed no formula: `voltage.repeatability.mas`, `voltage.repeatability.maMaxHalf`, `voltage.repeatability.rowN.kvDisplayed`, `output.linearity.maMaxHalf`, `output.linearity.rowN.kvDisplayed`, `lightField.kv` and `lightField.mas`.

## Provenance per test

| Test | Paper page / section / photo | `workbookExample.cells` |
|---|---|---|
| voltage-accuracy | p2 « Exactitude de la tension » / `8fe5a363-…(1).jpg` | — (the workbook sign is opposite) |
| voltage-repeatability | p2 « Répétabilité » / `8fe5a363-…(1).jpg` | C20:C24, D26, B26, C26, D20, E20 |
| output-repeatability | p3 « Reproductibilité et répétabilité » / `f9657912-…(1).jpg` | L25:L29, N25, P25:P29 |
| output-linearity | p3 « Linéarité » / `f9657912-…(1).jpg` | K40:K42, L40:L42, M40:M42, N40:N42, O40, P40:P42 |
| light-field | p4 « Géométrie du faisceau — correspondance champ lumineux / champ de rayons X » / `c2805aec-…(1).jpg` | — |
