// Public surface of the reports module (Story 11.1: Word report candidates only; nothing here designates a report official).
export { generateReportCandidate, reportCommandTestSeams } from "./commands/generate-report-candidate.js";
export type { GenerateReportCandidateDeps, GenerateReportCandidateOutcome } from "./commands/generate-report-candidate.js";
export { attachPdfReportCandidate } from "./commands/attach-pdf-report-candidate.js";
export type { AttachPdfReportCandidateDeps, AttachPdfReportCandidateOutcome } from "./commands/attach-pdf-report-candidate.js";
export { getReportCandidateFile, listReportCandidates } from "./queries/report-candidates.js";
export type { ReportCandidate, ReportCandidateFile, ReportCandidateStatus, ReportFailureClass, ReportOrigin } from "./queries/report-candidates.js";
export type { ReportDocumentGenerator } from "./ports/report-document-generator.js";
export { createWordTemplateGenerator } from "./adapters/word-template.js";
