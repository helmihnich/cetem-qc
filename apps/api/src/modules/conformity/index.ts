// Public surface of the conformity module.
export { recordConformityDecision } from "./commands/record-conformity-decision.js";
export type { RecordConformityDecisionOutcome } from "./commands/record-conformity-decision.js";
export { getCurrentConformityDecision, getConformityHistory } from "./queries/conformity-decision.js";
export type { ConformityDecision, ConformityHistoryItem, ConformityOutcome } from "./queries/conformity-decision.js";
export { conformityReopenParticipant, registerConformityReopenParticipant } from "./reopen-participant.js";
