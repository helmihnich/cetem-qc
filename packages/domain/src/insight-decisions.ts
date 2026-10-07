import type { InsightProposal } from "./insight-rules.js";

export type InsightDecisionValue = "retained" | "discarded";

export interface CurrentInsightDecision {
  proposalId: string;
  decision: InsightDecisionValue;
  decidedAt: string;
  decidedBy: { id: string; displayName: string };
}

/**
 * The proposals the Responsable explicitly retained, in proposal order. Discarded and undecided proposals, and
 * decisions without a matching proposal, contribute nothing. An empty result is valid and never blocks a summary.
 */
export function selectRetainedInsights(proposals: readonly InsightProposal[], decisions: readonly CurrentInsightDecision[]): InsightProposal[] {
  const retained = new Set(decisions.filter((decision) => decision.decision === "retained").map((decision) => decision.proposalId));
  return proposals.filter((proposal) => retained.has(proposal.proposalId));
}
