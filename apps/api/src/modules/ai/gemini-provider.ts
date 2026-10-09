import { SUMMARY_SYSTEM_INSTRUCTION } from "@cetem-qc/domain";
import { normalizeDraftText } from "./draft-text.js";
import { SummaryProviderError } from "./ports/summary-draft-provider.js";
import type { SummaryDraftProvider } from "./ports/summary-draft-provider.js";

/** Stable alias of Google's current Flash model (`gemini-2.5-flash` is closed to new API users). */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

/**
 * Generation settings for a factual technical summary: low temperature for faithful wording, and an output budget
 * large enough for the draft plus any model reasoning (300 words of French is far below it).
 */
export const GEMINI_GENERATION_CONFIG = { temperature: 0.2, topP: 0.8, maxOutputTokens: 4096, responseMimeType: "text/plain" } as const;

/** The exact `generateContent` body: system instruction (role and standing rules), the prompt, and the generation settings. */
export function geminiRequestBody(prompt: string) {
  return {
    systemInstruction: { parts: [{ text: SUMMARY_SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: GEMINI_GENERATION_CONFIG,
  };
}

/**
 * Google Gemini `generateContent`. The key goes in the `x-goog-api-key` header only. A failure is mapped to a fixed
 * class; the response body, the prompt and the key never enter an error. The text is cleaned of Markdown markers and
 * clamped to the summary length limit.
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
          body: JSON.stringify(geminiRequestBody(prompt)),
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
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new SummaryProviderError("provider-error");
      const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }> }).candidates?.[0]?.content?.parts;
      // Reasoning parts (`thought: true`) are never part of the draft.
      const text = Array.isArray(parts) ? parts.map((part) => (typeof part?.text === "string" && part.thought !== true ? part.text : "")).join("") : "";
      const cleaned = normalizeDraftText(text);
      if (cleaned === "") throw new SummaryProviderError("empty-output");
      return cleaned;
    },
  };
}
