import { GRAPHIE_CALCULATION_IDENTITY } from "./graphie-identity.js";
import type { GraphieCalculationIdentity } from "./graphie-identity.js";

export type SourceRegressionFixture = {
  category: "source-regression";
  source: { workbook: "CALCUL_graphie_01.xls"; sha256: string; sheet: "Feuil1"; cell: string; formula: string };
  inputs: Readonly<Record<string, number | null>>;
  expected: number | "#DIV/0!";
  note: string;
};

export const GRAPHIE_SOURCE_REGRESSION_PROVENANCE: GraphieCalculationIdentity = GRAPHIE_CALCULATION_IDENTITY;

const workbook = "CALCUL_graphie_01.xls" as const;
const sha256 = "C438DCB202ED71A6CD6FCD3E685FF48449EE1F2CAB788A6F8013798005AF49C4";
const fixture = (cell: string, formula: string, inputs: Record<string, number | null>, expected: number | "#DIV/0!", note: string): SourceRegressionFixture => ({
  category: "source-regression", source: { workbook, sha256, sheet: "Feuil1", cell, formula }, inputs, expected, note,
});

export const GRAPHIE_SOURCE_REGRESSION_FIXTURES: readonly SourceRegressionFixture[] = [
  fixture("D26", "=SUM(C20:C24)/5", { C20: 69.7, C21: 69.6, C22: 69.7, C23: 69.6, C24: 69.7 }, 69.66, "Five readings divided by the fixed divisor 5."),
  fixture("P14", "= (O14+O15+O16)/3", { K14: 40, N14: 1.308, O14: 0.0327, K15: 40, N15: 3.154, O15: 0.07885, K16: 40, N16: 3.128, O16: 0.0782 }, 0.06325000000000001, "Three normalized Kerma/mAs readings divided by 3; O=N/K for each reading."),
  fixture("N25", "=(L25+L26+L27+L28+L29)/5", { L25: 2.677, L26: 2.708, L27: 2.705, L28: 2.708, L29: 2.705 }, 2.7006, "Raw Kerma mean; the deviations use this raw mean."),
  fixture("O25", "=(M25+M26+M27+M28+M29)/5", { M25: 0.066925, M26: 0.06770000000000001, M27: 0.067625, M28: 0.06770000000000001, M29: 0.067625 }, 0.067515, "Mean of normalized Kerma/mAs values, distinct from raw Kerma N25."),
  fixture("O40", "=(N40+N41+N42)/3", { K40: 10, L40: 0.672, K41: 40, L41: 2.708, K42: 160, L42: 11 }, 0.03326283333333333, "N40 uses AVERAGE(0.49*L40); N41 and N42 use 0.49*L."),
  fixture("Q40", "=(O40-O42)/O42*100", { O40: 0.03326283333333333, O42: null }, "#DIV/0!", "O42 is blank in the extracted workbook; no baseline is invented."),
];
