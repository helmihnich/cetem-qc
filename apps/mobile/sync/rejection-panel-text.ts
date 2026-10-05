import { fr } from "@cetem-qc/i18n";
import { localDateTime } from "./conflict-panel-text";
import { GRAPHIE_FIELD_LABELS } from "./conflict-diff";
import type { RejectionIssue } from "./task-sync-state";

const FIELD_PATH_PREFIX = "values.";
const catalogueOrder = new Map(GRAPHIE_FIELD_LABELS.map((entry, index) => [entry.fieldId, index]));
const labelOf = new Map(GRAPHIE_FIELD_LABELS.map((entry) => [entry.fieldId, entry.labelFr]));

const own = (texts: Record<string, string>, key: string) => Object.prototype.hasOwnProperty.call(texts, key) ? texts[key] : undefined;

/** The French message of a stored rejection code; a missing or unknown code gets the generic message. */
export function rejectionCodeMessage(code: string | null): string {
  return (code === null ? undefined : own(fr.employeeTasks.rejectionCodes, code)) ?? fr.employeeTasks.rejectionCodeUnknown;
}

/** The French text of a structural issue code; an unknown code gets the generic text. */
export function issueCodeText(code: string): string {
  return own(fr.employeeTasks.issueCodes, code) ?? fr.employeeTasks.issueCodeUnknown;
}

/** The catalogue field an issue path names (`values.<fieldId>`), or undefined for a form-level or unknown path. */
export function issueFieldId(path: string): string | undefined {
  if (!path.startsWith(FIELD_PATH_PREFIX)) return undefined;
  const fieldId = path.slice(FIELD_PATH_PREFIX.length);
  return labelOf.has(fieldId) ? fieldId : undefined;
}

export type IssueLine = { fieldId: string | undefined; labelFr: string; textFr: string };

/**
 * One line per stored issue: the field named « section › champ » (table cells « section › ligne — champ »)
 * or « Formulaire », and the French issue text. Field lines come in catalogue order, then form-level lines;
 * duplicates are merged. Values are never part of an issue, so they are never shown.
 */
export function rejectionIssueLines(issues: readonly RejectionIssue[]): IssueLine[] {
  const lines: (IssueLine & { order: number })[] = [];
  for (const issue of issues) {
    const fieldId = issueFieldId(issue.path);
    const line = {
      fieldId,
      labelFr: fieldId ? labelOf.get(fieldId)! : fr.employeeTasks.issueFormLevel,
      textFr: issueCodeText(issue.code),
      order: fieldId ? catalogueOrder.get(fieldId)! : Number.MAX_SAFE_INTEGER,
    };
    if (!lines.some((existing) => existing.labelFr === line.labelFr && existing.textFr === line.textFr)) lines.push(line);
  }
  return lines.sort((a, b) => a.order - b.order).map(({ fieldId, labelFr, textFr }) => ({ fieldId, labelFr, textFr }));
}

/** The issue texts per catalogue field, shown as field error text on the correction draft. */
export function fieldIssueTexts(issues: readonly RejectionIssue[]): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const line of rejectionIssueLines(issues)) {
    if (line.fieldId) texts[line.fieldId] = texts[line.fieldId] ? `${texts[line.fieldId]} ; ${line.textFr}` : line.textFr;
  }
  return texts;
}

/** « Correction de la soumission refusée le JJ/MM/AAAA à HH:MM » (device time); undefined for an invalid date. */
export function correctionLinkLine(rejectedAt: number): string | undefined {
  const at = localDateTime(rejectedAt);
  return at ? fr.employeeTasks.correctionOf.replace("{date}", at.date).replace("{time}", at.time) : undefined;
}
