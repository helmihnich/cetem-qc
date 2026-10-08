import { listSummaryReopenParticipants, registerSummaryReopenParticipant } from "../summaries/index.js";
import type { SummaryReopenParticipant } from "../summaries/index.js";
import { hasOfficialReport } from "./queries/official-report.js";

/**
 * Closes the reopening contract of 10.3: a summary whose submission has an official report can no longer be reopened.
 * Candidate staleness is derived on every read, so nothing is written when a summary is reopened.
 */
export const reportsReopenParticipant: SummaryReopenParticipant = {
  name: "reports",
  hasOfficialDesignation: (transaction, context) => hasOfficialReport(transaction, context.taskId, context.submissionId),
  onSummaryReopened: async () => {},
};

/** Registers the reports participant unless one of that name is already registered (idempotent). */
export function registerReportsReopenParticipant(): void {
  if (listSummaryReopenParticipants().some((existing) => existing.name === reportsReopenParticipant.name)) return;
  registerSummaryReopenParticipant(reportsReopenParticipant);
}
