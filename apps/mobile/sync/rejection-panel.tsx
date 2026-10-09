import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fr } from "@cetem-qc/i18n";
import { correctionLinkLine, rejectionCodeMessage, rejectionIssueLines, type IssueLine } from "./rejection-panel-text";
import type { CorrectionSummary, RejectionIssue, RejectionSummary } from "./task-sync-state";
import { colors, radii, toneColors } from "../theme";

export type CorrectionActionResult = "done" | "stale" | "failed";

/** The issue lines « section › champ : texte »; values are never shown. */
export function IssueLines(props: { lines: readonly IssueLine[] }) {
  return <View style={styles.issues}>
    {props.lines.map((line) => <Text key={`${line.labelFr}:${line.textFr}`} style={styles.issue}>{`${line.labelFr} : ${line.textFr}`}</Text>)}
  </View>;
}

/**
 * A submission the server did not accept (CAP-1/CAP-2): the code message, the stored issues, the preserved
 * refused attempt, the gated rules and, when the refusal qualifies, the explicit correction action. A
 * rejection is never a conflict: no conflict text or action appears here.
 */
export function RejectionPanel(props: { rejection: RejectionSummary; onCreateCorrection: () => Promise<CorrectionActionResult> }) {
  const { rejection } = props;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lines = rejectionIssueLines(rejection.issues);

  async function create() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const result = await props.onCreateCorrection().catch(() => "failed" as const);
    setBusy(false);
    // A stale panel re-renders from the refreshed outbox; only a real failure is reported.
    if (result === "failed") setFailed(true);
  }

  return <View style={styles.panel}>
    <View style={styles.titleRow}>
      <View style={styles.titleMark}><Text style={styles.titleMarkText}>!</Text></View>
      <Text accessibilityRole="alert" style={styles.title}>{rejectionCodeMessage(rejection.code)}</Text>
    </View>
    {lines.length ? <>
      <Text style={styles.label}>{fr.employeeTasks.rejectionIssues}</Text>
      <IssueLines lines={lines} />
    </> : null}
    <Text style={styles.muted}>{fr.employeeTasks.rejectionOriginalKept}</Text>
    <Text style={styles.muted}>{fr.employeeTasks.rulesGated}</Text>
    {failed ? <Text accessibilityRole="alert" style={styles.error}>{fr.employeeTasks.correctionFailed}</Text> : null}
    {rejection.canCorrect ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} onPress={() => void create()} disabled={busy}
      style={({ pressed }) => [styles.button, pressed && !busy && styles.buttonPressed, busy && styles.disabled]}>
      <Text style={styles.buttonText}>{fr.employeeTasks.createCorrection}</Text>
    </Pressable> : null}
  </View>;
}

/** The correction draft's link to the refused attempt, the gated rules and the form-level issues of that refusal (CAP-3/CAP-5). */
export function CorrectionDraftInfo(props: { correction: CorrectionSummary; issues: readonly RejectionIssue[] }) {
  const link = correctionLinkLine(props.correction.rejectedAt);
  const formLevel = rejectionIssueLines(props.issues).filter((line) => !line.fieldId);
  return <View style={styles.correction}>
    {link ? <Text accessibilityRole="summary" style={styles.correctionLink}>{link}</Text> : null}
    <Text style={styles.muted}>{fr.employeeTasks.rulesGated}</Text>
    {formLevel.length ? <IssueLines lines={formLevel} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 12, borderWidth: 1, borderColor: toneColors.danger.border, borderRadius: radii.md, padding: 16, backgroundColor: "#FFF8F7" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleMark: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.danger },
  titleMarkText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  title: { flex: 1, color: colors.danger, fontSize: 17, lineHeight: 23, fontWeight: "700" },
  muted: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  label: { color: colors.text, fontSize: 13, fontWeight: "700" },
  issues: { gap: 6 },
  issue: { color: colors.text, fontSize: 14, lineHeight: 20 },
  correction: { gap: 8, padding: 14, borderRadius: radii.sm + 2, backgroundColor: colors.infoSoft, borderWidth: 1, borderColor: toneColors.info.border },
  correctionLink: { color: colors.info, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  button: { minHeight: 52, justifyContent: "center", alignItems: "center", borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: 18 },
  buttonPressed: { backgroundColor: colors.primaryPressed },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.5 },
});
