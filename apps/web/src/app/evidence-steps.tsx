import { fr } from "@cetem-qc/i18n";
import { Icon } from "./icons";

export type EvidenceStepId = "inputs" | "calculations" | "insights" | "summary" | "decision" | "report";

/** Which workflow steps are complete, derived only from data the panel already holds. Inputs and calculations are always complete once accepted. */
export type EvidenceProgress = { insights: boolean; summary: boolean; decision: boolean; report: boolean };

const STEPS: { id: EvidenceStepId; label: string }[] = [
  { id: "inputs", label: fr.shell.steps.inputs },
  { id: "calculations", label: fr.shell.steps.calculations },
  { id: "insights", label: fr.shell.steps.insights },
  { id: "summary", label: fr.shell.steps.summary },
  { id: "decision", label: fr.shell.steps.decision },
  { id: "report", label: fr.shell.steps.report },
];

/**
 * In-panel navigation of the long evidence record: one jump link per workflow section, in page order.
 * With `progress` each link also shows whether its step is done, next, or still ahead. Purely navigational: no control acts on the record.
 */
export function EvidenceSteps({ targets, progress }: { targets: Record<EvidenceStepId, string>; progress?: EvidenceProgress }) {
  const done: Record<EvidenceStepId, boolean> = { inputs: true, calculations: true, insights: false, summary: false, decision: false, report: false, ...progress };
  const current = progress ? STEPS.find((step) => !done[step.id])?.id : undefined;
  return <nav className="evidence-steps" aria-label={fr.shell.steps.label}>
    <ol>{STEPS.map((step, index) => {
      const state = !progress ? "plain" : done[step.id] ? "done" : step.id === current ? "current" : "upcoming";
      const status = state === "done" ? fr.shell.steps.done : state === "current" ? fr.shell.steps.current : state === "upcoming" ? fr.shell.steps.upcoming : null;
      return <li key={step.id} className={`evidence-step evidence-step-${state}`}>
        <a href={`#${targets[step.id]}`} aria-current={state === "current" ? "step" : undefined}>
          <span className="evidence-step-marker" aria-hidden="true">{state === "done" ? <Icon name="check" size={12} strokeWidth={2.6} /> : index + 1}</span>
          <span className="evidence-step-label">{step.label}</span>
          {status && <span className="visually-hidden"> ({status})</span>}
        </a>
      </li>;
    })}</ol>
  </nav>;
}

export const ACCEPTED_EVIDENCE_TARGETS: Record<EvidenceStepId, string> = {
  inputs: "evidence-input-heading", calculations: "calculation-review-heading", insights: "evidence-insights-heading",
  summary: "evidence-summary-heading", decision: "evidence-conformity-heading", report: "evidence-report-heading",
};

export const HISTORY_RECORD_TARGETS: Record<EvidenceStepId, string> = {
  inputs: "evidence-input-heading", calculations: "calculation-review-heading", insights: "evidence-insights-heading",
  summary: "history-summary-heading", decision: "history-conformity-heading", report: "history-report-heading",
};
