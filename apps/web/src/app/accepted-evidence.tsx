"use client";

import { useEffect, useRef, useState } from "react";
import { acceptedEvidenceResponseSchema, insightDecisionResponseSchema, manualInsightResponseSchema } from "@cetem-qc/api-client/v1";
import type { AcceptedEvidenceResponse, ConfirmedSummary, ConformityDecision, ConformityHistoryItem, InsightDecisionResponse, ManualInsightResponse, SummaryHistoryItem, SummaryReopening } from "@cetem-qc/api-client/v1";
import { GRAPHIE_CALCULATION_FIELD_ID_LIST, GRAPHIE_MOBILE_POV_CATALOGUE } from "@cetem-qc/domain";
import type { CatalogueField, CatalogueSection, GraphieCalculationResults } from "@cetem-qc/domain";
import { fr } from "@cetem-qc/i18n";
import { GraphieCalculationReview } from "./graphie-calculation-review";
import { ConformityDecisionPanel } from "./conformity-decision";
import { PdfFilesPanel } from "./pdf-files";
import { ReportCandidatesPanel } from "./report-candidates";
import { SummaryDraftPanel } from "./summary-draft";

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const calculationFieldIds = new Set<string>(GRAPHIE_CALCULATION_FIELD_ID_LIST);

export type EvidenceLoad =
  | { kind: "ready"; evidence: AcceptedEvidenceResponse }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "failed" }
  | { kind: "unavailable" };

/** Reads the accepted evidence through the web route handler. Every request is a new access on the server. */
export async function loadAcceptedEvidence(taskId: string, fetcher: typeof fetch = fetch): Promise<EvidenceLoad> {
  try {
    const response = await fetcher(`/api/tasks/${encodeURIComponent(taskId)}/accepted-evidence`, { cache: "no-store" });
    if (response.status === 200) {
      const parsed = acceptedEvidenceResponseSchema.safeParse(await response.json());
      return parsed.success ? { kind: "ready", evidence: parsed.data } : { kind: "failed" };
    }
    if (response.status === 404) return { kind: "not-found" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 503) return { kind: "unavailable" };
    return { kind: "failed" };
  } catch {
    return { kind: "unavailable" };
  }
}

const isBlank = (value: string | undefined) => value === undefined || value.trim() === "";
const valueOf = (values: Readonly<Record<string, string>>, id: string) => Object.prototype.hasOwnProperty.call(values, id) ? values[id] : undefined;

function StoredValue({ value, unit }: { value: string | undefined; unit?: string }) {
  return <span className="evidence-value">{isBlank(value) ? fr.graphieResults.notEntered : `${value}${unit ? ` ${unit}` : ""}`}</span>;
}

/** The fields of a section that do not feed a calculation and are not table cells. */
function plainFields(section: CatalogueSection): CatalogueField[] {
  const tableCells = new Set((section.tables ?? []).flatMap((table) => table.fieldIds.flat()));
  return section.fields.filter((field) => !tableCells.has(field.id) && !calculationFieldIds.has(field.id));
}

function EvidenceTables({ section, values }: { section: CatalogueSection; values: Readonly<Record<string, string>> }) {
  const fieldById = new Map(section.fields.map((field) => [field.id, field]));
  return <>{(section.tables ?? []).map((table) => {
    // A column whose cells all feed a calculation is shown by the calculation review instead.
    const columns = table.columnLabelsFr.map((label, column) => ({ label, column })).filter(({ column }) => table.fieldIds.some((row) => !calculationFieldIds.has(row[column]!)));
    if (columns.length === 0) return null;
    return <div className="table-wrap" key={table.id}><table>
      <thead><tr><td />{columns.map(({ label, column }) => <th scope="col" key={column}>{label}</th>)}</tr></thead>
      <tbody>{table.rowLabelsFr.map((rowLabel, row) => <tr key={rowLabel}>
        <th scope="row">{rowLabel}</th>
        {columns.map(({ column }) => {
          const field = fieldById.get(table.fieldIds[row]![column]!);
          return <td key={column}><StoredValue value={field ? valueOf(values, field.id) : undefined} {...(field?.unit ? { unit: field.unit } : {})} /></td>;
        })}
      </tr>)}</tbody>
    </table></div>;
  })}</>;
}

/** Read-only sections of every stored field that does not feed a calculation, in paper order. */
export function EvidenceInputSections({ values }: { values: Readonly<Record<string, string>> }) {
  return <section className="evidence-inputs" aria-labelledby="evidence-input-heading">
    <h3 id="evidence-input-heading">{fr.evidence.inputHeading}</h3>
    {GRAPHIE_MOBILE_POV_CATALOGUE.sections.map((section) => {
      const fields = plainFields(section);
      const hasTable = (section.tables ?? []).some((table) => table.fieldIds.some((row) => row.some((id) => !calculationFieldIds.has(id))));
      if (fields.length === 0 && !hasTable) return null;
      return <section className="evidence-section" key={section.id} aria-labelledby={`evidence-section-${section.id}`}>
        <h4 id={`evidence-section-${section.id}`}>{section.labelFr}</h4>
        {fields.length > 0 && <dl>{fields.map((field) => <div className="evidence-field" key={field.id}>
          <dt>{field.labelFr}</dt>
          <dd><StoredValue value={valueOf(values, field.id)} {...(field.unit ? { unit: field.unit } : {})} /></dd>
        </div>)}</dl>}
        <EvidenceTables section={section} values={values} />
      </section>;
    })}
  </section>;
}

const fieldLabels = new Map(GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields).map((field) => [field.id, field.labelFr]));
const resultLabels: Record<string, string> = {
  voltageAccuracy: fr.graphieResults.tests.voltageAccuracy,
  voltageRepeatability: fr.graphieResults.tests.voltageRepeatability,
  outputRepeatability: fr.graphieResults.tests.outputRepeatability,
  outputLinearity: fr.graphieResults.tests.outputLinearity,
  lightFieldCorrespondence: fr.graphieResults.tests.lightFieldCorrespondence,
};
const sourceLabelOf = (source: { kind: "field" | "result"; key: string }) =>
  (source.kind === "field" ? fieldLabels.get(source.key) : resultLabels[source.key]) ?? source.key;

type InsightDecisions = InsightDecisionResponse[];
type InsightDecisionValue = InsightDecisionResponse["decision"];

export type InsightDecisionResult = { kind: "recorded"; decision: InsightDecisionResponse } | { kind: "failed" };

/** Sends one decision through the web route handler. The panel only shows what the response returns. */
export async function submitInsightDecision(taskId: string, proposalId: string, decision: InsightDecisionValue, fetcher: typeof fetch = fetch): Promise<InsightDecisionResult> {
  try {
    const response = await fetcher(`/api/tasks/${encodeURIComponent(taskId)}/insight-decisions`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ proposalId, decision }), cache: "no-store",
    });
    if (response.status !== 200) return { kind: "failed" };
    const parsed = insightDecisionResponseSchema.safeParse(await response.json());
    return parsed.success && parsed.data.proposalId === proposalId ? { kind: "recorded", decision: parsed.data } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

export type InsightProposalsSectionProps = {
  insights: AcceptedEvidenceResponse["insights"];
  decisions?: InsightDecisions;
  /** The proposal whose decision is in flight; both its controls are disabled. */
  pendingProposalId?: string | null;
  failed?: boolean;
  /** Decision controls render only for `available` proposals and only when this is given. */
  onDecide?: (proposalId: string, decision: InsightDecisionValue) => void;
  /** Manual insights count as retained: « Aucun insight retenu » shows only when there are none. */
  manualInsightCount?: number;
  /** Once the summary is confirmed the decision controls are disabled. */
  locked?: boolean;
};

/** W5 slot: renders the proposal set exactly as received, with retain/discard controls. It never evaluates. */
export function InsightProposalsSection({ insights, decisions = [], pendingProposalId = null, failed = false, onDecide, manualInsightCount = 0, locked = false }: InsightProposalsSectionProps) {
  const currentOf = (proposalId: string) => decisions.find((decision) => decision.proposalId === proposalId);
  let content: React.ReactNode;
  if (insights.status === "unavailable") content = <p className="state-message">{fr.insights.unavailable}</p>;
  else if (insights.proposals.length === 0) content = <p className="state-message">{fr.insights.none}</p>;
  else content = <>
    <ul className="insight-list">{insights.proposals.map((proposal) => {
      const current = currentOf(proposal.proposalId);
      const pending = locked || pendingProposalId === proposal.proposalId;
      const state = current ? (current.decision === "retained" ? fr.insights.retained : fr.insights.discarded) : fr.insights.undecided;
      return <li className="insight-item" key={proposal.proposalId}>
        <p>{proposal.statement}</p>
        <p>{fr.insights.rule.replace("{ruleId}", proposal.ruleId).replace("{ruleVersion}", String(proposal.ruleVersion))}</p>
        <p>{fr.insights.approval.replace("{approvalReference}", proposal.approvalReference)}</p>
        <p>{fr.insights.sources.replace("{sources}", proposal.sourceKeys.map(sourceLabelOf).join(", "))}</p>
        <p className="insight-state">{state}</p>
        {current && <p className="insight-decided">{fr.insights.decidedBy.replace("{name}", current.decidedBy.displayName).replace("{date}", dateTimeFormatter.format(new Date(current.decidedAt)))}</p>}
        {onDecide && <div className="insight-actions">
          <button className="secondary-button" type="button" aria-pressed={current?.decision === "retained"} disabled={pending} onClick={() => onDecide(proposal.proposalId, "retained")}>{fr.insights.retain}</button>
          <button className="secondary-button" type="button" aria-pressed={current?.decision === "discarded"} disabled={pending} onClick={() => onDecide(proposal.proposalId, "discarded")}>{fr.insights.discard}</button>
        </div>}
      </li>;
    })}</ul>
    {failed && <p className="field-error" role="alert">{fr.insights.decisionFailed}</p>}
    {manualInsightCount === 0 && !insights.proposals.some((proposal) => currentOf(proposal.proposalId)?.decision === "retained") && <p className="state-message">{fr.insights.noneRetained}</p>}
  </>;
  return <section className="evidence-insights" aria-labelledby="evidence-insights-heading">
    <h3 id="evidence-insights-heading">{fr.insights.heading}</h3>
    {content}
  </section>;
}

type ManualInsightItem = ManualInsightResponse;

export type ManualInsightResult = { kind: "added"; insight: ManualInsightItem } | { kind: "failed" };

/** Sends one manual insight through the web route handler. The panel only shows what the response returns. */
export async function submitManualInsight(taskId: string, text: string, justification: string, fetcher: typeof fetch = fetch): Promise<ManualInsightResult> {
  try {
    const response = await fetcher(`/api/tasks/${encodeURIComponent(taskId)}/manual-insights`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(justification.trim() === "" ? { text } : { text, justification }), cache: "no-store",
    });
    if (response.status !== 201) return { kind: "failed" };
    const parsed = manualInsightResponseSchema.safeParse(await response.json());
    return parsed.success ? { kind: "added", insight: parsed.data } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

export type ManualInsightsSectionProps = {
  insights: ManualInsightItem[];
  pending?: boolean;
  failed?: boolean;
  /** Returns true when the insight was added, so the form can be cleared. */
  onAdd?: (text: string, justification: string) => Promise<boolean> | boolean;
  /** Once the summary is confirmed the form is disabled. */
  locked?: boolean;
};

/** Manual insights of the accepted audit and the add form. Plain text only; no edit or delete control. */
export function ManualInsightsSection({ insights, pending = false, failed = false, onAdd, locked = false }: ManualInsightsSectionProps) {
  const [text, setText] = useState("");
  const [justification, setJustification] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || locked || text.trim() === "" || !onAdd) return;
    void Promise.resolve(onAdd(text, justification)).then((added) => {
      if (added) { setText(""); setJustification(""); }
    });
  };
  return <section className="evidence-manual-insights" aria-labelledby="evidence-manual-insights-heading">
    <h4 id="evidence-manual-insights-heading">{fr.insights.manualHeading}</h4>
    {insights.length > 0 && <ul className="insight-list">{insights.map((insight) => <li className="insight-item manual-insight-item" key={insight.id}>
      <p>{insight.text}</p>
      {insight.justification !== null && <p>{fr.insights.manualJustificationLabel} : {insight.justification}</p>}
      <p className="insight-state">{fr.insights.manualLabel}</p>
      <p className="insight-decided">{fr.insights.addedBy.replace("{name}", insight.author.displayName).replace("{date}", dateTimeFormatter.format(new Date(insight.createdAt)))}</p>
    </li>)}</ul>}
    <form className="manual-insight-form" onSubmit={submit}>
      <h5>{fr.insights.manualFormHeading}</h5>
      <p className="field-hint">{fr.insights.manualHint}</p>
      <label htmlFor="manual-insight-text">{fr.insights.manualTextLabel}</label>
      <textarea id="manual-insight-text" required disabled={locked} maxLength={1000} value={text} onChange={(event) => setText(event.target.value)} />
      <label htmlFor="manual-insight-justification">{fr.insights.manualJustificationLabel}</label>
      <textarea id="manual-insight-justification" disabled={locked} maxLength={1000} value={justification} onChange={(event) => setJustification(event.target.value)} />
      {failed && <p className="field-error" role="alert">{fr.insights.manualFailed}</p>}
      <button className="secondary-button" type="submit" disabled={pending || locked}>{pending ? fr.insights.manualSubmitting : fr.insights.manualSubmit}</button>
    </form>
  </section>;
}

/** Holds the local decision state: it changes only from a server response, never from a client calculation. */
export function InsightProposalsPanel({ taskId, insights, initialDecisions, initialManualInsights = [], initialSummary = null, initialSummaryHistory = [], initialSummaryVersion = null, initialConformityDecision = null, initialConformityHistory = [] }: { taskId: string; insights: AcceptedEvidenceResponse["insights"]; initialDecisions: InsightDecisions; initialManualInsights?: ManualInsightItem[]; initialSummary?: ConfirmedSummary | null; initialSummaryHistory?: SummaryHistoryItem[]; initialSummaryVersion?: AcceptedEvidenceResponse["summaryVersion"] | null; initialConformityDecision?: ConformityDecision | null; initialConformityHistory?: ConformityHistoryItem[] }) {
  const [conformityDecision, setConformityDecision] = useState<ConformityDecision | null>(initialConformityDecision);
  const [conformityHistory, setConformityHistory] = useState<ConformityHistoryItem[]>(initialConformityHistory);
  // Bumped whenever the summary or decision state is reloaded or reopened, so the derived candidate statuses are read again.
  const [reportRefreshKey, setReportRefreshKey] = useState(0);
  const bumpReportRefresh = () => setReportRefreshKey((key) => key + 1);
  const [summary, setSummaryState] = useState<ConfirmedSummary | null>(initialSummary);
  const [summaryHistory, setSummaryHistory] = useState<SummaryHistoryItem[]>(initialSummaryHistory);
  const [summaryVersion, setSummaryVersion] = useState<AcceptedEvidenceResponse["summaryVersion"] | null>(initialSummaryVersion ?? (initialSummary ? { number: initialSummary.version, state: "confirmed" } : null));
  const setSummary = (next: ConfirmedSummary) => {
    setSummaryState(next);
    setSummaryVersion({ number: next.version, state: "confirmed" });
  };
  // A reopening is the only way back to the unconfirmed state; the old version moves to the history and the 10.2 lock lifts.
  const onReopened = (reopening: SummaryReopening) => {
    setSummaryState(null);
    setSummaryVersion({ number: reopening.version, state: "open" });
    // The decision bound to the reopened summary becomes historical; it is never carried over to the next version.
    setConformityDecision(null);
    setConformityHistory((previous) => conformityDecision ? [{ ...conformityDecision, invalidatedAt: reopening.reopenedAt }, ...previous] : previous);
    bumpReportRefresh();
    setSummaryHistory((previous) => [{
      version: reopening.previous.version, text: reopening.previous.text, confirmedAt: reopening.previous.confirmedAt,
      confirmedBy: reopening.previous.confirmedBy, reopenedAt: reopening.reopenedAt, reopenedBy: reopening.reopenedBy,
      initialDraft: reopening.previous.initialDraft,
    }, ...previous]);
  };
  const [manualInsights, setManualInsights] = useState<ManualInsightItem[]>(initialManualInsights);
  const [manualPending, setManualPending] = useState(false);
  const [manualFailed, setManualFailed] = useState(false);
  const onAddManual = async (text: string, justification: string) => {
    if (manualPending || summary) return false;
    setManualPending(true);
    setManualFailed(false);
    const result = await submitManualInsight(taskId, text, justification);
    if (result.kind === "added") setManualInsights((previous) => [...previous, result.insight]);
    else setManualFailed(true);
    setManualPending(false);
    return result.kind === "added";
  };
  const [decisions, setDecisions] = useState<InsightDecisions>(initialDecisions);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const onDecide = (proposalId: string, decision: InsightDecisionValue) => {
    if (pendingProposalId !== null || summary) return;
    setPendingProposalId(proposalId);
    setFailed(false);
    void submitInsightDecision(taskId, proposalId, decision).then((result) => {
      if (result.kind === "recorded") setDecisions((previous) => [...previous.filter((item) => item.proposalId !== proposalId), result.decision]);
      else setFailed(true);
      setPendingProposalId(null);
    });
  };
  // After a 409 the confirmed state is read back from the server: nothing is shown as confirmed otherwise.
  const reloadSummary = async () => {
    const reloaded = await loadAcceptedEvidence(taskId);
    if (reloaded.kind === "ready") {
      setConformityDecision(reloaded.evidence.conformityDecision);
      setConformityHistory(reloaded.evidence.conformityHistory);
      bumpReportRefresh();
    }
    return reloaded.kind === "ready" ? reloaded.evidence.summary : null;
  };
  // After a refused reopening (409) the whole summary state comes back from the server.
  const reloadState = async () => {
    const reloaded = await loadAcceptedEvidence(taskId);
    if (reloaded.kind !== "ready") return;
    setSummaryState(reloaded.evidence.summary);
    setSummaryVersion(reloaded.evidence.summaryVersion);
    setSummaryHistory(reloaded.evidence.summaryHistory);
    setConformityDecision(reloaded.evidence.conformityDecision);
    setConformityHistory(reloaded.evidence.conformityHistory);
    bumpReportRefresh();
  };
  return <>
    <InsightProposalsSection insights={insights} decisions={decisions} pendingProposalId={pendingProposalId} failed={failed} onDecide={onDecide} manualInsightCount={manualInsights.length} locked={summary !== null} />
    <ManualInsightsSection insights={manualInsights} pending={manualPending} failed={manualFailed} onAdd={onAddManual} locked={summary !== null} />
    <SummaryDraftPanel taskId={taskId} summary={summary} onConfirmed={setSummary} onReloadEvidence={reloadSummary} version={summaryVersion} history={summaryHistory} onReopened={onReopened} onReloadState={reloadState} />
    <ConformityDecisionPanel taskId={taskId} confirmedVersion={summary ? summary.version : null} decision={summary ? conformityDecision : null} history={conformityHistory} onRecorded={setConformityDecision} onReloadState={reloadState} />
    <ReportCandidatesPanel taskId={taskId} eligible={summary !== null && conformityDecision !== null} refreshKey={reportRefreshKey} onReloadState={reloadState} />
    <PdfFilesPanel taskId={taskId} eligible={summary !== null && conformityDecision !== null} refreshKey={reportRefreshKey} onReloadState={reloadState} onCandidatesChanged={bumpReportRefresh} />
  </>;
}

function EvidenceLineage({ lineage }: { lineage: AcceptedEvidenceResponse["lineage"] }) {
  const lines = [
    lineage.replacementOf !== null ? fr.tasks.replacementOf.replace("{taskId}", lineage.replacementOf) : null,
    lineage.replacedBy !== null ? fr.tasks.replacedBy.replace("{taskId}", lineage.replacedBy) : null,
    lineage.recoverySource !== null ? fr.tasks.recoverySource.replace("{taskId}", lineage.recoverySource.taskId).replace("{revision}", String(lineage.recoverySource.revision)) : null,
    lineage.recoverySuccessorTaskId !== null ? fr.tasks.recoverySuccessor.replace("{taskId}", lineage.recoverySuccessorTaskId) : null,
  ].filter((line): line is string => line !== null);
  return lines.length === 0 ? null : <p className="evidence-lineage">{lines.map((line) => <span className="task-lineage" key={line}>{line}</span>)}</p>;
}

export type AcceptedEvidenceViewProps = {
  taskId: string;
  /** `undefined` while the request is in flight. */
  load: EvidenceLoad | undefined;
  onBack: () => void;
  onRetry: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
};

/** Read-only W4 panel: stored values, calculation evidence and lineage. The only control is « Retour à la liste » (and « Réessayer » on a failure). */
export function AcceptedEvidenceView({ taskId, load, onBack, onRetry, headingRef }: AcceptedEvidenceViewProps) {
  const heading = <h2 id="evidence-heading" tabIndex={-1} ref={headingRef}>{fr.evidence.heading} — {fr.tasks.taskId} : {taskId}</h2>;
  const back = <button className="secondary-button" type="button" onClick={onBack}>{fr.evidence.back}</button>;
  const retry = <button className="text-button" type="button" onClick={onRetry}>{fr.common.retry}</button>;
  let content: React.ReactNode;
  if (!load) {
    content = <div className="state-message" role="status">{fr.common.loading}</div>;
  } else if (load.kind === "ready") {
    const { evidence } = load;
    const context = [
      evidence.task.establishment, evidence.task.service, evidence.task.assignee,
      fr.evidence.submittedBy.replace("{displayName}", evidence.submission.submittedBy.displayName),
      fr.evidence.acceptedAt.replace("{date}", dateTimeFormatter.format(new Date(evidence.submission.acceptedAt))),
      fr.evidence.revision.replace("{revision}", String(evidence.submission.revision)),
    ];
    content = <>
      <p className="evidence-context">{context.filter((part) => part.trim() !== "").join(" · ")}</p>
      <EvidenceLineage lineage={evidence.lineage} />
      <EvidenceInputSections values={evidence.values} />
      <GraphieCalculationReview evidence={{ identity: evidence.identity, values: evidence.values, results: evidence.results as unknown as GraphieCalculationResults }} />
      <InsightProposalsPanel taskId={evidence.task.id} insights={evidence.insights} initialDecisions={evidence.insightDecisions} initialManualInsights={evidence.manualInsights} initialSummary={evidence.summary} initialSummaryHistory={evidence.summaryHistory} initialSummaryVersion={evidence.summaryVersion} initialConformityDecision={evidence.conformityDecision} initialConformityHistory={evidence.conformityHistory} />
    </>;
  } else if (load.kind === "not-found") {
    content = <div className="state-message error-state" role="alert">{fr.evidence.unavailable}</div>;
  } else if (load.kind === "forbidden") {
    content = <div className="state-message error-state" role="alert">{fr.auth.responsableOnly}</div>;
  } else {
    content = <div className="state-message error-state" role="alert">{load.kind === "unavailable" ? fr.api.unavailable : fr.evidence.loadFailed}{retry}</div>;
  }
  return <section className="roster-card evidence-panel" aria-labelledby="evidence-heading">
    <div className="card-heading">{heading}</div>
    {content}
    <div className="task-form-actions">{back}</div>
  </section>;
}

/** Loads the evidence of one accepted task, moves focus to the heading, and reports a vanished task through `onStale`. */
export function AcceptedEvidencePanel({ taskId, onBack, onStale }: { taskId: string; onBack: () => void; onStale: () => void }) {
  const [load, setLoad] = useState<EvidenceLoad>();
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { headingRef.current?.focus(); }, [taskId]);
  useEffect(() => {
    let current = true;
    setLoad(undefined);
    void loadAcceptedEvidence(taskId).then((result) => {
      if (!current) return;
      setLoad(result);
      if (result.kind === "not-found") onStale();
    });
    return () => { current = false; };
    // `onStale` only reloads the list; a new identity must not re-open (and re-log) the evidence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, attempt]);

  return <AcceptedEvidenceView taskId={taskId} load={load} headingRef={headingRef} onBack={onBack} onRetry={() => setAttempt((count) => count + 1)} />;
}
