import type { SummaryInputSet } from "@cetem-qc/domain";

export type SummaryFailureClass = "not-configured" | "timeout" | "provider-error" | "empty-output";

/**
 * Technical bound for responsiveness, not a CETEM rule. Current Flash models may reason before answering a
 * five-part draft, which can exceed 20 s under load; 30 s stays well inside the web route's request lifetime.
 */
export const AI_REQUEST_TIMEOUT_MS = 30000;

/** A provider failure. It carries a fixed class only: never the provider's text, the prompt or a key. */
export class SummaryProviderError extends Error {
  constructor(readonly failureClass: SummaryFailureClass) {
    super(failureClass);
    this.name = "SummaryProviderError";
  }
}

export interface SummaryDraftProvider {
  readonly name: string;
  readonly model: string;
  /**
   * Returns the non-empty draft text or throws `SummaryProviderError`. `inputSet` is the exact set the prompt was
   * built from; an external provider receives the prompt only.
   */
  generate(prompt: string, options: { signal: AbortSignal; inputSet?: SummaryInputSet }): Promise<string>;
}
