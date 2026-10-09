import { buildSummaryDemoDraft } from "@cetem-qc/domain";
import { fr } from "@cetem-qc/i18n";
import { normalizeDraftText } from "./draft-text.js";
import type { SummaryDraftProvider } from "./ports/summary-draft-provider.js";

/**
 * Default provider, no network and no account: a demonstration draft in the same five-part format as the AI draft,
 * built deterministically from the input set. Without an input set it returns the fixed French demonstration text.
 */
export function createMockSummaryProvider(): SummaryDraftProvider {
  return {
    name: "mock",
    model: "mock-fixed-text",
    async generate(_prompt, { inputSet }) {
      return inputSet ? normalizeDraftText(buildSummaryDemoDraft(inputSet)) : fr.summary.mockDraft;
    },
  };
}
