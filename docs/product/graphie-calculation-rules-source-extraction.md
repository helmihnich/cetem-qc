# Graphie Calculation Rules — CETEM BH Source Extraction

Source: [CALCUL_graphie_01.xls](CALCUL_graphie_01.xls) was supplied by CETEM BH and is the source workbook from which this derived specification was extracted. This Markdown specification does not imply CETEM BH review or approval of the extraction and does not supply missing business rules. The original workbook remains unchanged.

Source SHA-256: `C438DCB202ED71A6CD6FCD3E685FF48449EE1F2CAB788A6F8013798005AF49C4`.

The workbook was opened read-only in Excel with macros disabled. `Feuil1` contains the populated cells; `Feuil2` through `Feuil5` are empty. No worksheet shapes, comments, conditional formatting or workbook names were found. The [cell extraction](../../_bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/source-analysis/calcul-graphie-01-cells.json) preserves every populated cell's formula or literal, Excel value, displayed text and number format. The companion [formula inventory](../../_bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/source-analysis/calcul-graphie-01-formulas.md) preserves each formula separately. Excel's English formula representation is used; the source workbook remains unchanged.

## Calculation relationships

All addresses below refer to `Feuil1`. In patterns, `r` means each row in the stated range. Patterns describe the relationships; the inventory retains the exact formulas, including spaces and function wrappers.

| Area | Source cells and calculation relationship | Limits of the evidence |
|---|---|---|
| Exactitude de la tension | Rows 13–15: D = KVa, E = KVm; F = `((D-E)/D)*100`. | Signed deviation relative to applied voltage; do not replace with absolute deviation. |
| Repeated kV measurements | C20:C24 are five KVm readings. D26 = `SUM(C20:C24)/5`. D20 = `SUM((B26-D26)/D26)*100`; E20 = `((C26-D26)/D26)*100`. | B26 (`KVm_min`) and C26 (`KVm_max`) are literals 69.6 and 69.7, not MIN/MAX formulas. Their automatic derivation is not established. `KVm_max` does not settle the missing equipment/protocol kVmax rule. |
| Reproductibilité du rayonnement de sortie | Rows 14–16: K = mAs, N = Kerma, O = `N/K`. P14 = `(O14+O15+O16)/3`. Qr = `((Or-P14)/P14)*100`. | The deviations use normalized Kerma/mAs. L = mA and M = Temps are literals; no formula derives mAs from them. |
| Répétabilité du rayonnement de sortie | Rows 25–29: K = mAs, L = Kerma, M = `L/K`. N25 = `(L25+L26+L27+L28+L29)/5`; O25 = `(M25+M26+M27+M28+M29)/5`. Pr = `((Lr-N25)/N25)*100`. | These deviations use raw Kerma and its mean, not the normalized mean O25. Preserve this distinction. |
| Linéarité du rayonnement de sortie | Rows 40–42: K = mAs, L = Kerma(dét). M40 = `AVERAGE(0.49*L40)`; M41 = `0.49*L41`; M42 = `0.49*L42`. N = M/K. O40 = `(N40+N41+N42)/3`. Pr = `((Nr-O40)/O40)*100`. | Preserve the explicit 0.49 factor and the AVERAGE wrapper. Its physical derivation and applicability to other measurement setups are not specified; do not replace it with an inferred distance formula. J44 labels Kerma in mGy. |
| Linearity relative to initial mean | Q40 = `(O40-O42)/O42*100`; O41 labels O42 as `(Kerma(1m)/mAs)moy_ini`. | O42 is blank; Q40 displays `#DIV/0!`. The initial mean's source and missing/zero handling require clarification. Do not invent an initial value or silently convert this error to zero, N.A. or a passing result. |

The fixed divisors (3 or 5), referenced readings, denominators and signed percentages are part of the source formulas. Do not substitute a variable-count mean, absolute percentage, coefficient of variation or other calculation. The number of populated example readings alone does not establish mandatory/optional application fields or incomplete-input behavior.

## Evidence and unresolved rules

The supplied example produces D26 = 69.66, P14 approximately 0.06325, N25 = 2.7006, O25 = 0.067515 and O40 approximately 0.0332628333333333. These are traceability examples, not a complete approved acceptance dataset. The extraction's Q40 numeric `value` is Excel's COM error representation; its `text` is `#DIV/0!`, not a numerical measurement.

| Rule | Status and implementation boundary |
|---|---|
| Formula relationships above | Explicitly defined formulas authorize automatic numerical calculations only, with stated input dependencies. Preserve source-cell traceability. |
| Acceptance/tolerance thresholds and inclusive/exclusive boundaries | No explicit rule found. Individual tolerance/pass-fail results require both the applicable formula and an explicitly established CETEM BH acceptance threshold, boundary semantics and comparison rule. This workbook alone does not authorize those results. |
| Rounding | Formats include General, 0.00, 0.0000 and a custom three-decimal format. Preserve these as evidence of display, not a complete rounding, precision or decision-comparison policy. No ROUND formula appears. |
| N.A., blank, invalid and zero-denominator handling | No approved application policy specified. Excel arithmetic/error behavior is evidence, not authorization to choose application behavior. |
| Mandatory/optional fields | Not explicitly specified. Labels and example values do not establish required-field validation. |
| kVmax and K2 | No explicit rule resolving the outstanding requirements. Do not rename a workbook quantity K2 or infer kVmax from sample settings or KVm_max. |
| Initial linearity baseline | O42 is empty; its provenance and required handling remain unresolved. |
| Other tests and deterministic insights | No additional formula, tolerance or insight rule may be inferred from these calculations. |
| Overall automatic assessment | No rule supplied; automatic overall machine conformity remains excluded even when individual rules are later completed. |

Explicitly defined formulas authorize automatic numerical calculations only. Individual tolerance/pass-fail results require both the applicable formula and an explicitly established CETEM BH acceptance threshold, boundary semantics and comparison rule. A defined numerical formula alone does not authorize a tolerance verdict. CETEM BH must resolve the missing rules and supply the remaining reference cases before affected behavior is accepted.

Final machine conformity is always an explicit human decision by the **Responsable**. Do not aggregate calculations, individual results or insights into an automatic overall conformity decision.
