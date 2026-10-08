"use client";

import { useRef, useState } from "react";
import { summaryDraftResponseSchema } from "@cetem-qc/api-client/v1";
import type { SummaryDraftResponse } from "@cetem-qc/api-client/v1";
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
};

const sourceLine = (draft: SummaryDraftResponse) =>
  fr.summary.draftSource.replace("{provider}", draft.provider).replace("{model}", draft.model).replace("{date}", dateTimeFormatter.format(new Date(draft.requestedAt)));

/** W5 block: a request button and an always-editable text area. There is no save, confirm or conformity control here. */
export function SummaryDraftSection({ text, onTextChange, pending = false, failed = false, filled = null, offered = null, onRequest, onReplace }: SummaryDraftSectionProps) {
  return <section className="evidence-summary" aria-labelledby="evidence-summary-heading">
    <h3 id="evidence-summary-heading">{fr.summary.heading}</h3>
    <p className="field-hint">{fr.summary.note}</p>
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
  </section>;
}

/** Holds the local text and draft state; the text is never overwritten without the user choosing to replace it. */
export function SummaryDraftPanel({ taskId }: { taskId: string }) {
  const [text, setTextState] = useState("");
  const textRef = useRef("");
  const setText = (value: string) => { textRef.current = value; setTextState(value); };
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filled, setFilled] = useState<SummaryDraftResponse | null>(null);
  const [offered, setOffered] = useState<SummaryDraftResponse | null>(null);
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
  return <SummaryDraftSection text={text} onTextChange={setText} pending={pending} failed={failed} filled={filled} offered={offered} onRequest={onRequest} onReplace={onReplace} />;
}
