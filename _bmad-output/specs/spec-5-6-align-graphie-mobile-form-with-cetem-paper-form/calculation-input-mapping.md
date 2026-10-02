# Calculation input mapping (for Story 6.3 — not implemented in 5.6)

This table records which captured fields will later feed which `graphieCalculations` function. Story 5.6 adds no calculation code. String parsing stays with Story 6.3 / DEP-01R. Rows marked **Deferred to rule-set v2** go to a separate calculation-rule story that must land before 6.3.

| Domain function (workbook cells) | Operands | Source field IDs | Status |
|---|---|---|---|
| `voltageAccuracy(applied, measured)` (F13–F15) | applied, measured, per row | `voltage.accuracy.rowN.kvDisplayed`, `voltage.accuracy.rowN.kvMeasured`, N = 1…3 | Mapped |
| `repeatedVoltageMean(readings[5])` (D26) | 5 kV readings | `voltage.repeatability.row1…5.kvMeasured` | Mapped |
| `repeatedVoltageDeviation(literalReference, mean)` (D20, E20) | reference, mean | mean from the row above; reference = workbook literals KVm_min/KVm_max (69.6/69.7) | **Deferred to rule-set v2.** Not captured as a field. |
| `outputRepeatabilityMeans({kerma[5], mas[5]})` (N25, O25) | 5 Kerma, 5 mAs | `voltage.repeatability.row1…5.kerma`; mAs = `voltage.repeatability.mas` | **Deferred to rule-set v2.** The paper records mAs once (confirmed). |
| `outputRepeatabilityDeviation(reading, mean)` (P25) | raw Kerma, raw mean | `voltage.repeatability.rowN.kerma` + mean above | Mapped |
| `outputReproducibility({kerma[3], mas[3]})` (P14) | 3 Kerma, 3 mAs (workbook rows 14–16, mAs per row) | Paper reuses `voltage.repeatability.row1…5.kerma` with one `voltage.repeatability.mas` | **Deferred to rule-set v2.** The domain takes 3 readings; the form gives 5. |
| `outputReproducibilityDeviation(reading, mean)` (Q14) | normalized reading, mean | depends on the row above | Deferred with the row above |
| `outputLinearity({kerma[3], mas[3]})` (O40) | 3 Kerma (dét), 3 mAs | `output.linearity.row1…3.kerma`, `output.linearity.row1…3.mas` | Mapped. The fixed 0.49 factor stays; `output.linearity.dfc` is captured but not consumed. Do not infer 0.49 = DFC². |
| `outputLinearityDeviation(reading, mean)` (P40) | normalized reading, mean | derived from linearity rows | Mapped |
| `initialLinearity` (Q40) | initial mean (blank O42) | none | Unresolved source rule (unchanged) |

Fields with no formula: `header.*`, `equipment.*`, `instruments.*`, `visual.*`, `mechanical.*`, `voltage.repeatability.rowN.kvDisplayed`, `voltage.repeatability.maMaxHalf`, `output.linearity.maMaxHalf`, `output.linearity.dfc`, `output.linearity.rowN.kvDisplayed`, `lightField.*` and all comment fields.

## Paper evidence for the rule-set v2 story (recorded, not acted on)

- **Répétabilité de la tension (page 2):** the paper shows KV mesuré min, max and moy as cells derived from the 5 readings. The workbook instead uses the literals 69.6/69.7 (B26/C26).
- **Reproductibilité et répétabilité (page 3):** the table draws 5 rows of KV 70, an mAs column with a cell per row, a merged mA max/2 cell, Kerma and (Kerma − Kerma moy)/Kerma moy. Story 5.6 captures mAs once, as confirmed.
- **Linéarité (page 3):** the N.B. gives Kerma (1m) = Kerma (dét)·(DFC/1m)². The domain applies a fixed 0.49 factor. K1 = Kerma(1m)/mAs, K2 = mean of K1, and the deviation is (K1 − K2)/K2.
- **Géométrie (page 4):** the paper computes Σ|écarts| and Σ|écarts|/D.F.R (%). No domain function exists for this.
- **Tolérances printed on paper:** ±10 % (exactitude), ±5 % (répétabilité tension), ±10 % (reproductibilité/répétabilité), ±15 % (linéarité). These are recorded only as candidate tolerances for later rule approval; 5.6 does not use them.
