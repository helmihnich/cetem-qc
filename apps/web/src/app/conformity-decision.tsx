"use client";

import { useRef, useState } from "react";
import { conformityDecisionSchema } from "@cetem-qc/api-client/v1";
import type { ConformityDecision, ConformityHistoryItem, ConformityOutcome } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

const OUTCOMES: readonly ConformityOutcome[] = ["machine-conforme", "machine-non-conforme"];
export const conformityLabel = (outcome: ConformityOutcome) => outcome === "machine-conforme" ? fr.conformity.conforme : fr.conformity.nonConforme;

export type ConformityRecordResult =
  | { kind: "recorded"; decision: ConformityDecision }
  | { kind: "not-confirmed" }
  | { kind: "already-decided" }
  | { kind: "failed" };

/** Sends the chosen outcome (and nothing else) through the web route handler. Only a valid 201 counts as recorded. */
export async function recordConformityDecisionOnServer(taskId: string, outcome: ConformityOutcome, fetcher: typeof fetch = fetch): Promise<ConformityRecordResult> {
  try {
    const response = await fetcher(`/api/tasks/${encodeURIComponent(taskId)}/conformity-decision`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ outcome }), cache: "no-store",
    });
    if (response.status === 409) {
      const code = ((await response.json()) as { error?: { code?: unknown } } | null)?.error?.code;
      if (code === "SUMMARY_NOT_CONFIRMED") return { kind: "not-confirmed" };
      return code === "CONFORMITY_ALREADY_DECIDED" ? { kind: "already-decided" } : { kind: "failed" };
    }
    if (response.status !== 201) return { kind: "failed" };
    const parsed = conformityDecisionSchema.safeParse(await response.json());
    return parsed.success ? { kind: "recorded", decision: parsed.data } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

export type ConformityDecisionSectionProps = {
  /** Version number of the current confirmed summary, or null while the summary is open. */
  confirmedVersion: number | null;
  decision: ConformityDecision | null;
  history?: ConformityHistoryItem[];
  /** The outcome whose second-step prompt is open, or null. */
  prompt?: ConformityOutcome | null;
  pending?: boolean;
  /** French message of the last failed or refused recording, or null. */
  message?: string | null;
  onChoose?: (outcome: ConformityOutcome) => void;
  onCancel?: () => void;
  onConfirm?: () => void;
  /** Receives each outcome button so the panel can return focus to it after « Annuler ». */
  buttonRef?: (outcome: ConformityOutcome, element: HTMLButtonElement | null) => void;
};

const fill = (template: string, values: Record<string, string>) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);

/** Read-only list of the decisions made historical by a reopening; absent when there are none. */
function ConformityHistory({ history }: { history: ConformityHistoryItem[] }) {
  if (history.length === 0) return null;
  return <section className="conformity-history" aria-labelledby="conformity-history-heading">
    <h4 id="conformity-history-heading">{fr.conformity.historyHeading}</h4>
    {history.map((item) => <p className="insight-item conformity-history-item" key={item.id}>
      {fill(fr.conformity.historyItem, { label: conformityLabel(item.outcome), n: String(item.summaryVersion), name: item.decidedBy.displayName, date: dateTimeFormatter.format(new Date(item.decidedAt)) })}
    </p>)}
  </section>;
}

/** W5 decision area: two equal, unselected buttons after confirmation, a second-step prompt, then the recorded decision. */
export function ConformityDecisionSection({
  confirmedVersion, decision, history = [], prompt = null, pending = false, message = null, onChoose, onCancel, onConfirm, buttonRef,
}: ConformityDecisionSectionProps) {
  return <section className="evidence-conformity" aria-labelledby="evidence-conformity-heading">
    <h3 id="evidence-conformity-heading">{fr.conformity.heading}</h3>
    {message && <p className="field-error" role="alert">{message}</p>}
    {confirmedVersion === null
      ? <p className="field-hint">{fr.conformity.awaitingSummary}</p>
      : decision
        ? <p className="insight-decided">{fill(fr.conformity.decided, { label: conformityLabel(decision.outcome), name: decision.decidedBy.displayName, date: dateTimeFormatter.format(new Date(decision.decidedAt)) })}</p>
        : prompt
          ? <div className="summary-confirm-prompt" role="alertdialog" aria-labelledby="conformity-prompt-text">
            <p id="conformity-prompt-text">{fill(fr.conformity.prompt, { label: conformityLabel(prompt), n: String(confirmedVersion) })}</p>
            <button className="secondary-button" type="button" disabled={pending} aria-busy={pending} onClick={onConfirm}>{pending ? fr.conformity.saving : fr.conformity.confirmYes}</button>
            <button className="secondary-button" type="button" disabled={pending} onClick={onCancel}>{fr.conformity.confirmCancel}</button>
          </div>
          : <div className="conformity-choices">
            {OUTCOMES.map((outcome) => <button className="secondary-button" type="button" key={outcome} ref={(element) => buttonRef?.(outcome, element)} onClick={() => onChoose?.(outcome)}>{conformityLabel(outcome)}</button>)}
          </div>}
    <ConformityHistory history={history} />
  </section>;
}

/** Holds the prompt state; a decision exists only after a valid server response (or the evidence reloaded after a 409). */
export function ConformityDecisionPanel({ taskId, confirmedVersion, decision, history, onRecorded, onReloadState }: {
  taskId: string;
  confirmedVersion: number | null;
  decision: ConformityDecision | null;
  history: ConformityHistoryItem[];
  onRecorded: (decision: ConformityDecision) => void;
  /** Reloads the summary and decision state after a refused recording (409). */
  onReloadState?: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState<ConformityOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const buttons = useRef<Partial<Record<ConformityOutcome, HTMLButtonElement | null>>>({});
  const opener = useRef<ConformityOutcome | null>(null);
  const onCancel = () => {
    const target = opener.current;
    setPrompt(null);
    // The buttons render again after this update; focus returns to the one that opened the prompt.
    if (target) setTimeout(() => buttons.current[target]?.focus(), 0);
  };
  const onConfirm = () => {
    if (pending || !prompt) return;
    setPending(true);
    setMessage(null);
    void recordConformityDecisionOnServer(taskId, prompt).then(async (result) => {
      if (result.kind === "recorded") {
        onRecorded(result.decision);
      } else if (result.kind === "failed") {
        setMessage(fr.conformity.failed);
      } else {
        await onReloadState?.();
        setMessage(result.kind === "not-confirmed" ? fr.conformity.notConfirmed : fr.conformity.alreadyDecided);
      }
      setPrompt(null);
      setPending(false);
    });
  };
  return <ConformityDecisionSection
    confirmedVersion={confirmedVersion} decision={decision} history={history} prompt={prompt} pending={pending} message={message}
    onChoose={(outcome) => { opener.current = outcome; setMessage(null); setPrompt(outcome); }} onCancel={onCancel} onConfirm={onConfirm}
    buttonRef={(outcome, element) => { buttons.current[outcome] = element; }}
  />;
}
