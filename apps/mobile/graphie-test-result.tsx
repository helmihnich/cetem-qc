import { StyleSheet, Text, View } from "react-native";
import { fr } from "@cetem-qc/i18n";
import type { GraphieTolerance, GraphieValue, GraphieVerdict } from "@cetem-qc/domain";
import type { GraphieCalculationName, GraphieCalculationResults } from "./graphie-calculation-service";
import type { EmployeeTaskLayout } from "./employee-task-layout";

const t = fr.graphieResults;

/** Form sections that show results, with their blocks in paper order. */
export const GRAPHIE_RESULT_BLOCKS_BY_SECTION: { readonly [sectionId: string]: readonly GraphieCalculationName[] } = {
  voltageAccuracy: ["voltageAccuracy"],
  repeatability: ["voltageRepeatability", "outputRepeatability"],
  linearity: ["outputLinearity"],
  lightField: ["lightFieldCorrespondence"],
};

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
export function presentGraphieResult<TName extends GraphieCalculationName>(name: TName, result: GraphieCalculationResults[TName]): GraphieResultPresentation | undefined {
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

/** Read-only result block: calculated values, suggested verdict, tolerance and provenance for one paper test. */
export function GraphieTestResultBlock<TName extends GraphieCalculationName>(props: { name: TName; result: GraphieCalculationResults[TName]; layout: EmployeeTaskLayout }) {
  const presentation = presentGraphieResult(props.name, props.result);
  if (!presentation) return null;
  const tablet = props.layout === "tablet";
  const status = presentation.verdict.status;
  return <View accessibilityLabel={presentation.heading} style={styles.block}>
    <Text style={styles.heading}>{presentation.heading}</Text>
    <View style={tablet ? styles.linesTablet : styles.linesPhone}>
      {presentation.lines.map((line, index) => <Text key={index} style={[styles.line, tablet && styles.lineTablet]}>{line}</Text>)}
    </View>
    <Text accessibilityLabel={presentation.verdict.label} style={[styles.verdict, status === "conforme" && styles.conforme, status === "non-conforme" && styles.nonConforme]}>{presentation.verdict.text}</Text>
    {presentation.tolerance ? <Text style={styles.line}>{presentation.tolerance}</Text> : null}
    <Text style={styles.meta}>{presentation.provenance}</Text>
    <Text style={styles.meta}>{t.responsableDecides}</Text>
  </View>;
}

const styles = StyleSheet.create({
  block: { gap: 6, borderWidth: 1, borderColor: "#c7d5d0", borderLeftWidth: 4, borderLeftColor: "#135c4c", borderRadius: 12, padding: 12, backgroundColor: "#f1f6f3" },
  heading: { color: "#17352c", fontSize: 16, fontWeight: "700" },
  linesPhone: { gap: 4 },
  linesTablet: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 },
  line: { color: "#17352c", fontSize: 15, lineHeight: 21 },
  lineTablet: { flexBasis: "46%", flexGrow: 1 },
  verdict: { color: "#17352c", fontSize: 15, fontWeight: "700", lineHeight: 21 },
  conforme: { color: "#135c4c" },
  nonConforme: { color: "#a32424" },
  meta: { color: "#5b6e65", fontSize: 13, lineHeight: 18 },
});
