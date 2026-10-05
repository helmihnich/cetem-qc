import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fr } from "@cetem-qc/i18n";
import { correctionLinkLine, rejectionCodeMessage, rejectionIssueLines, type IssueLine } from "./rejection-panel-text";
import type { CorrectionSummary, RejectionIssue, RejectionSummary } from "./task-sync-state";

export type CorrectionActionResult = "done" | "stale" | "failed";

/** The issue lines « section › champ : texte »; values are never shown. */
export function IssueLines(props: { lines: readonly IssueLine[] }) {
  return <View style={{ gap: 4 }}>
    {props.lines.map((line) => <Text key={`${line.labelFr}:${line.textFr}`} style={styles.muted}>{`${line.labelFr} : ${line.textFr}`}</Text>)}
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
    <Text accessibilityRole="alert" style={styles.title}>{rejectionCodeMessage(rejection.code)}</Text>
    {lines.length ? <>
      <Text style={styles.label}>{fr.employeeTasks.rejectionIssues}</Text>
      <IssueLines lines={lines} />
    </> : null}
    <Text style={styles.muted}>{fr.employeeTasks.rejectionOriginalKept}</Text>
    <Text style={styles.muted}>{fr.employeeTasks.rulesGated}</Text>
    {failed ? <Text accessibilityRole="alert" style={styles.error}>{fr.employeeTasks.correctionFailed}</Text> : null}
    {rejection.canCorrect ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} onPress={() => void create()} disabled={busy}
      style={[styles.button, busy && styles.disabled]}>
      <Text style={styles.buttonText}>{fr.employeeTasks.createCorrection}</Text>
    </Pressable> : null}
  </View>;
}

/** The correction draft's link to the refused attempt, the gated rules and the form-level issues of that refusal (CAP-3/CAP-5). */
export function CorrectionDraftInfo(props: { correction: CorrectionSummary; issues: readonly RejectionIssue[] }) {
  const link = correctionLinkLine(props.correction.rejectedAt);
  const formLevel = rejectionIssueLines(props.issues).filter((line) => !line.fieldId);
  return <View style={{ gap: 6 }}>
    {link ? <Text accessibilityRole="summary" style={styles.muted}>{link}</Text> : null}
    <Text style={styles.muted}>{fr.employeeTasks.rulesGated}</Text>
    {formLevel.length ? <IssueLines lines={formLevel} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 10, borderWidth: 1, borderColor: "#e3b7b7", borderRadius: 12, padding: 14, backgroundColor: "#fdf6f6" },
  title: { color: "#a32424", fontSize: 17, fontWeight: "700" },
  muted: { color: "#5b6e65", fontSize: 15, lineHeight: 22 },
  label: { color: "#3e554b", fontSize: 13, fontWeight: "700" },
  error: { color: "#a32424", fontSize: 14, lineHeight: 20 },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: 10, backgroundColor: "#135c4c", paddingHorizontal: 16 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.55 },
});
