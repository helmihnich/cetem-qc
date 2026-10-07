import assert from "node:assert/strict";
import test from "node:test";
import type { CurrentInsightDecision } from "./insight-decisions.js";
import type { InsightProposal } from "./insight-rules.js";
import { collectRetainedInsights } from "./manual-insights.js";
import type { ManualInsight } from "./manual-insights.js";

const SUBMISSION = "00000000-0000-4000-8000-000000000501";
const proposal = (name: string): InsightProposal => ({
  proposalId: `${name}:v1:${SUBMISSION}:field=x`, ruleId: name, ruleVersion: 1, approvalReference: "Document synthétique 2026", registryVersion: "insight-registry-1",
  submissionId: SUBMISSION, sourceKeys: [{ kind: "field", key: "header.reportNumber" }], statement: `Texte ${name}.`, origin: "deterministic",
});
const decide = (name: string, decision: CurrentInsightDecision["decision"]): CurrentInsightDecision => ({
  proposalId: proposal(name).proposalId, decision, decidedAt: "2026-10-08T09:00:00.000Z", decidedBy: { id: "r1", displayName: "Responsable Test" },
});
const manual = (name: string): ManualInsight => ({
  id: `00000000-0000-4000-8000-0000000006${name.length}${name.charCodeAt(0)}`.slice(0, 36), text: `Manuel ${name}.`, justification: null, sourceType: "manual",
  createdAt: "2026-10-08T09:00:00.000Z", author: { id: "r1", displayName: "Responsable Test" },
});
const deepFreeze = <T,>(value: T): T => {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

test("D1 collectRetainedInsights returns retained proposals then manual insights with their source type", () => {
  const retained = collectRetainedInsights([proposal("a"), proposal("b"), proposal("c")], [decide("c", "retained"), decide("a", "retained")], [manual("x"), manual("y")]);
  assert.deepEqual(retained.map((item) => item.sourceType), ["rule", "rule", "manual", "manual"]);
  assert.deepEqual(retained.map((item) => item.sourceType === "rule" ? item.proposal.ruleId : item.insight.text), ["a", "c", "Manuel x.", "Manuel y."]);
});

test("D2 discarded and undecided proposal content is absent", () => {
  const retained = collectRetainedInsights([proposal("a"), proposal("b"), proposal("c")], [decide("a", "retained"), decide("b", "discarded")], [manual("x")]);
  const serialized = JSON.stringify(retained);
  assert.ok(!serialized.includes("Texte b.") && !serialized.includes("Texte c."));
  assert.ok(serialized.includes("Texte a.") && serialized.includes("Manuel x."));
});

test("D3 nothing retained and no manual insight returns []; manual insights alone are non-empty; input is not mutated", () => {
  const proposals = deepFreeze([proposal("a")]);
  const decisions = deepFreeze([decide("a", "discarded")]);
  assert.deepEqual(collectRetainedInsights(proposals, decisions, deepFreeze([])), []);
  assert.deepEqual(collectRetainedInsights([], [], []), []);
  const alone = collectRetainedInsights(proposals, [], deepFreeze([manual("x")]));
  assert.equal(alone.length, 1);
  assert.equal(alone[0]!.sourceType, "manual");
});
