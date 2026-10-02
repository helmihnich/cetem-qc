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
  | (GraphieCalculationIdentity & { status: "calculated"; value: number })
  | (GraphieCalculationIdentity & { status: "unavailable"; reason: "missing-input" | "invalid-input" | "zero-denominator" | "unresolved-source-rule" })
  | { status: "unavailable"; reason: "unsupported-version"; context: CalculationContext };

const identity: GraphieCalculationIdentity = GRAPHIE_CALCULATION_IDENTITY;

function result(value: number): CalculationResult {
  return Number.isFinite(value)
    ? { ...identity, status: "calculated", value }
    : { ...identity, status: "unavailable", reason: "invalid-input" };
}

function unavailable<TReason extends "missing-input" | "invalid-input" | "zero-denominator" | "unresolved-source-rule">(
  reason: TReason,
): GraphieCalculationIdentity & { status: "unavailable"; reason: TReason } {
  return { ...identity, status: "unavailable", reason };
}

function values(inputs: readonly number[]): boolean {
  return inputs.every((value) => Number.isFinite(value));
}

function signedPercent(value: number, reference: number): CalculationResult {
  if (reference === 0) return unavailable("zero-denominator");
  return result(((value - reference) / reference) * 100);
}

const calculations = {
  voltageAccuracy(applied: number, measured: number): CalculationResult {
    if (!values([applied, measured])) return unavailable("invalid-input");
    if (applied === 0) return unavailable("zero-denominator");
    return result(((applied - measured) / applied) * 100);
  },
  repeatedVoltageMean(readings: readonly number[]): CalculationResult {
    if (readings.length !== 5) return unavailable("missing-input");
    if (!values(readings)) return unavailable("invalid-input");
    return result(readings.reduce((sum, reading) => sum + reading, 0) / 5);
  },
  repeatedVoltageDeviation(literalReference: number, mean: number): CalculationResult {
    if (!values([literalReference, mean])) return unavailable("invalid-input");
    return signedPercent(literalReference, mean);
  },
  outputReproducibility(input: { kerma: readonly number[]; mas: readonly number[] }): CalculationResult {
    if (input.kerma.length !== 3 || input.mas.length !== 3) return unavailable("missing-input");
    if (!values([...input.kerma, ...input.mas])) return unavailable("invalid-input");
    const normalized: number[] = [];
    for (let i = 0; i < 3; i++) {
      if (input.mas[i] === 0) return unavailable("zero-denominator");
      normalized.push(input.kerma[i] / input.mas[i]);
    }
    return result((normalized[0] + normalized[1] + normalized[2]) / 3);
  },
  outputReproducibilityDeviation(normalizedReading: number, normalizedMean: number): CalculationResult {
    if (!values([normalizedReading, normalizedMean])) return unavailable("invalid-input");
    return signedPercent(normalizedReading, normalizedMean);
  },
  // Source uses separate fixed-five means: raw Kerma (N25) and normalized Kerma/mAs (O25).
  outputRepeatabilityMeans(input: { kerma: readonly number[]; mas: readonly number[] }):
    | (GraphieCalculationIdentity & { status: "calculated"; value: { rawKermaMean: number; normalizedKermaPerMasMean: number } })
    | (GraphieCalculationIdentity & { status: "unavailable"; reason: "missing-input" | "invalid-input" | "zero-denominator" }) {
    if (input.kerma.length !== 5 || input.mas.length !== 5) return unavailable("missing-input");
    if (!values([...input.kerma, ...input.mas])) return unavailable("invalid-input");
    const normalized: number[] = [];
    for (let i = 0; i < 5; i++) {
      if (input.mas[i] === 0) return unavailable("zero-denominator");
      normalized.push(input.kerma[i] / input.mas[i]);
    }
    const rawKermaMean = input.kerma.reduce((sum, value) => sum + value, 0) / 5;
    const normalizedKermaPerMasMean = normalized.reduce((sum, value) => sum + value, 0) / 5;
    if (!Number.isFinite(rawKermaMean) || !Number.isFinite(normalizedKermaPerMasMean)) return unavailable("invalid-input");
    return { ...identity, status: "calculated", value: { rawKermaMean, normalizedKermaPerMasMean } };
  },
  outputRepeatabilityDeviation(rawKermaReading: number, rawKermaMean: number): CalculationResult {
    if (!values([rawKermaReading, rawKermaMean])) return unavailable("invalid-input");
    return signedPercent(rawKermaReading, rawKermaMean);
  },
  outputLinearity(input: { kerma: readonly number[]; mas: readonly number[] }): CalculationResult {
    if (input.kerma.length !== 3 || input.mas.length !== 3) return unavailable("missing-input");
    if (!values([...input.kerma, ...input.mas])) return unavailable("invalid-input");
    const normalized: number[] = [];
    for (let i = 0; i < 3; i++) {
      if (input.mas[i] === 0) return unavailable("zero-denominator");
      const corrected = i === 0 ? average([0.49 * input.kerma[i]]) : 0.49 * input.kerma[i];
      normalized.push(corrected / input.mas[i]);
    }
    return result((normalized[0] + normalized[1] + normalized[2]) / 3);
  },
  outputLinearityDeviation(normalizedReading: number, normalizedMean: number): CalculationResult {
    if (!values([normalizedReading, normalizedMean])) return unavailable("invalid-input");
    return signedPercent(normalizedReading, normalizedMean);
  },
  initialLinearity(_initialMean: number, _currentMean: number): CalculationResult {
    return unavailable("unresolved-source-rule");
  },
} as const;

type UnsupportedVersionResult = Extract<CalculationResult, { reason: "unsupported-version" }>;
type CalculationOutcome = CalculationResult
  | (GraphieCalculationIdentity & { status: "calculated"; value: { rawKermaMean: number; normalizedKermaPerMasMean: number } });

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
