import { registerConformityReopenParticipant } from "./modules/conformity/index.js";

/**
 * Application start-up: registers the modules that take part in a summary reopening. Idempotent, because the registry
 * is process-global and tests build several apps. Story 11.x adds the report participant here.
 */
export function registerDefaultSummaryReopenParticipants(): void {
  registerConformityReopenParticipant();
}
