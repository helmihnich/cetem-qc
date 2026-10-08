import type { PoolClient } from "pg";

/**
 * How other modules (conformity decision in 10.4, report candidates and designation in 11.x) take part in a reopening
 * without `summaries` reading their tables. Participants run in the reopening transaction and use only their own
 * module's tables. Their records bind to the confirmed summary `id` and are current only while it equals
 * `getConfirmedSummary(...).id`.
 */
export interface SummaryReopenParticipant {
  name: string;
  /** True when an official report is designated for the submission: the summary can then no longer be reopened. */
  hasOfficialDesignation(transaction: PoolClient, context: { taskId: string; submissionId: string }): Promise<boolean>;
  /** Called after the reopening row is inserted, in registration order; a throw rolls the whole reopening back. */
  onSummaryReopened(
    transaction: PoolClient,
    context: { taskId: string; submissionId: string; reopenedSummaryId: string; reopenedAt: string; actorId: string },
  ): Promise<void>;
}

const participants: SummaryReopenParticipant[] = [];

/** Registers a participant at module start-up. A duplicate name throws. */
export function registerSummaryReopenParticipant(participant: SummaryReopenParticipant): void {
  if (participants.some((existing) => existing.name === participant.name)) {
    throw new Error(`Summary reopen participant already registered: ${participant.name}`);
  }
  participants.push(participant);
}

export function listSummaryReopenParticipants(): readonly SummaryReopenParticipant[] {
  return participants;
}

/** Test-only seam: installs or clears synthetic participants. Never used in production. */
export const summaryReopenParticipantTestSeams = {
  clear(): void {
    participants.length = 0;
  },
};
