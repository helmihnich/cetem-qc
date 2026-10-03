import {
  GRAPHIE_CALCULATION_IDENTITY,
  GRAPHIE_CALCULATION_RULE_ID,
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

/** A numeric reading: `null` means missing, a non-finite number means invalid. */
export type Reading = number | null;

export type UnavailableReason = "missing-input" | "invalid-input" | "zero-denominator";

/** A calculated value at full precision (never rounded), or the reason it is unavailable. */
export type GraphieValue =
  | { status: "calculated"; value: number }
  | { status: "unavailable"; reason: UnavailableReason };

export type GraphieTolerance = {
  /** `abs-lte`: |x| ≤ limit; `abs-lt`: |x| < limit. */
  comparison: "abs-lte" | "abs-lt";
  limitPercent: number;
};

/** A suggested per-test verdict. The Responsable decides the final conclusion. */
export type GraphieVerdict =
  | { status: "conforme" | "non-conforme"; tolerance: GraphieTolerance }
  | { status: "indisponible"; reason: UnavailableReason | "no-tolerance"; tolerance?: GraphieTolerance };

export type GraphieTestName =
  | "voltage-accuracy"
  | "voltage-repeatability"
  | "output-repeatability"
  | "output-linearity"
  | "light-field";

export const GRAPHIE_PAPER_FORM_DOCUMENT = "Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie" as const;
const WORKBOOK = "CALCUL_graphie_01.xls" as const;
const WORKBOOK_SHA256 = "C438DCB202ED71A6CD6FCD3E685FF48449EE1F2CAB788A6F8013798005AF49C4" as const;

export type GraphieFormulaSource = {
  ruleId: typeof GRAPHIE_CALCULATION_RULE_ID;
  paperForm: { document: typeof GRAPHIE_PAPER_FORM_DOCUMENT; page: 2 | 3 | 4; section: string; photo: string };
  workbookExample?: { workbook: typeof WORKBOOK; workbookSha256: typeof WORKBOOK_SHA256; sheet: "Feuil1"; cells: readonly string[] };
};

export type GraphieTestResult<TTest extends GraphieTestName, TValues> = GraphieCalculationIdentity & {
  test: TTest;
  formulaSource: GraphieFormulaSource;
  values: TValues;
  suggestedVerdict: GraphieVerdict;
};

export type UnsupportedVersionResult = {
  status: "unavailable";
  reason: "unsupported-version";
  context: CalculationContext;
  formulaSource?: never;
};

export type VoltageAccuracyInput = { rows: readonly { kvDisplayed: Reading; kvMeasured: Reading }[] };
export type VoltageAccuracyValues = { deviationPercent: GraphieValue[] };

export type VoltageRepeatabilityInput = { kvMeasured: readonly Reading[] };
export type VoltageRepeatabilityValues = {
  mean: GraphieValue;
  min: GraphieValue;
  max: GraphieValue;
  minDeviationPercent: GraphieValue;
  maxDeviationPercent: GraphieValue;
};

export type OutputRepeatabilityInput = { kerma: readonly Reading[] };
export type OutputRepeatabilityValues = { kermaMean: GraphieValue; deviationPercent: GraphieValue[] };

export type OutputLinearityInput = { dfcMeters: Reading; rows: readonly { mas: Reading; kermaDetector: Reading }[] };
export type OutputLinearityValues = {
  kermaAt1m: GraphieValue[];
  k1: GraphieValue[];
  k2: GraphieValue;
  deviationPercent: GraphieValue[];
};

export type LightFieldCorrespondenceInput = { dfrMeters: Reading; gapsMm: readonly Reading[] };
export type LightFieldCorrespondenceValues = { sumAbsGapsMm: GraphieValue; resultPercent: GraphieValue };

export type VoltageAccuracyResult = GraphieTestResult<"voltage-accuracy", VoltageAccuracyValues>;
export type VoltageRepeatabilityResult = GraphieTestResult<"voltage-repeatability", VoltageRepeatabilityValues>;
export type OutputRepeatabilityResult = GraphieTestResult<"output-repeatability", OutputRepeatabilityValues>;
export type OutputLinearityResult = GraphieTestResult<"output-linearity", OutputLinearityValues>;
export type LightFieldCorrespondenceResult = GraphieTestResult<"light-field", LightFieldCorrespondenceValues>;

export type GraphieCalculationResult =
  | VoltageAccuracyResult
  | VoltageRepeatabilityResult
  | OutputRepeatabilityResult
  | OutputLinearityResult
  | LightFieldCorrespondenceResult
  | UnsupportedVersionResult;

/** Tolerances printed on the signed paper form. Light field has no printed tolerance (open question for CETEM). */
export const GRAPHIE_TOLERANCES: {
  readonly [TTest in GraphieTestName]: Readonly<GraphieTolerance> | null;
} = Object.freeze({
  "voltage-accuracy": Object.freeze({ comparison: "abs-lte", limitPercent: 10 }),
  "voltage-repeatability": Object.freeze({ comparison: "abs-lte", limitPercent: 5 }),
  "output-repeatability": Object.freeze({ comparison: "abs-lt", limitPercent: 10 }),
  "output-linearity": Object.freeze({ comparison: "abs-lt", limitPercent: 15 }),
  "light-field": null,
});

/** Absorbs floating-point noise only (percentage points). It never widens a tolerance and values are never rounded. */
export const TOLERANCE_EPSILON = 1e-9;

/** Whether a signed percentage is within tolerance. The expression forms are part of the contract. */
export function isWithinTolerance(x: number, tolerance: GraphieTolerance): boolean {
  const limit = tolerance.limitPercent;
  if (tolerance.comparison === "abs-lte") return Math.abs(x) - limit <= TOLERANCE_EPSILON;
  return limit - Math.abs(x) > TOLERANCE_EPSILON;
}

/**
 * Suggested verdict for the compared values, in row order:
 * no tolerance → indisponible/no-tolerance; any unavailable value → indisponible with the first reason;
 * any value outside the tolerance → non-conforme; otherwise conforme.
 */
export function judgeTolerance(values: readonly GraphieValue[], tolerance: GraphieTolerance | null): GraphieVerdict {
  if (tolerance === null) return { status: "indisponible", reason: "no-tolerance" };
  const applied: GraphieTolerance = { comparison: tolerance.comparison, limitPercent: tolerance.limitPercent };
  for (const value of values) {
    if (value.status === "unavailable") return { status: "indisponible", reason: value.reason, tolerance: applied };
  }
  for (const value of values) {
    if (value.status === "calculated" && !isWithinTolerance(value.value, applied)) return { status: "non-conforme", tolerance: applied };
  }
  return { status: "conforme", tolerance: applied };
}

const PHOTO_DIRECTORY = "docs/product/source/formulaire-cetem/";
const PHOTO_PAGE_2 = `${PHOTO_DIRECTORY}8fe5a363-a465-46e3-85b6-8930e4cd0383(1).jpg`;
const PHOTO_PAGE_3 = `${PHOTO_DIRECTORY}f9657912-e6db-4487-99d8-3d30155d7263(1).jpg`;
const PHOTO_PAGE_4 = `${PHOTO_DIRECTORY}c2805aec-41dd-4ef9-8cfc-4b1ce7b511ce(1).jpg`;

const PROVENANCE: { readonly [TTest in GraphieTestName]: { page: 2 | 3 | 4; section: string; photo: string; cells?: readonly string[] } } = {
  "voltage-accuracy": { page: 2, section: "Exactitude de la tension", photo: PHOTO_PAGE_2 },
  "voltage-repeatability": { page: 2, section: "Répétabilité", photo: PHOTO_PAGE_2, cells: ["C20:C24", "D26", "B26", "C26", "D20", "E20"] },
  "output-repeatability": { page: 3, section: "Reproductibilité et répétabilité", photo: PHOTO_PAGE_3, cells: ["L25:L29", "N25", "P25:P29"] },
  "output-linearity": { page: 3, section: "Linéarité", photo: PHOTO_PAGE_3, cells: ["K40:K42", "L40:L42", "M40:M42", "N40:N42", "O40", "P40:P42"] },
  "light-field": { page: 4, section: "Géométrie du faisceau — correspondance champ lumineux / champ de rayons X", photo: PHOTO_PAGE_4 },
};

function source(test: GraphieTestName): GraphieFormulaSource {
  const { page, section, photo, cells } = PROVENANCE[test];
  return {
    ruleId: GRAPHIE_CALCULATION_RULE_ID,
    paperForm: { document: GRAPHIE_PAPER_FORM_DOCUMENT, page, section, photo },
    ...(cells ? { workbookExample: { workbook: WORKBOOK, workbookSha256: WORKBOOK_SHA256, sheet: "Feuil1" as const, cells: [...cells] } } : {}),
  };
}

const identity: GraphieCalculationIdentity = GRAPHIE_CALCULATION_IDENTITY;

function testResult<TTest extends GraphieTestName, TValues>(
  test: TTest,
  values: TValues,
  compared: readonly GraphieValue[],
): GraphieTestResult<TTest, TValues> {
  return { ...identity, test, formulaSource: source(test), values, suggestedVerdict: judgeTolerance(compared, GRAPHIE_TOLERANCES[test]) };
}

const unavailable = (reason: UnavailableReason): GraphieValue => ({ status: "unavailable", reason });

/** Overflow guard: a non-finite result is reported as invalid input, never as Infinity or NaN. */
function calculated(value: number): GraphieValue {
  return Number.isFinite(value) ? { status: "calculated", value } : unavailable("invalid-input");
}

function read(reading: Reading | undefined): GraphieValue {
  if (reading === null || reading === undefined) return unavailable("missing-input");
  if (typeof reading !== "number" || !Number.isFinite(reading)) return unavailable("invalid-input");
  return { status: "calculated", value: reading };
}

/** The first unavailable value in order, if any. */
function firstUnavailable(values: readonly GraphieValue[]): GraphieValue | undefined {
  return values.find((value) => value.status === "unavailable");
}

/** Reads a fixed-length list; a wrong length or any unusable reading makes the whole list unusable. */
function readAll(readings: readonly Reading[] | undefined, length: number): number[] | GraphieValue {
  if (!Array.isArray(readings) || readings.length !== length) return unavailable("missing-input");
  const values = Array.from(readings, read);
  const blocked = firstUnavailable(values);
  if (blocked) return blocked;
  return values.map((value) => (value as { value: number }).value);
}

/** Signed deviation (value − reference) / reference × 100. */
function deviation(value: GraphieValue, reference: GraphieValue): GraphieValue {
  if (value.status === "unavailable") return { ...value };
  if (reference.status === "unavailable") return { ...reference };
  if (reference.value === 0) return unavailable("zero-denominator");
  return calculated(((value.value - reference.value) / reference.value) * 100);
}

const filled = (length: number, value: GraphieValue): GraphieValue[] => Array.from({ length }, () => ({ ...value }));

const calculations = {
  voltageAccuracy(input: VoltageAccuracyInput): VoltageAccuracyResult {
    const rows = input?.rows;
    const deviationPercent = !Array.isArray(rows) || rows.length !== 3
      ? filled(3, unavailable("missing-input"))
      : Array.from(rows, (row) => deviation(read(row?.kvMeasured), read(row?.kvDisplayed)));
    return testResult("voltage-accuracy", { deviationPercent }, deviationPercent);
  },
  voltageRepeatability(input: VoltageRepeatabilityInput): VoltageRepeatabilityResult {
    const readings = readAll(input?.kvMeasured, 5);
    if (!Array.isArray(readings)) {
      const values = { mean: { ...readings }, min: { ...readings }, max: { ...readings }, minDeviationPercent: { ...readings }, maxDeviationPercent: { ...readings } };
      return testResult("voltage-repeatability", values, [values.minDeviationPercent, values.maxDeviationPercent]);
    }
    const mean = calculated((readings[0]! + readings[1]! + readings[2]! + readings[3]! + readings[4]!) / 5);
    const min = calculated(Math.min(...readings));
    const max = calculated(Math.max(...readings));
    const minDeviationPercent = deviation(min, mean);
    const maxDeviationPercent = deviation(max, mean);
    return testResult("voltage-repeatability", { mean, min, max, minDeviationPercent, maxDeviationPercent }, [minDeviationPercent, maxDeviationPercent]);
  },
  outputRepeatability(input: OutputRepeatabilityInput): OutputRepeatabilityResult {
    const readings = readAll(input?.kerma, 5);
    if (!Array.isArray(readings)) {
      const values = { kermaMean: { ...readings }, deviationPercent: filled(5, readings) };
      return testResult("output-repeatability", values, values.deviationPercent);
    }
    const kermaMean = calculated((readings[0]! + readings[1]! + readings[2]! + readings[3]! + readings[4]!) / 5);
    const deviationPercent = readings.map((kerma) => deviation(calculated(kerma), kermaMean));
    return testResult("output-repeatability", { kermaMean, deviationPercent }, deviationPercent);
  },
  outputLinearity(input: OutputLinearityInput): OutputLinearityResult {
    const rows = input?.rows;
    if (!Array.isArray(rows) || rows.length !== 3) {
      const missing = unavailable("missing-input");
      const values = { kermaAt1m: filled(3, missing), k1: filled(3, missing), k2: { ...missing }, deviationPercent: filled(3, missing) };
      return testResult("output-linearity", values, values.deviationPercent);
    }
    const dfc = read(input.dfcMeters);
    const kermaAt1m = Array.from(rows, (row): GraphieValue => {
      const kerma = read(row?.kermaDetector);
      const blocked = firstUnavailable([kerma, dfc]);
      if (blocked) return { ...blocked };
      return calculated((kerma as { value: number }).value * ((dfc as { value: number }).value / 1) ** 2);
    });
    const k1 = Array.from(rows, (row, index): GraphieValue => {
      const corrected = kermaAt1m[index]!;
      const mas = read(row?.mas);
      const blocked = firstUnavailable([corrected, mas]);
      if (blocked) return { ...blocked };
      const masValue = (mas as { value: number }).value;
      if (masValue === 0) return unavailable("zero-denominator");
      return calculated((corrected as { value: number }).value / masValue);
    });
    const blockedK1 = firstUnavailable(k1);
    const k2 = blockedK1
      ? { ...blockedK1 }
      : calculated(((k1[0] as { value: number }).value + (k1[1] as { value: number }).value + (k1[2] as { value: number }).value) / 3);
    const deviationPercent = k1.map((value) => (k2.status === "unavailable" ? { ...k2 } : deviation(value, k2)));
    return testResult("output-linearity", { kermaAt1m, k1, k2, deviationPercent }, deviationPercent);
  },
  lightFieldCorrespondence(input: LightFieldCorrespondenceInput): LightFieldCorrespondenceResult {
    const gaps = readAll(input?.gapsMm, 4);
    const sumAbsGapsMm = Array.isArray(gaps)
      ? calculated(Math.abs(gaps[0]!) + Math.abs(gaps[1]!) + Math.abs(gaps[2]!) + Math.abs(gaps[3]!))
      : { ...gaps };
    const dfr = read(input?.dfrMeters);
    let resultPercent: GraphieValue;
    if (sumAbsGapsMm.status === "unavailable") resultPercent = { ...sumAbsGapsMm };
    else if (dfr.status === "unavailable") resultPercent = { ...dfr };
    else if (dfr.value === 0) resultPercent = unavailable("zero-denominator");
    else resultPercent = calculated((sumAbsGapsMm.value / (dfr.value * 1000)) * 100);
    return testResult("light-field", { sumAbsGapsMm, resultPercent }, [resultPercent]);
  },
} as const;

function withContext<TArgs extends unknown[], TResult>(
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

/** The 5 paper-form tests. There is deliberately no overall conformity. */
export const graphieCalculations = {
  voltageAccuracy: withContext(calculations.voltageAccuracy),
  voltageRepeatability: withContext(calculations.voltageRepeatability),
  outputRepeatability: withContext(calculations.outputRepeatability),
  outputLinearity: withContext(calculations.outputLinearity),
  lightFieldCorrespondence: withContext(calculations.lightFieldCorrespondence),
} as const;
