import { StyleSheet, Text, View } from "react-native";
import { fr } from "@cetem-qc/i18n";
import { presentGraphieResult } from "@cetem-qc/i18n/graphie-results";
import type { GraphieCalculationName, GraphieCalculationResults } from "./graphie-calculation-service";
import type { EmployeeTaskLayout } from "./employee-task-layout";
import { colors, radii } from "./theme";

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
  const verdictStyle = status === "conforme" ? styles.verdictConforme : status === "non-conforme" ? styles.verdictNonConforme : styles.verdictNeutral;
  return <View accessibilityLabel={presentation.heading} style={status === "non-conforme" ? styles.blockNonConforme : styles.block}>
    <View style={styles.header}>
      <View style={status === "non-conforme" ? styles.markNonConforme : styles.mark} />
      <Text style={styles.heading}>{presentation.heading}</Text>
    </View>
    <View style={tablet ? styles.linesTablet : styles.linesPhone}>
      {presentation.lines.map((line, index) => <Text key={index} style={[styles.line, tablet && styles.lineTablet]}>{line}</Text>)}
    </View>
    <Text accessibilityLabel={presentation.verdict.label} style={verdictStyle}>{presentation.verdict.text}</Text>
    {presentation.tolerance ? <Text style={styles.tolerance}>{presentation.tolerance}</Text> : null}
    <View style={styles.footer}>
      <Text style={styles.meta}>{presentation.provenance}</Text>
      <Text style={styles.meta}>{t.responsableDecides}</Text>
    </View>
  </View>;
}

const block = { gap: 10, borderRadius: radii.md, padding: 16, borderWidth: 1 } as const;
const verdict = { alignSelf: "flex-start", overflow: "hidden", borderRadius: radii.sm, paddingVertical: 6, paddingHorizontal: 12, fontSize: 14, lineHeight: 20, fontWeight: "700" } as const;
const mark = { width: 4, height: 18, borderRadius: 2 } as const;

const styles = StyleSheet.create({
  block: { ...block, backgroundColor: "#F5F8FF", borderColor: "#D6E1FF" },
  blockNonConforme: { ...block, backgroundColor: "#FFF8F7", borderColor: "#F5C2BD" },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { ...mark, backgroundColor: colors.primary },
  markNonConforme: { ...mark, backgroundColor: colors.danger },
  heading: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  linesPhone: { gap: 6 },
  linesTablet: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6 },
  line: { color: colors.text, fontSize: 15, lineHeight: 21, fontVariant: ["tabular-nums"] },
  lineTablet: { flexBasis: "46%", flexGrow: 1 },
  verdictNeutral: { ...verdict, color: colors.neutral, backgroundColor: colors.neutralSoft },
  verdictConforme: { ...verdict, color: colors.success, backgroundColor: colors.successSoft },
  verdictNonConforme: { ...verdict, color: colors.danger, backgroundColor: colors.dangerSoft },
  tolerance: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  footer: { gap: 2, paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(15,23,42,0.08)" },
  meta: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
});
