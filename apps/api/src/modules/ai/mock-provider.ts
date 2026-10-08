import { fr } from "@cetem-qc/i18n";
import type { SummaryDraftProvider } from "./ports/summary-draft-provider.js";

/** Default provider: a fixed French demonstration text, no network and no account. */
export function createMockSummaryProvider(): SummaryDraftProvider {
  return {
    name: "mock",
    model: "mock-fixed-text",
    async generate() {
      return fr.summary.mockDraft;
    },
  };
}
