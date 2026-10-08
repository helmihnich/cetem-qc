export type SummaryFailureClass = "not-configured" | "timeout" | "provider-error" | "empty-output";

/** Technical bound for responsiveness, not a CETEM rule. */
export const AI_REQUEST_TIMEOUT_MS = 20000;

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
  /** Returns the non-empty draft text or throws `SummaryProviderError`. */
  generate(prompt: string, options: { signal: AbortSignal }): Promise<string>;
}
