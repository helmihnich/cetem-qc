import { registerSummaryReopenParticipant, listSummaryReopenParticipants } from "../summaries/index.js";
import type { SummaryReopenParticipant } from "../summaries/index.js";

/**
 * Makes the decision bound to a reopened summary historical by inserting an invalidation row in the reopening
 * transaction. Official designation belongs to reports (Epic 11), so this participant never vetoes.
 */
export const conformityReopenParticipant: SummaryReopenParticipant = {
  name: "conformity",
  hasOfficialDesignation: async () => false,
  async onSummaryReopened(transaction, context) {
    await transaction.query(
      `INSERT INTO conformity_decision_invalidations (decision_id, reopened_summary_id, invalidated_by, invalidated_at)
       SELECT decision.id, decision.confirmed_summary_id, $2::uuid, $3::timestamptz
       FROM conformity_decisions decision WHERE decision.confirmed_summary_id = $1`,
      [context.reopenedSummaryId, context.actorId, context.reopenedAt],
    );
  },
};

/** Registers the conformity participant unless a participant of that name is already registered (idempotent). */
export function registerConformityReopenParticipant(): void {
  if (listSummaryReopenParticipants().some((existing) => existing.name === conformityReopenParticipant.name)) return;
  registerSummaryReopenParticipant(conformityReopenParticipant);
}
