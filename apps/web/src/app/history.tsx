"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { historyListResponseSchema, historyRecordResponseSchema } from "@cetem-qc/api-client/v1";
import type { ConformityOutcome, HistoryLineageRelation, HistoryListItem, HistoryRecordResponse } from "@cetem-qc/api-client/v1";
import type { GraphieCalculationResults } from "@cetem-qc/domain";
import { fr } from "@cetem-qc/i18n";
import { EvidenceInputSections, InsightProposalsSection } from "./accepted-evidence";
import { GraphieCalculationReview } from "./graphie-calculation-review";
import { Icon, ShortId } from "./icons";

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const when = (iso: string) => dateTimeFormatter.format(new Date(iso));
const fill = (template: string, values: Record<string, string>) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);
const outcomeLabel = (outcome: ConformityOutcome) => outcome === "machine-conforme" ? fr.conformity.conforme : fr.conformity.nonConforme;
const originLabel = (origin: HistoryListItem["reportOrigin"]) => origin === "uploaded-pdf" ? fr.report.origin.uploadedPdf : fr.report.origin.generatedWord;

export type HistoryListLoad = { kind: "ready"; records: HistoryListItem[] } | { kind: "failed" } | { kind: "unavailable" };
export type HistoryRecordLoad = { kind: "ready"; record: HistoryRecordResponse } | { kind: "not-found" } | { kind: "failed" } | { kind: "unavailable" };
export type OfficialDownloadResult = { kind: "saved"; fileName: string } | { kind: "not-found" } | { kind: "not-ready" } | { kind: "failed" };

/** Reads the completed controls through the web route handler. Nothing is written by a read. */
export async function loadHistoryList(fetcher: typeof fetch = fetch): Promise<HistoryListLoad> {
  try {
    const response = await fetcher("/api/history", { headers: { accept: "application/json" }, cache: "no-store" });
    if (response.status === 200) {
      const parsed = historyListResponseSchema.safeParse(await response.json());
      return parsed.success ? { kind: "ready", records: parsed.data.records } : { kind: "failed" };
    }
    return response.status === 503 ? { kind: "unavailable" } : { kind: "failed" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Reads one completed control through the web route handler. */
export async function loadHistoryRecord(taskId: string, fetcher: typeof fetch = fetch): Promise<HistoryRecordLoad> {
  try {
    const response = await fetcher(`/api/history/${encodeURIComponent(taskId)}`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (response.status === 200) {
      const parsed = historyRecordResponseSchema.safeParse(await response.json());
      return parsed.success ? { kind: "ready", record: parsed.data } : { kind: "failed" };
    }
    if (response.status === 404) return { kind: "not-found" };
    return response.status === 503 ? { kind: "unavailable" } : { kind: "failed" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Hands the downloaded bytes to the browser as a file; the object URL is released at once. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Downloads the official report file through the web route handler. One request per call; the server decides what is served. */
export async function downloadOfficialReportFile(taskId: string, fetcher: typeof fetch = fetch, save: (blob: Blob, fileName: string) => void = saveBlob): Promise<OfficialDownloadResult> {
  try {
    const response = await fetcher(`/api/history/${encodeURIComponent(taskId)}/official-report/file`, { cache: "no-store" });
    if (response.status === 404) return { kind: "not-found" };
    if (response.status === 409) return { kind: "not-ready" };
    if (response.status !== 200) return { kind: "failed" };
    const fileName = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1];
    if (!fileName) return { kind: "failed" };
    save(await response.blob(), fileName);
    return { kind: "saved", fileName };
  } catch {
    return { kind: "failed" };
  }
}

const downloadMessages = { "not-found": fr.history.downloadNotFound, "not-ready": fr.history.downloadNotReady, failed: fr.history.downloadFailed } as const;

/** One lineage line. « Ouvrir » is offered only for a related control the viewer may see and that is completed. */
function lineageText(relation: HistoryLineageRelation): string {
  const text = fr.history.lineage;
  const withTarget = relation.auditId !== null ? "audit" : "task";
  const values = { auditId: relation.auditId ?? "", taskId: relation.taskId ?? "" };
  switch (relation.relation) {
    case "replacement-of": return !relation.accessible ? text.replacementOfHidden : fill(withTarget === "audit" ? text.replacementOf : text.replacementOfTask, values);
    case "replaced-by": return !relation.accessible ? text.replacedByHidden : fill(withTarget === "audit" ? text.replacedBy : text.replacedByTask, values);
    case "recovery-source": return !relation.accessible ? text.recoverySourceHidden : fill(withTarget === "audit" ? text.recoverySource : text.recoverySourceTask, values);
    case "recovery-successor": return !relation.accessible ? text.recoverySuccessorHidden : fill(withTarget === "audit" ? text.recoverySuccessor : text.recoverySuccessorTask, values);
  }
}

export function HistoryLineageLines({ lineage, onOpen }: { lineage: HistoryLineageRelation[]; onOpen?: (taskId: string) => void }) {
  if (lineage.length === 0) return null;
  return <ul className="evidence-lineage history-lineage">{lineage.map((relation) => <li className="task-lineage" key={relation.relation}>
    {lineageText(relation)}
    {onOpen && relation.accessible && relation.completed && relation.taskId !== null && <>{" "}<button className="text-button" type="button" onClick={() => onOpen(relation.taskId!)}>{fr.history.lineage.open}</button></>}
  </li>)}</ul>;
}

export type HistoryListViewProps = {
  /** `undefined` while the request is in flight. */
  load: HistoryListLoad | undefined;
  onRetry: () => void;
  onOpen: (taskId: string) => void;
  /** The completed control whose record is open; its button is marked expanded. */
  openTaskId?: string;
};

/** The completed controls, newest designation first as the server returns them. The only controls are « Consulter » and « Réessayer ». */
export function HistoryListView({ load, onRetry, onOpen, openTaskId }: HistoryListViewProps) {
  let content: React.ReactNode;
  if (!load) content = <div className="state-message" role="status">{fr.common.loading}</div>;
  else if (load.kind !== "ready") content = <div className="state-message error-state" role="alert">{load.kind === "unavailable" ? fr.api.unavailable : fr.history.loadFailed}<button className="text-button" type="button" onClick={onRetry}>{fr.common.retry}</button></div>;
  else if (load.records.length === 0) content = <div className="state-message empty-state" role="status"><span className="empty-icon" aria-hidden="true"><Icon name="inbox" size={22} /></span><p>{fr.history.empty}</p></div>;
  else content = <div className="table-wrap"><table>
    <thead><tr>
      <th scope="col">{fr.history.taskColumn}</th><th scope="col">{fr.history.establishmentColumn}</th><th scope="col">{fr.history.assigneeColumn}</th>
      <th scope="col">{fr.history.designatedColumn}</th><th scope="col">{fr.history.outcomeColumn}</th><th scope="col">{fr.history.originColumn}</th>
      <th scope="col"><span className="visually-hidden">{fr.history.actionsColumn}</span></th>
    </tr></thead>
    <tbody>{load.records.map((record) => <tr key={record.taskId}>
      <td className="task-id-cell"><ShortId id={record.taskId} /><HistoryLineageLines lineage={record.lineage} /></td>
      <td>{record.establishment}</td><td className="name-cell">{record.assignee}</td>
      <td>{when(record.designatedAt)}</td><td>{outcomeLabel(record.conformityOutcome)}</td><td>{originLabel(record.reportOrigin)}</td>
      <td className="task-actions-cell"><button id={`history-open-${record.taskId}`} className="secondary-button" type="button" aria-expanded={openTaskId === record.taskId} onClick={() => onOpen(record.taskId)}>{fr.history.open}</button></td>
    </tr>)}</tbody>
  </table></div>;
  return <section className="roster-card history-card" aria-labelledby="history-title">
    <div className="card-heading"><div><h2 id="history-title">{fr.history.heading}</h2><p>{fr.history.description}</p></div></div>
    {content}
  </section>;
}

function ReadOnlySummary({ record }: { record: HistoryRecordResponse }) {
  const { summary, summaryHistory } = record;
  return <section className="evidence-summary" aria-labelledby="history-summary-heading">
    <h3 id="history-summary-heading">{fr.summary.confirmedHeading}</h3>
    <p className="insight-decided">{fr.summary.confirmedBy.replace("{name}", summary.confirmedBy.displayName).replace("{date}", when(summary.confirmedAt))}</p>
    <label htmlFor="history-summary-text">{fr.summary.textLabel}</label>
    <textarea id="history-summary-text" readOnly value={summary.text} />
    {summary.initialDraft && <div className="insight-item summary-initial-draft">
      <p className="insight-state">{fr.summary.initialDraftLabel}</p>
      <p>{summary.initialDraft.text}</p>
      <p>{fr.summary.draftSource.replace("{provider}", summary.initialDraft.provider).replace("{model}", summary.initialDraft.model).replace("{date}", when(summary.initialDraft.requestedAt))}</p>
    </div>}
    {summaryHistory.length > 0 && <section className="summary-history" aria-labelledby="history-summary-history-heading">
      <h4 id="history-summary-history-heading">{fr.summary.historyHeading}</h4>
      {summaryHistory.map((item) => <div className="insight-item summary-history-item" key={item.version}>
        <p className="insight-state">{fr.summary.historyVersion.replace("{n}", String(item.version))}</p>
        <p>{fr.summary.historyBy.replace("{name}", item.confirmedBy.displayName).replace("{date}", when(item.confirmedAt))}</p>
        <p>{fr.summary.historyReopenedBy.replace("{name}", item.reopenedBy.displayName).replace("{date}", when(item.reopenedAt))}</p>
        <p>{item.text}</p>
      </div>)}
    </section>}
  </section>;
}

function ReadOnlyManualInsights({ insights }: { insights: HistoryRecordResponse["manualInsights"] }) {
  return <section className="evidence-manual-insights" aria-labelledby="history-manual-insights-heading">
    <h4 id="history-manual-insights-heading">{fr.insights.manualHeading}</h4>
    {insights.length === 0 ? <p className="state-message">{fr.history.noManualInsights}</p> : <ul className="insight-list">{insights.map((insight) => <li className="insight-item manual-insight-item" key={insight.id}>
      <p>{insight.text}</p>
      {insight.justification !== null && <p>{fr.insights.manualJustificationLabel} : {insight.justification}</p>}
      <p className="insight-state">{fr.insights.manualLabel}</p>
      <p className="insight-decided">{fr.insights.addedBy.replace("{name}", insight.author.displayName).replace("{date}", when(insight.createdAt))}</p>
    </li>)}</ul>}
  </section>;
}

function ReadOnlyDecision({ record }: { record: HistoryRecordResponse }) {
  const { conformityDecision: decision, conformityHistory } = record;
  return <section className="evidence-conformity" aria-labelledby="history-conformity-heading">
    <h3 id="history-conformity-heading">{fr.conformity.heading}</h3>
    <p className="insight-decided">{fill(fr.conformity.decided, { label: outcomeLabel(decision.outcome), name: decision.decidedBy.displayName, date: when(decision.decidedAt) })}</p>
    {conformityHistory.length > 0 && <section className="conformity-history" aria-labelledby="history-conformity-history-heading">
      <h4 id="history-conformity-history-heading">{fr.conformity.historyHeading}</h4>
      {conformityHistory.map((item) => <p className="insight-item conformity-history-item" key={item.id}>
        {fill(fr.conformity.historyItem, { label: outcomeLabel(item.outcome), n: String(item.summaryVersion), name: item.decidedBy.displayName, date: when(item.decidedAt) })}
      </p>)}
    </section>}
  </section>;
}

export type OfficialDownloadState = { pending: boolean; message: string | null };

function OfficialReportBlock({ record, download, onDownload }: { record: HistoryRecordResponse; download: OfficialDownloadState; onDownload: () => void }) {
  const report = record.officialReport;
  const size = (report.file.byteSize / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return <section className="evidence-report history-official-report" aria-labelledby="history-report-heading">
    <h3 id="history-report-heading">{fr.history.officialReport.heading}</h3>
    {download.message && <p className="field-error" role="alert">{download.message}</p>}
    <ul className="report-candidate-list">
      <li>{fill(fr.history.officialReport.origin, { origin: originLabel(report.origin) })}</li>
      <li>{fill(fr.history.officialReport.designatedBy, { name: report.designatedBy.displayName, date: when(report.designatedAt) })}</li>
      <li>{fill(fr.history.officialReport.fileName, { name: report.file.name })}</li>
      <li>{fill(fr.history.officialReport.fileSize, { size })}</li>
      <li>{fill(fr.history.officialReport.fileHash, { hash: `${report.file.sha256.slice(0, 12)}…` })}</li>
      <li>{fill(fr.history.officialReport.outcome, { label: outcomeLabel(report.bindings.conformityOutcome) })}</li>
    </ul>
    <button className="primary-button" type="button" disabled={download.pending} aria-busy={download.pending} onClick={onDownload}>{download.pending ? fr.history.downloading : fr.history.download}</button>
  </section>;
}

export type HistoryRecordViewProps = {
  taskId: string;
  /** `undefined` while the request is in flight. */
  load: HistoryRecordLoad | undefined;
  download?: OfficialDownloadState;
  onBack: () => void;
  onRetry: () => void;
  onDownload?: () => void;
  onOpenRelated?: (taskId: string) => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
};

/** Read-only completed record. It has no editing, replacement, designation or approval control: only download, back and (on a failure) retry. */
export function HistoryRecordView({ taskId, load, download = { pending: false, message: null }, onBack, onRetry, onDownload, onOpenRelated, headingRef }: HistoryRecordViewProps) {
  const heading = <h2 id="history-record-heading" tabIndex={-1} ref={headingRef}>{fr.history.recordHeading} — {fr.tasks.taskId} : {taskId}</h2>;
  let content: React.ReactNode;
  if (!load) content = <div className="state-message" role="status">{fr.common.loading}</div>;
  else if (load.kind === "ready") {
    const { record } = load;
    const context = [
      record.task.establishment, record.task.service, record.task.assignee,
      fr.evidence.submittedBy.replace("{displayName}", record.submission.submittedBy.displayName),
      fr.evidence.acceptedAt.replace("{date}", when(record.submission.acceptedAt)),
      fr.evidence.revision.replace("{revision}", String(record.submission.revision)),
    ];
    content = <>
      <p className="evidence-context">{context.filter((part) => part.trim() !== "").join(" · ")}</p>
      <EvidenceInputSections values={record.values} />
      <GraphieCalculationReview evidence={{ identity: record.identity, values: record.values, results: record.results as unknown as GraphieCalculationResults }} />
      <InsightProposalsSection insights={record.insights} decisions={record.insightDecisions} manualInsightCount={record.manualInsights.length} locked />
      <ReadOnlyManualInsights insights={record.manualInsights} />
      <ReadOnlySummary record={record} />
      <ReadOnlyDecision record={record} />
      <OfficialReportBlock record={record} download={download} onDownload={() => onDownload?.()} />
      {record.lineage.length > 0 && <section className="evidence-lineage-section" aria-labelledby="history-lineage-heading">
        <h3 id="history-lineage-heading">{fr.history.lineageHeading}</h3>
        <HistoryLineageLines lineage={record.lineage} {...(onOpenRelated ? { onOpen: onOpenRelated } : {})} />
      </section>}
    </>;
  } else if (load.kind === "not-found") content = <div className="state-message error-state" role="alert">{fr.history.recordUnavailable}</div>;
  else content = <div className="state-message error-state" role="alert">{load.kind === "unavailable" ? fr.api.unavailable : fr.history.recordLoadFailed}<button className="text-button" type="button" onClick={onRetry}>{fr.common.retry}</button></div>;
  return <section className="roster-card evidence-panel history-record" aria-labelledby="history-record-heading">
    <div className="card-heading">{heading}</div>
    {content}
    <div className="task-form-actions"><button className="secondary-button" type="button" disabled={download.pending} onClick={onBack}>{fr.history.back}</button></div>
  </section>;
}

/** Loads one completed record, moves focus to its heading and owns the download request state. */
export function HistoryRecordPanel({ taskId, onBack, onOpenRelated }: { taskId: string; onBack: () => void; onOpenRelated: (taskId: string) => void }) {
  const [load, setLoad] = useState<HistoryRecordLoad>();
  const [attempt, setAttempt] = useState(0);
  const [download, setDownload] = useState<OfficialDownloadState>({ pending: false, message: null });
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [taskId]);
  useEffect(() => {
    let current = true;
    setLoad(undefined);
    setDownload({ pending: false, message: null });
    void loadHistoryRecord(taskId).then((result) => { if (current) setLoad(result); });
    return () => { current = false; };
  }, [taskId, attempt]);
  const onDownload = () => {
    if (download.pending) return;
    setDownload({ pending: true, message: null });
    void downloadOfficialReportFile(taskId).then((result) => {
      setDownload({ pending: false, message: result.kind === "saved" ? null : downloadMessages[result.kind] });
    });
  };
  return <HistoryRecordView taskId={taskId} load={load} download={download} headingRef={headingRef} onBack={onBack} onRetry={() => setAttempt((count) => count + 1)} onDownload={onDownload} onOpenRelated={onOpenRelated} />;
}

/** The H1 « Historique » section of the Responsable: the list, and the read-only record of the selected control under it. */
export function HistoryPanel() {
  const [load, setLoad] = useState<HistoryListLoad>();
  const [openTaskId, setOpenTaskId] = useState<string>();
  const reload = useCallback(async () => {
    setLoad(undefined);
    setLoad(await loadHistoryList());
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return <>
    <HistoryListView load={load} openTaskId={openTaskId} onRetry={() => void reload()} onOpen={(taskId) => setOpenTaskId(taskId === openTaskId ? undefined : taskId)} />
    {openTaskId && <HistoryRecordPanel key={openTaskId} taskId={openTaskId} onOpenRelated={setOpenTaskId} onBack={() => {
      const closing = openTaskId;
      setOpenTaskId(undefined);
      // The opening button stays rendered in the list, so focus can return to it at once.
      document.getElementById(`history-open-${closing}`)?.focus();
    }} />}
  </>;
}
