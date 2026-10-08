import { createGeminiSummaryProvider } from "./gemini-provider.js";
import { createMockSummaryProvider } from "./mock-provider.js";
import type { SummaryDraftProvider } from "./ports/summary-draft-provider.js";

export { AI_REQUEST_TIMEOUT_MS, SummaryProviderError } from "./ports/summary-draft-provider.js";
export type { SummaryDraftProvider, SummaryFailureClass } from "./ports/summary-draft-provider.js";

/**
 * `AI_PROVIDER` unset, empty or `mock` selects the mock (default, no network); `gemini` selects Google Gemini.
 * Any other value falls back to the mock with one warning that does not repeat the value.
 */
export function createSummaryDraftProvider(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): SummaryDraftProvider {
  const selected = env.AI_PROVIDER?.trim() ?? "";
  if (selected === "gemini") return createGeminiSummaryProvider(env, fetchImpl);
  if (selected !== "" && selected !== "mock") console.warn(JSON.stringify({ event: "ai.provider_unknown_fallback" }));
  return createMockSummaryProvider();
}
