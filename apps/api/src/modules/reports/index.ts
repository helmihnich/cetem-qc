// Public surface of the reports module (Stories 11.1-11.4: report candidates and the single official designation).
export { generateReportCandidate, reportCommandTestSeams } from "./commands/generate-report-candidate.js";
export type { GenerateReportCandidateDeps, GenerateReportCandidateOutcome } from "./commands/generate-report-candidate.js";
export { attachPdfReportCandidate } from "./commands/attach-pdf-report-candidate.js";
export type { AttachPdfReportCandidateDeps, AttachPdfReportCandidateOutcome } from "./commands/attach-pdf-report-candidate.js";
export { getReportCandidateFile, listReportCandidates } from "./queries/report-candidates.js";
export type { ReportCandidate, ReportCandidateFile, ReportCandidateStatus, ReportFailureClass, ReportOrigin } from "./queries/report-candidates.js";
export type { ReportDocumentGenerator } from "./ports/report-document-generator.js";
export { createWordTemplateGenerator } from "./adapters/word-template.js";
export { designateReportCandidate } from "./commands/designate-report-candidate.js";
export type { DesignateReportCandidateDeps, DesignateReportCandidateOutcome } from "./commands/designate-report-candidate.js";
export { getOfficialReport, getOfficialReportFile, listCompletedTaskIds, listOfficialReports } from "./queries/official-report.js";
export type { OfficialReport, OfficialReportFile } from "./queries/official-report.js";
export { registerReportsReopenParticipant, reportsReopenParticipant } from "./reopen-participant.js";
