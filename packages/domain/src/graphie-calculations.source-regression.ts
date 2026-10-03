import { GRAPHIE_CALCULATION_IDENTITY } from "./graphie-identity.js";
import type { GraphieCalculationIdentity } from "./graphie-identity.js";
import type { GraphieTestName } from "./graphie-calculations.js";

/**
 * Workbook regression example re-read under the paper-form rule (`cetem-paper-form` 2.0.0).
 * These are traceability checks, not CETEM-approved acceptance fixtures.
 */
export type SourceRegressionFixture = {
  category: "source-regression";
  /** The paper-form test whose function reproduces this workbook cell. */
  test: GraphieTestName;
  source: { workbook: "CALCUL_graphie_01.xls"; sha256: string; sheet: "Feuil1"; cell: string; formula: string };
  inputs: Readonly<Record<string, number | null>>;
  /** Expected value under the paper rule, at full precision. */
  expected: number;
  /** `exact`: bit-exact equality; `approx`: |actual − expected| ≤ 1e-9 (the workbook value comes from Excel's fixed-factor arithmetic). */
  match: "exact" | "approx";
  note: string;
  /** Present wherever the paper form changes how the workbook cell is read. */
  paperRule?: string;
};

export const GRAPHIE_SOURCE_REGRESSION_PROVENANCE: GraphieCalculationIdentity = GRAPHIE_CALCULATION_IDENTITY;

const workbook = "CALCUL_graphie_01.xls" as const;
const sha256 = "C438DCB202ED71A6CD6FCD3E685FF48449EE1F2CAB788A6F8013798005AF49C4";
const fixture = (
  test: GraphieTestName,
  cell: string,
  formula: string,
  inputs: Record<string, number | null>,
  expected: number,
  note: string,
  extra: { match?: "exact" | "approx"; paperRule?: string } = {},
): SourceRegressionFixture => ({
  category: "source-regression",
  test,
  source: { workbook, sha256, sheet: "Feuil1", cell, formula },
  inputs,
  expected,
  match: extra.match ?? "exact",
  note,
  ...(extra.paperRule ? { paperRule: extra.paperRule } : {}),
});

const accuracySign = "Paper: (KV mesuré − KV affiché) / KV affiché × 100. The workbook computes (D − E) / D × 100, so the expected value is the workbook value negated.";
const repeatedKv = { C20: 69.7, C21: 69.6, C22: 69.7, C23: 69.6, C24: 69.7 };
const repeatedKerma = { L25: 2.677, L26: 2.708, L27: 2.705, L28: 2.708, L29: 2.705 };
const linearity = { DFC: 0.7, K40: 10, L40: 0.672, K41: 40, L41: 2.708, K42: 160, L42: 11 };
const linearityRule = "Paper: Kerma(1m) = Kerma(dét) × (DFC / 1 m)², K1 = Kerma(1m) / mAs, K2 = mean of K1. DFC = 0.70 m reproduces the workbook's fixed M-column factor, which equals (0.70 m / 1 m)².";

export const GRAPHIE_SOURCE_REGRESSION_FIXTURES: readonly SourceRegressionFixture[] = [
  fixture("voltage-accuracy", "F13", "=((D13-E13)/D13)*100", { D13: 50, E13: 49.2 }, -1.5999999999999945, "Workbook F13 = 1.5999999999999945.", { paperRule: accuracySign }),
  fixture("voltage-accuracy", "F14", "=((D14-E14)/D14)*100", { D14: 70, E14: 69.6 }, -0.5714285714285796, "Workbook F14 = 0.5714285714285796.", { paperRule: accuracySign }),
  fixture("voltage-accuracy", "F15", "=((D15-E15)/D15)*100", { D15: 120, E15: 119.8 }, -0.16666666666666904, "Workbook F15 = 0.16666666666666904.", { paperRule: accuracySign }),
  fixture("voltage-repeatability", "D26", "=SUM(C20:C24)/5", repeatedKv, 69.66, "KV moy: five readings divided by 5."),
  fixture("voltage-repeatability", "B26", "(literal 69.6)", repeatedKv, 69.6, "KVm_min is a literal in the workbook.", { paperRule: "Paper: KV min is the minimum of the 5 KV mesuré readings, computed, never a literal." }),
  fixture("voltage-repeatability", "C26", "(literal 69.7)", repeatedKv, 69.7, "KVm_max is a literal in the workbook.", { paperRule: "Paper: KV max is the maximum of the 5 KV mesuré readings, computed, never a literal." }),
  fixture("voltage-repeatability", "D20", "=SUM((B26-D26)/D26)*100", repeatedKv, -0.08613264427218242, "(KV min − KV moy) / KV moy × 100.", { paperRule: "Paper: KV min comes from MIN of the readings instead of the B26 literal." }),
  fixture("voltage-repeatability", "E20", "= ((C26 - D26)/D26)*100", repeatedKv, 0.057421762848128416, "(KV max − KV moy) / KV moy × 100.", { paperRule: "Paper: KV max comes from MAX of the readings instead of the C26 literal." }),
  fixture("output-repeatability", "N25", "=(L25+L26+L27+L28+L29)/5", repeatedKerma, 2.7006, "Kerma moy: raw Kerma mean; the deviations use this raw mean."),
  fixture("output-repeatability", "P25", "=((L25-N25)/N25)*100", repeatedKerma, -0.8738798785455107, "Row 1 deviation from Kerma moy."),
  fixture("output-repeatability", "P26", "=((L26-N25)/N25)*100", repeatedKerma, 0.27401318225579774, "Row 2 deviation from Kerma moy."),
  fixture("output-repeatability", "P27", "= ((L27-N25)/N25)*100", repeatedKerma, 0.1629267570169577, "Row 3 deviation from Kerma moy."),
  fixture("output-repeatability", "P28", "= ((L28-N25)/N25)*100", repeatedKerma, 0.27401318225579774, "Row 4 deviation from Kerma moy."),
  fixture("output-repeatability", "P29", "=((L29-N25)/N25)*100", repeatedKerma, 0.1629267570169577, "Row 5 deviation from Kerma moy."),
  fixture("output-linearity", "O40", "= (N40+N41+N42)/3", linearity, 0.03326283333333333, "K2: mean of the 3 K1 values; bit-exact in JS with DFC = 0.70 m.", { paperRule: linearityRule }),
  fixture("output-linearity", "P40", "= ((N40-O40)/O40)*100", linearity, -1.006629020378098, "Row 1 deviation from K2.", { match: "approx", paperRule: linearityRule }),
  fixture("output-linearity", "P41", "= ((N41-O40)/O40)*100", linearity, -0.2700712005892382, "Row 2 deviation from K2.", { match: "approx", paperRule: linearityRule }),
  fixture("output-linearity", "P42", "= ((N42-O40)/O40)*100", linearity, 1.2767002209673364, "Row 3 deviation from K2.", { match: "approx", paperRule: linearityRule }),
];
