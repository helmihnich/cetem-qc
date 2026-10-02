import {
  GRAPHIE_CALCULATION_IDENTITY,
  type CalculationContext,
  type GraphieCalculationIdentity,
} from "./graphie-identity.js";

export {
  GRAPHIE_CALCULATION_CATALOGUE,
  GRAPHIE_CALCULATION_IDENTITY,
  GRAPHIE_CALCULATION_RULE_ID,
  GRAPHIE_CALCULATION_RULE_VERSION,
} from "./graphie-identity.js";
export type { CalculationContext, GraphieCalculationIdentity } from "./graphie-identity.js";

export type CalculationResult =
  | (GraphieCalculationIdentity & { formulaSource: GraphieFormulaSource; status: "calculated"; value: number })
  | (GraphieCalculationIdentity & { formulaSource: GraphieFormulaSource; status: "unavailable"; reason: "missing-input" | "invalid-input" | "zero-denominator" | "unresolved-source-rule" })
  | { status: "unavailable"; reason: "unsupported-version"; context: CalculationContext; formulaSource?: never };

export type GraphieFormulaSource = {
  ruleId: typeof GRAPHIE_CALCULATION_IDENTITY.ruleId;
  workbook: "CALCUL_graphie_01.xls";
  workbookSha256: "C438DCB202ED71A6CD6FCD3E685FF48449EE1F2CAB788A6F8013798005AF49C4";
  sheet: "Feuil1";
  family: "voltage-accuracy" | "voltage-mean" | "voltage-deviation" | "output-reproducibility" | "output-repeatability" | "output-linearity" | "initial-linearity";
  sourceCells: readonly string[];
};

const source = (family: GraphieFormulaSource["family"], ...sourceCells: string[]): GraphieFormulaSource => ({
  ruleId: GRAPHIE_CALCULATION_IDENTITY.ruleId,
  workbook: "CALCUL_graphie_01.xls",
  workbookSha256: "C438DCB202ED71A6CD6FCD3E685FF48449EE1F2CAB788A6F8013798005AF49C4",
  sheet: "Feuil1",
  family,
  sourceCells,
});

const identity: GraphieCalculationIdentity = GRAPHIE_CALCULATION_IDENTITY;

function result(value: number, formulaSource: GraphieFormulaSource): CalculationResult {
  return Number.isFinite(value)
    ? { ...identity, formulaSource, status: "calculated", value }
    : { ...identity, formulaSource, status: "unavailable", reason: "invalid-input" };
}

function unavailable<TReason extends "missing-input" | "invalid-input" | "zero-denominator" | "unresolved-source-rule">(
  reason: TReason,
  formulaSource: GraphieFormulaSource,
): GraphieCalculationIdentity & { formulaSource: GraphieFormulaSource; status: "unavailable"; reason: TReason } {
  return { ...identity, formulaSource, status: "unavailable", reason };
}

function values(inputs: readonly number[]): boolean {
  return inputs.every((value) => Number.isFinite(value));
}

function signedPercent(value: number, reference: number, formulaSource: GraphieFormulaSource): CalculationResult {
  if (reference === 0) return unavailable("zero-denominator", formulaSource);
  return result(((value - reference) / reference) * 100, formulaSource);
}

const calculations = {
  voltageAccuracy(applied: number, measured: number): CalculationResult {
    const provenance = source("voltage-accuracy", "F13", "F14", "F15");
    if (!values([applied, measured])) return unavailable("invalid-input", provenance);
    if (applied === 0) return unavailable("zero-denominator", provenance);
    return result(((applied - measured) / applied) * 100, provenance);
  },
  repeatedVoltageMean(readings: readonly number[]): CalculationResult {
    const provenance = source("voltage-mean", "D26");
    if (readings.length !== 5) return unavailable("missing-input", provenance);
    if (!values(readings)) return unavailable("invalid-input", provenance);
    return result(readings.reduce((sum, reading) => sum + reading, 0) / 5, provenance);
  },
  repeatedVoltageDeviation(literalReference: number, mean: number): CalculationResult {
    const provenance = source("voltage-deviation", "D20", "E20");
    if (!values([literalReference, mean])) return unavailable("invalid-input", provenance);
    return signedPercent(literalReference, mean, provenance);
  },
  outputReproducibility(input: { kerma: readonly number[]; mas: readonly number[] }): CalculationResult {
    const provenance = source("output-reproducibility", "P14");
    if (input.kerma.length !== 3 || input.mas.length !== 3) return unavailable("missing-input", provenance);
    if (!values([...input.kerma, ...input.mas])) return unavailable("invalid-input", provenance);
    const normalized: number[] = [];
    for (let i = 0; i < 3; i++) {
      if (input.mas[i] === 0) return unavailable("zero-denominator", provenance);
      normalized.push(input.kerma[i] / input.mas[i]);
    }
    return result((normalized[0] + normalized[1] + normalized[2]) / 3, provenance);
  },
  outputReproducibilityDeviation(normalizedReading: number, normalizedMean: number): CalculationResult {
    const provenance = source("output-reproducibility", "Q14");
    if (!values([normalizedReading, normalizedMean])) return unavailable("invalid-input", provenance);
    return signedPercent(normalizedReading, normalizedMean, provenance);
  },
  // Source uses separate fixed-five means: raw Kerma (N25) and normalized Kerma/mAs (O25).
  outputRepeatabilityMeans(input: { kerma: readonly number[]; mas: readonly number[] }):
    | (GraphieCalculationIdentity & { formulaSource: GraphieFormulaSource; status: "calculated"; value: { rawKermaMean: number; normalizedKermaPerMasMean: number } })
    | (GraphieCalculationIdentity & { formulaSource: GraphieFormulaSource; status: "unavailable"; reason: "missing-input" | "invalid-input" | "zero-denominator" }) {
    const provenance = source("output-repeatability", "N25", "O25");
    if (input.kerma.length !== 5 || input.mas.length !== 5) return unavailable("missing-input", provenance);
    if (!values([...input.kerma, ...input.mas])) return unavailable("invalid-input", provenance);
    const normalized: number[] = [];
    for (let i = 0; i < 5; i++) {
      if (input.mas[i] === 0) return unavailable("zero-denominator", provenance);
      normalized.push(input.kerma[i] / input.mas[i]);
    }
    const rawKermaMean = input.kerma.reduce((sum, value) => sum + value, 0) / 5;
    const normalizedKermaPerMasMean = normalized.reduce((sum, value) => sum + value, 0) / 5;
    if (!Number.isFinite(rawKermaMean) || !Number.isFinite(normalizedKermaPerMasMean)) return unavailable("invalid-input", provenance);
    return { ...identity, formulaSource: provenance, status: "calculated", value: { rawKermaMean, normalizedKermaPerMasMean } };
  },
  outputRepeatabilityDeviation(rawKermaReading: number, rawKermaMean: number): CalculationResult {
    const provenance = source("output-repeatability", "P25");
    if (!values([rawKermaReading, rawKermaMean])) return unavailable("invalid-input", provenance);
    return signedPercent(rawKermaReading, rawKermaMean, provenance);
  },
  outputLinearity(input: { kerma: readonly number[]; mas: readonly number[] }): CalculationResult {
    const provenance = source("output-linearity", "O40");
    if (input.kerma.length !== 3 || input.mas.length !== 3) return unavailable("missing-input", provenance);
    if (!values([...input.kerma, ...input.mas])) return unavailable("invalid-input", provenance);
    const normalized: number[] = [];
    for (let i = 0; i < 3; i++) {
      if (input.mas[i] === 0) return unavailable("zero-denominator", provenance);
      const corrected = i === 0 ? average([0.49 * input.kerma[i]]) : 0.49 * input.kerma[i];
      normalized.push(corrected / input.mas[i]);
    }
    return result((normalized[0] + normalized[1] + normalized[2]) / 3, provenance);
  },
  outputLinearityDeviation(normalizedReading: number, normalizedMean: number): CalculationResult {
    const provenance = source("output-linearity", "P40");
    if (!values([normalizedReading, normalizedMean])) return unavailable("invalid-input", provenance);
    return signedPercent(normalizedReading, normalizedMean, provenance);
  },
  initialLinearity(_initialMean: number, _currentMean: number): CalculationResult {
    return unavailable("unresolved-source-rule", source("initial-linearity", "Q40"));
  },
} as const;

type UnsupportedVersionResult = Extract<CalculationResult, { reason: "unsupported-version" }>;
type CalculationOutcome = CalculationResult
  | (GraphieCalculationIdentity & { formulaSource: GraphieFormulaSource; status: "calculated"; value: { rawKermaMean: number; normalizedKermaPerMasMean: number } });

function withContext<TArgs extends unknown[], TResult extends CalculationOutcome>(
  calculate: (...args: TArgs) => TResult,
): (context: CalculationContext, ...args: TArgs) => TResult | UnsupportedVersionResult {
  return (context, ...args) => {
    if (context.catalogueId !== identity.catalogueId
      || context.catalogueVersion !== identity.catalogueVersion
      || context.schemaVersion !== identity.schemaVersion
      || context.ruleId !== identity.ruleId
      || context.ruleVersion !== identity.ruleVersion) {
      return { status: "unavailable", reason: "unsupported-version", context };
    }
    return calculate(...args);
  };
}

export const graphieCalculations = {
  voltageAccuracy: withContext(calculations.voltageAccuracy),
  repeatedVoltageMean: withContext(calculations.repeatedVoltageMean),
  repeatedVoltageDeviation: withContext(calculations.repeatedVoltageDeviation),
  outputReproducibility: withContext(calculations.outputReproducibility),
  outputReproducibilityDeviation: withContext(calculations.outputReproducibilityDeviation),
  outputRepeatabilityMeans: withContext(calculations.outputRepeatabilityMeans),
  outputRepeatabilityDeviation: withContext(calculations.outputRepeatabilityDeviation),
  outputLinearity: withContext(calculations.outputLinearity),
  outputLinearityDeviation: withContext(calculations.outputLinearityDeviation),
  initialLinearity: withContext(calculations.initialLinearity),
} as const;

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
