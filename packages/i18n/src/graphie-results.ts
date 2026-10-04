import { GRAPHIE_CALCULATION_FIELD_IDS, isInvalidGraphieReading, parseGraphieReading } from "@cetem-qc/domain";
import type { GraphieCalculationResults, GraphieTolerance, GraphieValue, GraphieVerdict } from "@cetem-qc/domain";
import { fr } from "./fr.js";

const t = fr.graphieResults;

export type GraphieResultName = keyof GraphieCalculationResults;

/** The five paper tests in the order of the official form. */
export const GRAPHIE_RESULT_ORDER: readonly GraphieResultName[] = [
  "voltageAccuracy",
  "voltageRepeatability",
  "outputRepeatability",
  "outputLinearity",
  "lightFieldCorrespondence",
];

/** Display only: shortest round-trip number with a decimal comma. Never rounded. */
const formatNumber = (value: number) => String(value).replace(".", ",");

function formatValue(value: GraphieValue | undefined, unit: string): string {
  if (!value || value.status === "unavailable") return `${t.unavailable} — ${t.reasons[value?.reason ?? "missing-input"]}`;
  return `${formatNumber(value.value)} ${unit}`;
}

const rowLine = (label: string, value: GraphieValue | undefined) => `${label} — ${t.deviation} : ${formatValue(value, "%")}`;
const measurement = (index: number) => `${t.measurement} ${index + 1}`;

function verdictLines(verdict: GraphieVerdict): GraphieResultPresentation["verdict"] {
  if (verdict.status === "indisponible") {
    const reason = t.reasons[verdict.reason];
    return { status: verdict.status, text: `${t.verdictUnavailable} : ${reason}`, label: `${t.verdictLabelUnavailable} — ${reason}` };
  }
  return verdict.status === "conforme"
    ? { status: verdict.status, text: t.verdictConforme, label: t.verdictLabelConforme }
    : { status: verdict.status, text: t.verdictNonConforme, label: t.verdictLabelNonConforme };
}

function toleranceLine(tolerance: GraphieTolerance): string {
  return `${t.tolerance} : ${t.deviationSymbol} ${tolerance.comparison === "abs-lte" ? "≤" : "<"} ${formatNumber(tolerance.limitPercent)} %`;
}

export type GraphieResultPresentation = {
  heading: string;
  lines: string[];
  verdict: { status: GraphieVerdict["status"]; text: string; label: string };
  tolerance?: string;
  provenance: string;
};

/** Text for one test result, or nothing when the result is not computed for this identity. */
export function presentGraphieResult<TName extends GraphieResultName>(name: TName, result: GraphieCalculationResults[TName]): GraphieResultPresentation | undefined {
  if (!("formulaSource" in result) || !result.formulaSource) return undefined;
  let lines: string[];
  switch (result.test) {
    case "voltage-accuracy":
      lines = t.accuracyRows.map((row, index) => rowLine(row, result.values.deviationPercent[index]));
      break;
    case "voltage-repeatability":
      lines = [
        `${t.kvMean} : ${formatValue(result.values.mean, "kV")}`,
        `${t.kvMin} : ${formatValue(result.values.min, "kV")}`,
        `${t.kvMax} : ${formatValue(result.values.max, "kV")}`,
        `${t.minDeviation} : ${formatValue(result.values.minDeviationPercent, "%")}`,
        `${t.maxDeviation} : ${formatValue(result.values.maxDeviationPercent, "%")}`,
      ];
      break;
    case "output-repeatability":
      lines = [
        `${t.kermaMean} : ${formatValue(result.values.kermaMean, "mGy")}`,
        ...result.values.deviationPercent.map((value, index) => rowLine(measurement(index), value)),
      ];
      break;
    case "output-linearity":
      lines = [
        ...result.values.kermaAt1m.map((value, index) => `${measurement(index)} — ${t.kermaAt1m} : ${formatValue(value, "mGy")} · ${t.k1} : ${formatValue(result.values.k1[index], "mGy/mAs")}`),
        `${t.k2} : ${formatValue(result.values.k2, "mGy/mAs")}`,
        ...result.values.deviationPercent.map((value, index) => rowLine(measurement(index), value)),
      ];
      break;
    case "light-field":
      lines = [
        `${t.sumAbsGaps} : ${formatValue(result.values.sumAbsGapsMm, "mm")}`,
        `${t.lightFieldResult} : ${formatValue(result.values.resultPercent, `% ${t.ofDfr}`)}`,
      ];
      break;
  }
  const { paperForm, ruleId } = result.formulaSource;
  return {
    heading: t.tests[name],
    lines,
    verdict: verdictLines(result.suggestedVerdict),
    ...(result.suggestedVerdict.tolerance ? { tolerance: toleranceLine(result.suggestedVerdict.tolerance) } : {}),
    provenance: `${t.rule} ${ruleId} ${result.ruleVersion} — ${t.paperForm}, ${t.page} ${paperForm.page}, ${paperForm.section}`,
  };
}

/** One accepted reading: the field it comes from, its paper label and unit, and the stored string as shown. */
export type GraphieMeasuredReading = { fieldId: string; label: string; unit: string; text: string };

/** One measured-value line, e.g. « KV min — kV affiché : 50 kV · kV mesuré : 49,2 kV ». */
export type GraphieMeasurementPresentation = { readings: GraphieMeasuredReading[]; text: string };

/** The stored string as is: never trimmed, parsed into a display number, reformatted or rounded. */
function measuredText(raw: string | undefined, unit: string): string {
  if (parseGraphieReading(raw) === null) return t.notEntered;
  if (isInvalidGraphieReading(raw)) return `${raw} ${t.invalidValueSuffix}`;
  return `${raw} ${unit}`;
}

/** Measured-value lines of one test: its formula inputs only, in paper order. No other field is read. */
export function presentGraphieMeasurements(name: GraphieResultName, values: Readonly<Record<string, string>>): GraphieMeasurementPresentation[] {
  const reading = (fieldId: string, label: string, unit: string): GraphieMeasuredReading => ({
    fieldId,
    label,
    unit,
    text: measuredText(Object.prototype.hasOwnProperty.call(values, fieldId) ? values[fieldId] : undefined, unit),
  });
  const line = (prefix: string | undefined, readings: GraphieMeasuredReading[]): GraphieMeasurementPresentation => ({
    readings,
    text: `${prefix ? `${prefix} — ` : ""}${readings.map((item) => `${item.label} : ${item.text}`).join(" · ")}`,
  });
  const ids = GRAPHIE_CALCULATION_FIELD_IDS;
  switch (name) {
    case "voltageAccuracy":
      return ids.voltageAccuracy.rows.map((row, index) => line(t.accuracyRows[index], [
        reading(row.kvDisplayed, t.kvDisplayed, "kV"),
        reading(row.kvMeasured, t.kvMeasured, "kV"),
      ]));
    case "voltageRepeatability":
      return ids.voltageRepeatability.kvMeasured.map((id, index) => line(measurement(index), [reading(id, t.kvMeasured, "kV")]));
    case "outputRepeatability":
      return ids.outputRepeatability.kerma.map((id, index) => line(measurement(index), [reading(id, t.kerma, "mGy")]));
    case "outputLinearity":
      return [
        line(undefined, [reading(ids.outputLinearity.dfc, t.dfc, "m")]),
        ...ids.outputLinearity.rows.map((row, index) => line(measurement(index), [
          reading(row.mas, t.mas, "mAs"),
          reading(row.kerma, t.kermaDetector, "mGy"),
        ])),
      ];
    case "lightFieldCorrespondence":
      return [
        line(undefined, [reading(ids.lightFieldCorrespondence.dfr, t.dfr, "m")]),
        ...ids.lightFieldCorrespondence.gaps.map((id, index) => line(undefined, [reading(id, `${t.gap} ${index + 1}`, "mm")])),
      ];
  }
}
