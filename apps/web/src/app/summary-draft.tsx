"use client";

import { useRef, useState } from "react";
import { confirmedSummarySchema, summaryDraftResponseSchema } from "@cetem-qc/api-client/v1";
import type { ConfirmedSummary, SummaryDraftResponse } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export type SummaryDraftResult = { kind: "generated"; draft: SummaryDraftResponse } | { kind: "failed" };

/** Asks the web route handler for a draft. The body is empty: the server supplies every input. */
export async function requestSummaryDraftFromServer(taskId: string, fetcher: typeof fetch = fetch): Promise<SummaryDraftResult> {
  try {
    const response = await fetcher(`/api/tasks/${encodeURIComponent(taskId)}/summary-drafts`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: "{}", cache: "no-store",
    });
    if (response.status !== 201) return { kind: "failed" };
    const parsed = summaryDraftResponseSchema.safeParse(await response.json());
    return parsed.success ? { kind: "generated", draft: parsed.data } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

export type SummaryConfirmationResult = { kind: "confirmed"; summary: ConfirmedSummary } | { kind: "already-confirmed" } | { kind: "failed" };

/** Sends the final text through the web route handler. Only a valid 201 counts as confirmed; the draft link is sent only for AI-started text. */
export async function confirmSummaryOnServer(taskId: string, text: string, draftId: string | null, fetcher: typeof fetch = fetch): Promise<SummaryConfirmationResult> {
  try {
    const response = await fetcher(`/api/tasks/${encodeURIComponent(taskId)}/summary-confirmation`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(draftId ? { text, draftId } : { text }), cache: "no-store",
    });
    if (response.status === 409) {
      const code = ((await response.json()) as { error?: { code?: unknown } } | null)?.error?.code;
      return code === "SUMMARY_ALREADY_CONFIRMED" || code === "SUMMARY_CONFIRMED" ? { kind: "already-confirmed" } : { kind: "failed" };
    }
    if (response.status !== 201) return { kind: "failed" };
    const parsed = confirmedSummarySchema.safeParse(await response.json());
    return parsed.success ? { kind: "confirmed", summary: parsed.data } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/** A draft fills an empty text area; over typed text it is only offered, never applied silently. */
export function applyDraft(text: string, draft: SummaryDraftResponse): { text: string; offered: SummaryDraftResponse | null } {
  return text.trim() === "" ? { text: draft.text, offered: null } : { text, offered: draft };
}

export type SummaryDraftSectionProps = {
  text: string;
  onTextChange?: (text: string) => void;
  pending?: boolean;
  failed?: boolean;
  /** The draft that filled the text area, labelled as unconfirmed. */
  filled?: SummaryDraftResponse | null;
  /** A new draft offered while the text area holds text. */
  offered?: SummaryDraftResponse | null;
  onRequest?: () => void;
  onReplace?: () => void;
  /** The confirmed summary: when set, the section is read only. */
  summary?: ConfirmedSummary | null;
  /** True while the « Confirmer cette synthèse ? » prompt is open. */
  confirming?: boolean;
  confirmPending?: boolean;
  confirmFailed?: boolean;
  onConfirmStart?: () => void;
  onConfirmCancel?: () => void;
  onConfirmYes?: () => void;
};

const sourceLine = (draft: { provider: string; model: string; requestedAt: string }) =>
  fr.summary.draftSource.replace("{provider}", draft.provider).replace("{model}", draft.model).replace("{date}", dateTimeFormatter.format(new Date(draft.requestedAt)));

/** W5 block: a request button, an always-editable text area and the explicit two-step confirmation. Once confirmed it is read only. */
export function SummaryDraftSection({
  text, onTextChange, pending = false, failed = false, filled = null, offered = null, onRequest, onReplace,
  summary = null, confirming = false, confirmPending = false, confirmFailed = false, onConfirmStart, onConfirmCancel, onConfirmYes,
}: SummaryDraftSectionProps) {
  if (summary) {
    return <section className="evidence-summary" aria-labelledby="evidence-summary-heading">
      <h3 id="evidence-summary-heading">{fr.summary.confirmedHeading}</h3>
      <p className="insight-decided">{fr.summary.confirmedBy.replace("{name}", summary.confirmedBy.displayName).replace("{date}", dateTimeFormatter.format(new Date(summary.confirmedAt)))}</p>
      <button className="secondary-button" type="button" disabled>{fr.summary.request}</button>
      <label htmlFor="summary-text">{fr.summary.textLabel}</label>
      <textarea id="summary-text" readOnly value={summary.text} />
      {summary.initialDraft && <div className="insight-item summary-initial-draft">
        <p className="insight-state">{fr.summary.initialDraftLabel}</p>
        <p>{summary.initialDraft.text}</p>
        <p>{sourceLine(summary.initialDraft)}</p>
      </div>}
    </section>;
  }
  const canConfirm = text.trim() !== "" && !confirmPending && !pending;
  return <section className="evidence-summary" aria-labelledby="evidence-summary-heading">
    <h3 id="evidence-summary-heading">{fr.summary.heading}</h3>
    <p className="field-hint">{fr.summary.note}</p>
    <p className="field-hint">{fr.summary.conformityUnavailable}</p>
    <button className="secondary-button" type="button" disabled={pending} aria-busy={pending} onClick={onRequest}>{fr.summary.request}</button>
    {pending && <p className="state-message" role="status">{fr.summary.pending}</p>}
    {failed && <p className="field-error" role="alert">{fr.summary.unavailable}</p>}
    <label htmlFor="summary-text">{fr.summary.textLabel}</label>
    <textarea id="summary-text" value={text} onChange={(event) => onTextChange?.(event.target.value)} />
    {filled && <p className="insight-state">{fr.summary.draftLabel}<br />{sourceLine(filled)}</p>}
    {offered && <div className="insight-item summary-new-draft">
      <h4>{fr.summary.newDraftHeading}</h4>
      <p className="insight-state">{fr.summary.draftLabel}</p>
      <p>{offered.text}</p>
      <p>{sourceLine(offered)}</p>
      <button className="secondary-button" type="button" onClick={onReplace}>{fr.summary.replace}</button>
    </div>}
    {confirmFailed && <p className="field-error" role="alert">{fr.summary.confirmFailed}</p>}
    {confirming
      ? <div className="summary-confirm-prompt" role="alertdialog" aria-labelledby="summary-confirm-prompt-text">
        <p id="summary-confirm-prompt-text">{fr.summary.confirmPrompt}</p>
        <button className="primary-button" type="button" disabled={confirmPending} aria-busy={confirmPending} onClick={onConfirmYes}>{confirmPending ? fr.summary.confirming : fr.summary.confirmYes}</button>
        <button className="secondary-button" type="button" disabled={confirmPending} onClick={onConfirmCancel}>{fr.summary.confirmCancel}</button>
      </div>
      : <button className="primary-button" type="button" disabled={!canConfirm} onClick={onConfirmStart}>{fr.summary.confirm}</button>}
  </section>;
}

/**
 * Holds the local text and draft state; the text is never overwritten without the user choosing to replace it.
 * The confirmed state comes only from a valid server response (or the evidence reloaded after a 409).
 */
export function SummaryDraftPanel({ taskId, summary = null, onConfirmed, onReloadEvidence }: {
  taskId: string;
  summary?: ConfirmedSummary | null;
  onConfirmed?: (summary: ConfirmedSummary) => void;
  /** Reloads the evidence after a 409 and reports the confirmed summary found there, if any. */
  onReloadEvidence?: () => Promise<ConfirmedSummary | null>;
}) {
  const [text, setTextState] = useState("");
  const textRef = useRef("");
  const setText = (value: string) => { textRef.current = value; setTextState(value); };
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filled, setFilled] = useState<SummaryDraftResponse | null>(null);
  const [offered, setOffered] = useState<SummaryDraftResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);
  const onRequest = () => {
    if (pending) return;
    setPending(true);
    setFailed(false);
    void requestSummaryDraftFromServer(taskId).then((result) => {
      if (result.kind === "generated") {
        // The ref holds the text as typed up to now, including what was typed while the request was pending.
        const applied = applyDraft(textRef.current, result.draft);
        textRef.current = applied.text;
        setText(applied.text);
        setOffered(applied.offered);
        if (!applied.offered) setFilled(result.draft);
      } else {
        setFailed(true);
      }
      setPending(false);
    });
  };
  const onReplace = () => {
    if (!offered) return;
    setText(offered.text);
    setFilled(offered);
    setOffered(null);
  };
  const onConfirmYes = () => {
    if (confirmPending) return;
    setConfirmPending(true);
    setConfirmFailed(false);
    // The draft link is the draft the text started from; it is absent for text written by hand.
    void confirmSummaryOnServer(taskId, textRef.current, filled?.id ?? null).then(async (result) => {
      if (result.kind === "confirmed") {
        onConfirmed?.(result.summary);
      } else if (result.kind === "already-confirmed") {
        const reloaded = onReloadEvidence ? await onReloadEvidence() : null;
        if (reloaded) onConfirmed?.(reloaded);
        else setConfirmFailed(true);
      } else {
        setConfirmFailed(true);
      }
      setConfirming(false);
      setConfirmPending(false);
    });
  };
  return <SummaryDraftSection
    text={text} onTextChange={setText} pending={pending} failed={failed} filled={filled} offered={offered} onRequest={onRequest} onReplace={onReplace}
    summary={summary} confirming={confirming} confirmPending={confirmPending} confirmFailed={confirmFailed}
    onConfirmStart={() => { setConfirmFailed(false); setConfirming(true); }} onConfirmCancel={() => setConfirming(false)} onConfirmYes={onConfirmYes}
  />;
}
