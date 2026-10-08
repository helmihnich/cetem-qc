import { SummaryProviderError } from "./ports/summary-draft-provider.js";
import type { SummaryDraftProvider } from "./ports/summary-draft-provider.js";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Google Gemini `generateContent`. The key goes in the `x-goog-api-key` header only. A failure is mapped to a fixed
 * class; the response body, the prompt and the key never enter an error.
 */
export function createGeminiSummaryProvider(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): SummaryDraftProvider {
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const apiKey = env.GEMINI_API_KEY?.trim();
  return {
    name: "gemini",
    model,
    async generate(prompt, { signal }) {
      if (!apiKey) throw new SummaryProviderError("not-configured");
      let response: Response;
      try {
        response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal,
        });
      } catch {
        throw new SummaryProviderError(signal.aborted ? "timeout" : "provider-error");
      }
      if (!response.ok) throw new SummaryProviderError("provider-error");
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new SummaryProviderError(signal.aborted ? "timeout" : "provider-error");
      }
      const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> } | null)?.candidates?.[0]?.content?.parts;
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new SummaryProviderError("provider-error");
      const text = Array.isArray(parts) ? parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("").trim() : "";
      if (text === "") throw new SummaryProviderError("empty-output");
      return text;
    },
  };
}
