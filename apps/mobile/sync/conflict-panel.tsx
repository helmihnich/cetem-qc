import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fr } from "@cetem-qc/i18n";
import type { FetchedServerVersion, LocalDraft } from "../local-drafts/model";
import { diffGraphieValues } from "./conflict-diff";
import { localVersionLine, parseServerVersionMetadata, serverVersionLine, type ServerVersionMetadata } from "./conflict-panel-text";
import type { OpenConflictSummary } from "./task-sync-state";

/** Technical limit, not a CETEM rule: the current-version read is aborted after 30 s, like a synchronization attempt. */
export const SERVER_VERSION_TIMEOUT_MS = 30_000;

/** The current server version as read by the panel: metadata and payload, never sent anywhere else. */
export type PanelServerVersion = ServerVersionMetadata & { payload: FetchedServerVersion["payload"] };
export type ConflictActionResult = "done" | "stale" | "failed";

type FetchState =
  | { status: "loading" }
  | { status: "blocked"; message: string }
  | { status: "failed" }
  | { status: "ready"; version: PanelServerVersion };

/**
 * Explicit synchronization conflict resolution (OD-02b): the preserved local version, the server version
 * at conflict time, the current server version and the differing fields, then two explicit choices.
 * Nothing is merged or chosen automatically; dismissing, cancelling or a failure changes nothing.
 */
export function ConflictPanel(props: {
  conflict: OpenConflictSummary;
  /** The readable local draft, if any. */
  localDraft: LocalDraft | undefined;
  /** True when the local draft is missing or this app version cannot read it. */
  localUnreadable: boolean;
  /** Null when the server may be read now; otherwise the French reason (offline, authorization). */
  canFetch: () => Promise<string | null>;
  fetchServer: (signal: AbortSignal) => Promise<PanelServerVersion>;
  onKeepLocal: (server: PanelServerVersion) => Promise<ConflictActionResult>;
  onDiscard: (server: PanelServerVersion) => Promise<ConflictActionResult>;
}) {
  const { conflict, localDraft } = props;
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"failed" | "stale">();
  const loadGenerationRef = useRef(0);
  const conflictKey = conflict.items.map((item) => item.operationId).join(",");
  const propsRef = useRef(props);
  propsRef.current = props;

  async function load() {
    const generation = ++loadGenerationRef.current;
    setFetchState({ status: "loading" });
    const blocked = await propsRef.current.canFetch().catch(() => fr.auth.reauthenticateOnline);
    if (generation !== loadGenerationRef.current) return;
    if (blocked) { setFetchState({ status: "blocked", message: blocked }); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_VERSION_TIMEOUT_MS);
    try {
      const version = await propsRef.current.fetchServer(controller.signal);
      if (generation === loadGenerationRef.current) setFetchState({ status: "ready", version });
    } catch {
      if (generation === loadGenerationRef.current) setFetchState({ status: "failed" });
    } finally {
      clearTimeout(timer);
    }
  }

  useEffect(() => {
    void load();
    return () => { loadGenerationRef.current++; };
  }, [conflictKey]);

  async function act(choice: "keep-local" | "discard-local") {
    if (fetchState.status !== "ready" || busy) return;
    setConfirmingDiscard(false);
    setBusy(true);
    setNotice(undefined);
    const result = await (choice === "keep-local" ? props.onKeepLocal : props.onDiscard)(fetchState.version).catch(() => "failed" as const);
    setBusy(false);
    if (result === "stale") { setNotice("stale"); void load(); }
    else if (result === "failed") setNotice("failed");
  }

  const atConflict = parseServerVersionMetadata(conflict.detail);
  const ready = fetchState.status === "ready" ? fetchState.version : undefined;
  const localLine = localDraft ? localVersionLine(localDraft) : undefined;
  // Without readable local values nothing is compared: the list would otherwise name every server field.
  const localValues = localDraft && !props.localUnreadable && !("content" in localDraft.payload) ? localDraft.payload.values : undefined;
  const differences = ready && localValues ? diffGraphieValues(localValues, ready.payload?.values ?? {}) : [];
  const keepLocalOffered = Boolean(localDraft) && !props.localUnreadable && ready?.state !== "submitted";
  const actionsEnabled = Boolean(ready) && !busy;

  return <View style={styles.panel}>
    <Text accessibilityRole="alert" style={styles.title}>{fr.employeeTasks.conflictTitle}</Text>
    <Text style={styles.muted}>{fr.employeeTasks.conflictExplanation}</Text>
    {localLine ? <Text style={styles.muted}>{localLine}</Text> : null}
    {props.localUnreadable ? <Text style={styles.muted}>{fr.employeeTasks.conflictLocalUnavailable}</Text> : null}
    {conflict.hasPendingSnapshot ? <Text style={styles.muted}>{fr.employeeTasks.conflictPendingKept}</Text> : null}
    {atConflict ? <Text style={styles.muted}>{serverVersionLine(atConflict, "at-conflict")}</Text> : null}
    {fetchState.status === "loading" ? <Text accessibilityRole="summary" style={styles.muted}>{fr.employeeTasks.conflictLoadingServer}</Text> : null}
    {fetchState.status === "blocked" ? <Text accessibilityRole="alert" style={styles.error}>{fetchState.message}</Text> : null}
    {fetchState.status === "failed" ? <Text accessibilityRole="alert" style={styles.error}>{fr.employeeTasks.conflictServerUnavailable}</Text> : null}
    {fetchState.status === "blocked" || fetchState.status === "failed"
      ? <PanelButton title={fr.employeeTasks.conflictRetryFetch} onPress={() => void load()} /> : null}
    {ready ? <Text accessibilityRole="summary" style={styles.muted}>{serverVersionLine(ready, "current")}</Text> : null}
    {ready && localValues ? <View style={{ gap: 4 }}>
      {differences.length
        ? <>
          <Text style={styles.label}>{fr.employeeTasks.conflictDifferences}</Text>
          {differences.map((difference) => <Text key={difference.fieldId} style={styles.muted}>{difference.labelFr}</Text>)}
        </>
        : <Text style={styles.muted}>{fr.employeeTasks.conflictNoDifference}</Text>}
    </View> : null}
    {notice === "failed" ? <Text accessibilityRole="alert" style={styles.error}>{fr.employeeTasks.conflictResolutionFailed}</Text> : null}
    {notice === "stale" ? <Text accessibilityRole="alert" style={styles.error}>{fr.employeeTasks.conflictResolutionStale}</Text> : null}
    {keepLocalOffered ? <PanelButton title={fr.employeeTasks.conflictKeepLocal} onPress={() => void act("keep-local")} disabled={!actionsEnabled} /> : null}
    <PanelButton title={fr.employeeTasks.conflictDiscardLocal} secondary onPress={() => { if (actionsEnabled) setConfirmingDiscard(true); }} disabled={!actionsEnabled || confirmingDiscard} />
    {confirmingDiscard ? <View style={styles.confirmation}>
      <Text accessibilityRole="alert" style={styles.muted}>{fr.employeeTasks.conflictConfirmDiscard}</Text>
      <PanelButton title={fr.common.cancel} secondary onPress={() => setConfirmingDiscard(false)} />
      <PanelButton title={fr.employeeTasks.conflictConfirmDiscardAction} onPress={() => void act("discard-local")} disabled={!actionsEnabled} />
    </View> : null}
  </View>;
}

function PanelButton(props: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(props.disabled) }} onPress={props.onPress} disabled={props.disabled}
    style={[styles.button, props.secondary && styles.secondaryButton, props.disabled && styles.disabled]}>
    <Text style={[styles.buttonText, props.secondary && styles.secondaryButtonText]}>{props.title}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  panel: { gap: 10, borderWidth: 1, borderColor: "#e3b7b7", borderRadius: 12, padding: 14, backgroundColor: "#fdf6f6" },
  title: { color: "#a32424", fontSize: 17, fontWeight: "700" },
  muted: { color: "#5b6e65", fontSize: 15, lineHeight: 22 },
  label: { color: "#3e554b", fontSize: 13, fontWeight: "700" },
  error: { color: "#a32424", fontSize: 14, lineHeight: 20 },
  confirmation: { gap: 10, borderWidth: 1, borderColor: "#d5e1d9", borderRadius: 12, padding: 14 },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: 10, backgroundColor: "#135c4c", paddingHorizontal: 16 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryButton: { backgroundColor: "#edf3ef", borderWidth: 1, borderColor: "#d5e1d9" },
  secondaryButtonText: { color: "#135c4c" },
  disabled: { opacity: 0.55 },
});
