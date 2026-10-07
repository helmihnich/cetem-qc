"use client";

import { useEffect, useRef, useState } from "react";
import { acceptedEvidenceResponseSchema } from "@cetem-qc/api-client/v1";
import type { AcceptedEvidenceResponse } from "@cetem-qc/api-client/v1";
import { GRAPHIE_CALCULATION_FIELD_ID_LIST, GRAPHIE_MOBILE_POV_CATALOGUE } from "@cetem-qc/domain";
import type { CatalogueField, CatalogueSection, GraphieCalculationResults } from "@cetem-qc/domain";
import { fr } from "@cetem-qc/i18n";
import { GraphieCalculationReview } from "./graphie-calculation-review";

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

/** Read-only W5 slot: renders the proposal set exactly as received. It never evaluates and offers no decision control (9.3). */
export function InsightProposalsSection({ insights }: { insights: AcceptedEvidenceResponse["insights"] }) {
  let content: React.ReactNode;
  if (insights.status === "unavailable") content = <p className="state-message">{fr.insights.unavailable}</p>;
  else if (insights.proposals.length === 0) content = <p className="state-message">{fr.insights.none}</p>;
  else content = <ul className="insight-list">{insights.proposals.map((proposal) => <li className="insight-item" key={proposal.proposalId}>
    <p>{proposal.statement}</p>
    <p>{fr.insights.rule.replace("{ruleId}", proposal.ruleId).replace("{ruleVersion}", String(proposal.ruleVersion))}</p>
    <p>{fr.insights.approval.replace("{approvalReference}", proposal.approvalReference)}</p>
    <p>{fr.insights.sources.replace("{sources}", proposal.sourceKeys.map(sourceLabelOf).join(", "))}</p>
  </li>)}</ul>;
  return <section className="evidence-insights" aria-labelledby="evidence-insights-heading">
    <h3 id="evidence-insights-heading">{fr.insights.heading}</h3>
    {content}
  </section>;
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
      <InsightProposalsSection insights={evidence.insights} />
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
