import { StyleSheet, Text, View } from "react-native";
import { fr } from "@cetem-qc/i18n";
import { presentGraphieResult } from "@cetem-qc/i18n/graphie-results";
import type { GraphieCalculationName, GraphieCalculationResults } from "./graphie-calculation-service";
import type { EmployeeTaskLayout } from "./employee-task-layout";

export { presentGraphieResult } from "@cetem-qc/i18n/graphie-results";
export type { GraphieResultPresentation } from "@cetem-qc/i18n/graphie-results";

const t = fr.graphieResults;

/** Form sections that show results, with their blocks in paper order. */
export const GRAPHIE_RESULT_BLOCKS_BY_SECTION: { readonly [sectionId: string]: readonly GraphieCalculationName[] } = {
  voltageAccuracy: ["voltageAccuracy"],
  repeatability: ["voltageRepeatability", "outputRepeatability"],
  linearity: ["outputLinearity"],
  lightField: ["lightFieldCorrespondence"],
};

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
