import { graphieCalculations } from "./graphie-calculations.js";
import type { CalculationContext } from "./graphie-identity.js";
import type {
  LightFieldCorrespondenceInput,
  OutputLinearityInput,
  OutputRepeatabilityInput,
  Reading,
  VoltageAccuracyInput,
  VoltageRepeatabilityInput,
} from "./graphie-calculations.js";

/**
 * Input syntax (not a CETEM rule): optional sign, digits, optional decimal part with a comma or a point.
 * No exponent, no grouping, no trailing or leading separator.
 */
const NUMBER_SYNTAX = /^[+-]?\d+(?:[.,]\d+)?$/;

/** A raw form string as a domain reading: blank is missing (`null`), unparseable is invalid (`NaN`). */
export function parseGraphieReading(raw: string | undefined): Reading {
  const value = raw?.trim() ?? "";
  if (value === "") return null;
  if (!NUMBER_SYNTAX.test(value)) return Number.NaN;
  return Number(value.replace(",", "."));
}

/** True only for a non-blank raw string that does not follow the number syntax. */
export function isInvalidGraphieReading(raw: string | undefined): boolean {
  const reading = parseGraphieReading(raw);
  return reading !== null && !Number.isFinite(reading);
}

const rowIds = <TColumn extends string>(prefix: string, count: number, columns: readonly TColumn[]) =>
  Array.from({ length: count }, (_, index) =>
    Object.fromEntries(columns.map((column) => [column, `${prefix}.row${index + 1}.${column}`])) as { readonly [TKey in TColumn]: string });

/** Story 5.6 field IDs read by each paper test, per the Story 6.6 source field mapping. Every other field is never read. */
export const GRAPHIE_CALCULATION_FIELD_IDS = {
  voltageAccuracy: { rows: rowIds("voltage.accuracy", 3, ["kvDisplayed", "kvMeasured"] as const) },
  voltageRepeatability: { kvMeasured: rowIds("voltage.repeatability", 5, ["kvMeasured"] as const).map((row) => row.kvMeasured) },
  outputRepeatability: { kerma: rowIds("voltage.repeatability", 5, ["kerma"] as const).map((row) => row.kerma) },
  outputLinearity: { dfc: "output.linearity.dfc", rows: rowIds("output.linearity", 3, ["mas", "kerma"] as const) },
  lightFieldCorrespondence: { dfr: "lightField.dfr", gaps: [1, 2, 3, 4].map((index) => `lightField.gap${index}`) },
} as const;

/** Every field ID in `GRAPHIE_CALCULATION_FIELD_IDS`, in mapping order. */
export const GRAPHIE_CALCULATION_FIELD_ID_LIST: readonly string[] = (() => {
  const ids = GRAPHIE_CALCULATION_FIELD_IDS;
  return [
    ...ids.voltageAccuracy.rows.flatMap((row) => [row.kvDisplayed, row.kvMeasured]),
    ...ids.voltageRepeatability.kvMeasured,
    ...ids.outputRepeatability.kerma,
    ids.outputLinearity.dfc,
    ...ids.outputLinearity.rows.flatMap((row) => [row.mas, row.kerma]),
    ids.lightFieldCorrespondence.dfr,
    ...ids.lightFieldCorrespondence.gaps,
  ];
})();

export type GraphieTestInputs = {
  voltageAccuracy: VoltageAccuracyInput;
  voltageRepeatability: VoltageRepeatabilityInput;
  outputRepeatability: OutputRepeatabilityInput;
  outputLinearity: OutputLinearityInput;
  lightFieldCorrespondence: LightFieldCorrespondenceInput;
};

/** Maps raw form values to the five paper-test inputs. The values are only read, never changed. */
export function graphieTestInputsFromValues(values: Readonly<Record<string, string>>): GraphieTestInputs {
  const ids = GRAPHIE_CALCULATION_FIELD_IDS;
  const read = (id: string) => parseGraphieReading(Object.prototype.hasOwnProperty.call(values, id) ? values[id] : undefined);
  return {
    voltageAccuracy: { rows: ids.voltageAccuracy.rows.map((row) => ({ kvDisplayed: read(row.kvDisplayed), kvMeasured: read(row.kvMeasured) })) },
    voltageRepeatability: { kvMeasured: ids.voltageRepeatability.kvMeasured.map(read) },
    outputRepeatability: { kerma: ids.outputRepeatability.kerma.map(read) },
    outputLinearity: {
      dfcMeters: read(ids.outputLinearity.dfc),
      rows: ids.outputLinearity.rows.map((row) => ({ mas: read(row.mas), kermaDetector: read(row.kerma) })),
    },
    lightFieldCorrespondence: { dfrMeters: read(ids.lightFieldCorrespondence.dfr), gapsMm: ids.lightFieldCorrespondence.gaps.map(read) },
  };
}

export type GraphieCalculationResults = {
  readonly [TName in keyof typeof graphieCalculations]: ReturnType<(typeof graphieCalculations)[TName]>;
};

/**
 * All five paper-test results for one identity and raw form values. The values are mapped once and only read.
 * An unsupported identity gives five `unsupported-version` results.
 */
export function calculateGraphieResults(context: CalculationContext, values: Readonly<Record<string, string>>): GraphieCalculationResults {
  const inputs = graphieTestInputsFromValues(values);
  return {
    voltageAccuracy: graphieCalculations.voltageAccuracy(context, inputs.voltageAccuracy),
    voltageRepeatability: graphieCalculations.voltageRepeatability(context, inputs.voltageRepeatability),
    outputRepeatability: graphieCalculations.outputRepeatability(context, inputs.outputRepeatability),
    outputLinearity: graphieCalculations.outputLinearity(context, inputs.outputLinearity),
    lightFieldCorrespondence: graphieCalculations.lightFieldCorrespondence(context, inputs.lightFieldCorrespondence),
  };
}
