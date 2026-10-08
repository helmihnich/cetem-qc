import type { ReportDocument } from "@cetem-qc/i18n/report-document";

/** Renders the renderer-neutral report document to a file (AD-9 port; adapter `word-template`). */
export interface ReportDocumentGenerator {
  templateId: string;
  templateVersion: string;
  generate(document: ReportDocument): Promise<{ bytes: Uint8Array }>;
}
