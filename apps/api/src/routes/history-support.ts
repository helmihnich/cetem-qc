import type { HistoryLineageRelation } from "@cetem-qc/schemas/api/v1";
import type { TaskAcceptanceAndLineage } from "../modules/audits/queries/task-audit-lineage.js";

export const PDF_MEDIA_TYPE = "application/pdf";
export const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The relations a task has, in display order, before the viewer's permissions are applied. */
export function lineageSeeds(lineage: TaskAcceptanceAndLineage): Array<{ relation: HistoryLineageRelation["relation"]; taskId: string; auditId: string | null }> {
  const seeds: Array<{ relation: HistoryLineageRelation["relation"]; taskId: string; auditId: string | null }> = [];
  if (lineage.replacementOf) seeds.push({ relation: "replacement-of", taskId: lineage.replacementOf, auditId: null });
  if (lineage.replacedBy) seeds.push({ relation: "replaced-by", taskId: lineage.replacedBy, auditId: null });
  if (lineage.recoverySource) seeds.push({ relation: "recovery-source", taskId: lineage.recoverySource.taskId, auditId: lineage.recoverySource.auditId });
  if (lineage.recoverySuccessorTaskId) seeds.push({ relation: "recovery-successor", taskId: lineage.recoverySuccessorTaskId, auditId: null });
  return seeds;
}

/**
 * Applies the viewer's permissions to the relations: ids and the completed flag only for a related task the viewer is
 * authorized for; otherwise the relation alone, with no id (no cross-team leak).
 */
export function resolveHistoryLineage(
  seeds: ReturnType<typeof lineageSeeds>,
  authorizedTaskIds: ReadonlySet<string>,
  auditIds: ReadonlyMap<string, string>,
  completedTaskIds: ReadonlySet<string>,
): HistoryLineageRelation[] {
  return seeds.map((seed) => authorizedTaskIds.has(seed.taskId)
    ? { relation: seed.relation, accessible: true, taskId: seed.taskId, auditId: seed.auditId ?? auditIds.get(seed.taskId) ?? null, completed: completedTaskIds.has(seed.taskId) }
    : { relation: seed.relation, accessible: false, taskId: null, auditId: null, completed: null });
}

/** Media type and attachment name of the official file: the stored name for Word, the official pattern for a PDF. */
export function officialDownloadIdentity(file: { origin: "generated-word" | "uploaded-pdf"; fileName: string; candidateId: string; designatedAt: Date }): { mediaType: string; fileName: string } {
  if (file.origin === "uploaded-pdf") {
    const day = file.designatedAt.toISOString().slice(0, 10).replaceAll("-", "");
    return { mediaType: PDF_MEDIA_TYPE, fileName: `Rapport-LCQ-officiel-${day}-${file.candidateId.replaceAll("-", "").slice(0, 8)}.pdf` };
  }
  return { mediaType: DOCX_MEDIA_TYPE, fileName: file.fileName };
}
