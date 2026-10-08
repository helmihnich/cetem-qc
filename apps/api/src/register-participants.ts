import { registerConformityReopenParticipant } from "./modules/conformity/index.js";
import { registerReportsReopenParticipant } from "./modules/reports/index.js";

/**
 * Application start-up: registers the modules that take part in a summary reopening. Idempotent, because the registry
 * is process-global and tests build several apps.
 */
export function registerDefaultSummaryReopenParticipants(): void {
  registerConformityReopenParticipant();
  registerReportsReopenParticipant();
}
