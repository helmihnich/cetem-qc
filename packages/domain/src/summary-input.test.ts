import assert from "node:assert/strict";
import test from "node:test";
import type { GraphieCalculationResults } from "./graphie-inputs.js";
import type { CurrentInsightDecision } from "./insight-decisions.js";
import type { InsightProposal } from "./insight-rules.js";
import { collectRetainedInsights } from "./manual-insights.js";
import type { ManualInsight } from "./manual-insights.js";
import { buildSummaryInputSet, buildSummaryPrompt, canonicalJson, summaryInputSetPlainObject } from "./summary-input.js";

const SUBMISSION = "00000000-0000-4000-8000-000000000501";
const identity = { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" };
const results = { voltageAccuracy: { verdict: "conforme", formulaSource: "x" }, lightFieldCorrespondence: { verdict: "indisponible" } } as unknown as GraphieCalculationResults;
const proposal = (name: string): InsightProposal => ({
  proposalId: `${name}:v1:${SUBMISSION}:field=x`, ruleId: name, ruleVersion: 1, approvalReference: "Document synthétique 2026", registryVersion: "insight-registry-1",
  submissionId: SUBMISSION, sourceKeys: [{ kind: "field", key: "header.reportNumber" }], statement: `Texte ${name}.`, origin: "deterministic",
});
const decide = (name: string, decision: CurrentInsightDecision["decision"]): CurrentInsightDecision => ({
  proposalId: proposal(name).proposalId, decision, decidedAt: "2026-10-08T09:00:00.000Z", decidedBy: { id: "account-secret-id", displayName: "Responsable Test" },
});
const manual = (text: string, justification: string | null = null): ManualInsight => ({
  id: "00000000-0000-4000-8000-000000000601", text, justification, sourceType: "manual", createdAt: "2026-10-08T09:00:00.000Z",
  author: { id: "account-secret-id", displayName: "Auteur Synthétique" },
});
const deepFreeze = <T,>(value: T): T => {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
const values = { "b.field": "2", "a.field": "1" };

test("D1 the input set holds identity, sorted values, results and insights, and no name, ID or date", () => {
  const retained = collectRetainedInsights([proposal("a")], [decide("a", "retained")], [manual("Câble usé.", "Constat visuel.")]);
  const set = buildSummaryInputSet({ identity, values, results }, retained);
  assert.equal(set.version, 1);
  assert.deepEqual(set.identity, identity);
  assert.deepEqual(Object.keys(set.values), ["a.field", "b.field"]);
  assert.deepEqual(set.results, results);
  assert.deepEqual(set.insights, [{ sourceType: "rule", statement: "Texte a." }, { sourceType: "manual", text: "Câble usé.", justification: "Constat visuel." }]);
  const serialized = canonicalJson(set);
  for (const forbidden of ["account-secret-id", "Responsable Test", "Auteur Synthétique", "2026-10-08", SUBMISSION, "00000000-0000-4000-8000-000000000601", "proposalId", "approvalReference"]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

test("D2 discarded and undecided proposal content never appears and zero retained insights is valid", () => {
  const retained = collectRetainedInsights([proposal("a"), proposal("b"), proposal("c")], [decide("a", "retained"), decide("b", "discarded")], []);
  const serialized = canonicalJson(buildSummaryInputSet({ identity, values, results }, retained));
  assert.ok(serialized.includes("Texte a.") && !serialized.includes("Texte b.") && !serialized.includes("Texte c."));
  assert.deepEqual(buildSummaryInputSet({ identity, values, results }, []).insights, []);
});

test("D3 the builder is pure and the identity changes with any input", () => {
  const retained = deepFreeze(collectRetainedInsights([proposal("a")], [decide("a", "retained")], [manual("Texte.")]));
  const frozen = { identity: deepFreeze({ ...identity }), values: deepFreeze({ ...values }), results: deepFreeze(JSON.parse(JSON.stringify(results)) as GraphieCalculationResults) };
  const first = canonicalJson(buildSummaryInputSet(frozen, retained));
  assert.equal(canonicalJson(buildSummaryInputSet(frozen, retained)), first);
  assert.equal(canonicalJson(buildSummaryInputSet({ ...frozen, values: { "a.field": "1", "b.field": "2" } }, retained)), first, "key order does not matter");
  assert.notEqual(canonicalJson(buildSummaryInputSet({ ...frozen, values: { ...values, "b.field": "3" } }, retained)), first);
  assert.notEqual(canonicalJson(buildSummaryInputSet({ ...frozen, results: { ...results, voltageAccuracy: { verdict: "non conforme" } } as unknown as GraphieCalculationResults }, retained)), first);
  assert.notEqual(canonicalJson(buildSummaryInputSet(frozen, [])), first);
  assert.deepEqual(summaryInputSetPlainObject(buildSummaryInputSet(frozen, retained)), JSON.parse(first));
});

test("D4 the prompt holds the French instruction and the input set only, and forbids invention and overall conformity", () => {
  const set = buildSummaryInputSet({ identity, values, results }, collectRetainedInsights([proposal("a")], [decide("a", "retained")], []));
  const prompt = buildSummaryPrompt(set);
  assert.ok(prompt.endsWith(canonicalJson(set)));
  assert.match(prompt, /N’invente aucune valeur/);
  assert.match(prompt, /N’indique aucune conformité globale/);
  assert.match(prompt, /indisponible/);
  assert.ok(!prompt.includes("account-secret-id") && !prompt.includes(SUBMISSION));
});
