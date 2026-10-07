import type { CurrentInsightDecision } from "./insight-decisions.js";
import { selectRetainedInsights } from "./insight-decisions.js";
import type { InsightProposal } from "./insight-rules.js";

/** Technical bounds (abuse and layout), not CETEM rules. The migration checks are kept in step by a test. */
export const MANUAL_INSIGHT_TEXT_MAX = 1000;
export const MANUAL_INSIGHT_JUSTIFICATION_MAX = 1000;

export interface ManualInsight {
  id: string;
  text: string;
  justification: string | null;
  sourceType: "manual";
  createdAt: string;
  author: { id: string; displayName: string };
}

export type RetainedInsight =
  | { sourceType: "rule"; proposal: InsightProposal }
  | { sourceType: "manual"; insight: ManualInsight };

/**
 * The single retained set a summary reads: retained proposals first (proposal order), then every manual insight
 * (given order). Discarded and undecided proposal content is absent. An empty result is valid.
 */
export function collectRetainedInsights(
  proposals: readonly InsightProposal[], decisions: readonly CurrentInsightDecision[], manualInsights: readonly ManualInsight[],
): RetainedInsight[] {
  return [
    ...selectRetainedInsights(proposals, decisions).map((proposal): RetainedInsight => ({ sourceType: "rule", proposal })),
    ...manualInsights.map((insight): RetainedInsight => ({ sourceType: "manual", insight })),
  ];
}
