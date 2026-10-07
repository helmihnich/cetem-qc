import assert from "node:assert/strict";
import test from "node:test";
import { selectRetainedInsights } from "./insight-decisions.js";
import type { CurrentInsightDecision } from "./insight-decisions.js";
import type { InsightProposal } from "./insight-rules.js";

const SUBMISSION = "00000000-0000-4000-8000-000000000401";
const proposal = (name: string): InsightProposal => ({
  proposalId: `${name}:v1:${SUBMISSION}:field=x`, ruleId: name, ruleVersion: 1, approvalReference: "Document synthétique 2026", registryVersion: "insight-registry-1",
  submissionId: SUBMISSION, sourceKeys: [{ kind: "field", key: "header.reportNumber" }], statement: `Texte ${name}.`, origin: "deterministic",
});
const decide = (name: string, decision: CurrentInsightDecision["decision"]): CurrentInsightDecision => ({
  proposalId: proposal(name).proposalId, decision, decidedAt: "2026-10-08T09:00:00.000Z", decidedBy: { id: "r1", displayName: "Responsable Test" },
});
const deepFreeze = <T,>(value: T): T => {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

test("D1 selectRetainedInsights returns only retained proposals in proposal order", () => {
  const proposals = [proposal("a"), proposal("b"), proposal("c")];
  const retained = selectRetainedInsights(proposals, [decide("c", "retained"), decide("a", "retained"), decide("b", "discarded")]);
  assert.deepEqual(retained.map((item) => item.ruleId), ["a", "c"]);
});

test("D2 discarded, undecided and unmatched decisions contribute nothing, and no discarded text leaks", () => {
  const proposals = [proposal("a"), proposal("b"), proposal("c")];
  const retained = selectRetainedInsights(proposals, [decide("a", "retained"), decide("b", "discarded"), decide("ghost", "retained")]);
  assert.deepEqual(retained, [proposal("a")]);
  const serialized = JSON.stringify(retained);
  assert.ok(!serialized.includes("Texte b.") && !serialized.includes("Texte c.") && !serialized.includes("ghost"));
});

test("D3 no proposals or nothing retained returns [] and the input is not mutated", () => {
  assert.deepEqual(selectRetainedInsights([], [decide("a", "retained")]), []);
  const proposals = deepFreeze([proposal("a"), proposal("b")]);
  const decisions = deepFreeze([decide("a", "discarded")]);
  assert.deepEqual(selectRetainedInsights(proposals, decisions), []);
  assert.deepEqual(selectRetainedInsights(proposals, []), []);
});
