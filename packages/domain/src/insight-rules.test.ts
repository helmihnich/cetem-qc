import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "./graphie-identity.js";
import { calculateGraphieResults } from "./graphie-inputs.js";
import { INSIGHT_REGISTRY_VERSION, INSIGHT_RULE_REGISTRY, evaluateInsightProposals, validateInsightRegistry } from "./insight-rules.js";
import type { InsightInput, InsightRule, InsightSourceKey } from "./insight-rules.js";

// Story 9.2: synthetic rules are built here and passed as the registry argument; they are never exported.
const SUBMISSION = "00000000-0000-4000-8000-000000000301";
const values = { "header.reportNumber": "R-091", "equipment.tube.brand": "Marque T" };
const input = (): InsightInput => ({ submissionId: SUBMISSION, identity: GRAPHIE_CALCULATION_IDENTITY, values, results: calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, values) });
const field = (key: string): InsightSourceKey => ({ kind: "field", key });

const rule = (ruleId: string, overrides: Partial<InsightRule> = {}): InsightRule => ({
  ruleId, ruleVersion: 1, approvalReference: "Document synthétique 2026, rôle Responsable", sources: [field("header.reportNumber")],
  evaluate: (data) => [{ sourceKeys: [field("equipment.tube.brand"), field("header.reportNumber")], params: { numero: data.values["header.reportNumber"] ?? "", marque: data.values["equipment.tube.brand"] ?? "" } }],
  ...overrides,
});
const templates = { "regle-a": "Rapport {numero} ({marque}).", "regle-b": "Seconde observation {numero}.", "regle-silencieuse": "Jamais." };

test("I1 the production registry is empty and valid", () => {
  assert.equal(INSIGHT_RULE_REGISTRY.length, 0);
  assert.doesNotThrow(() => validateInsightRegistry(INSIGHT_RULE_REGISTRY));
});

test("I2 the production registry gives unavailable / no-approved-rules", () => {
  assert.deepEqual(evaluateInsightProposals(input()), { status: "unavailable", reason: "no-approved-rules", registryVersion: INSIGHT_REGISTRY_VERSION, proposals: [] });
});

test("I3 registry validation refuses every invalid entry", () => {
  assert.doesNotThrow(() => validateInsightRegistry([rule("regle-a")], templates));
  const refused: Array<[string, readonly InsightRule[]]> = [
    ["empty approval reference", [rule("regle-a", { approvalReference: " " })]],
    ["empty rule ID", [rule("", {})]],
    ["duplicate", [rule("regle-a"), rule("regle-a")]],
    ["version zero", [rule("regle-a", { ruleVersion: 0 })]],
    ["fractional version", [rule("regle-a", { ruleVersion: 1.5 })]],
    ["no sources", [rule("regle-a", { sources: [] })]],
    ["unknown field", [rule("regle-a", { sources: [field("nope.nope")] })]],
    ["unknown result", [rule("regle-a", { sources: [{ kind: "result", key: "nope" }] })]],
    ["no template", [rule("regle-sans-modele")]],
  ];
  for (const [label, registry] of refused) assert.throws(() => validateInsightRegistry(registry, templates), Error, label);
});

test("I4 proposals carry full provenance and a statement built from template and params only", () => {
  const set = evaluateInsightProposals(input(), [rule("regle-a"), rule("regle-b", { ruleVersion: 2, approvalReference: "Autre référence" })], templates);
  assert.equal(set.status, "available");
  assert.deepEqual(set.proposals.map((proposal) => proposal.statement), ["Rapport R-091 (Marque T).", "Seconde observation R-091."]);
  assert.deepEqual(set.proposals[1], {
    proposalId: `regle-b:v2:${SUBMISSION}:field=equipment.tube.brand,field=header.reportNumber`, ruleId: "regle-b", ruleVersion: 2, approvalReference: "Autre référence",
    registryVersion: INSIGHT_REGISTRY_VERSION, submissionId: SUBMISSION, sourceKeys: [field("equipment.tube.brand"), field("header.reportNumber")],
    statement: "Seconde observation R-091.", origin: "deterministic",
  });
});

test("I5 repeated runs and reordered inputs give identical, identically ordered output", () => {
  const registry = [rule("regle-b"), rule("regle-a", { ruleVersion: 2 }), rule("regle-a")];
  const first = evaluateInsightProposals(input(), registry, templates);
  for (let run = 0; run < 10; run++) assert.deepEqual(evaluateInsightProposals(input(), registry, templates), first);
  assert.deepEqual(evaluateInsightProposals(input(), [...registry].reverse(), templates), first);
  const reordered = { ...input(), values: { "equipment.tube.brand": values["equipment.tube.brand"], "header.reportNumber": values["header.reportNumber"] } };
  assert.deepEqual(evaluateInsightProposals(reordered, [...registry].reverse(), templates), first);
  assert.deepEqual(first.proposals.map((proposal) => `${proposal.ruleId}:${proposal.ruleVersion}`), ["regle-a:1", "regle-a:2", "regle-b:1"]);
});

test("I6 rules that do not fire give available with zero proposals", () => {
  const set = evaluateInsightProposals(input(), [rule("regle-silencieuse", { evaluate: () => [] })], templates);
  assert.deepEqual(set, { status: "available", registryVersion: INSIGHT_REGISTRY_VERSION, proposals: [] });
});

test("I7 the evaluator does not mutate its input and does not use the clock, randomness or the network", () => {
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  };
  const frozen = deepFreeze(input());
  const originals = { now: Date.now, random: Math.random, fetch: globalThis.fetch };
  let calls = 0;
  Date.now = () => { calls++; return 0; };
  Math.random = () => { calls++; return 0; };
  globalThis.fetch = (() => { calls++; throw new Error("network"); }) as typeof fetch;
  try {
    assert.equal(evaluateInsightProposals(frozen, [rule("regle-a")], templates).proposals.length, 1);
  } finally {
    Date.now = originals.now; Math.random = originals.random; globalThis.fetch = originals.fetch;
  }
  assert.equal(calls, 0);
});

test("I8 a rule that throws propagates the error", () => {
  const failing = rule("regle-a", { evaluate: () => { throw new Error("rule failure"); } });
  assert.throws(() => evaluateInsightProposals(input(), [failing], templates), /rule failure/);
});
