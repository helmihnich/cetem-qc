import assert from "node:assert/strict";
import test from "node:test";
import type { GraphieCalculationResults } from "./graphie-inputs.js";
import type { CurrentInsightDecision } from "./insight-decisions.js";
import type { InsightProposal } from "./insight-rules.js";
import { collectRetainedInsights } from "./manual-insights.js";
import type { ManualInsight } from "./manual-insights.js";
import { buildSummaryInputSet, buildSummaryPrompt, canonicalJson, SUMMARY_DRAFT_SECTIONS, SUMMARY_SYSTEM_INSTRUCTION, summaryInputSetPlainObject } from "./summary-input.js";
import { buildSummaryDemoDraft, renderSummaryFacts } from "./summary-facts.js";
import { GRAPHIE_CALCULATION_IDENTITY } from "./graphie-identity.js";
import { calculateGraphieResults } from "./graphie-inputs.js";

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

const realValues = {
  "header.reportNumber": "R-091", "header.interventionNature": "Convention", "header.etablissement": "  ",
  "equipment.equipment.brand": "MarqueSynth", "visual.integrity": "Oui", "visual.cleanliness": "Non", "mechanical.brakes": "N.A",
  "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,2", "voltage.accuracy.comments": "Câble à surveiller.",
  "controlPerformedBy.nom": "Technicien Secret",
};
const realSet = () => buildSummaryInputSet(
  { identity: GRAPHIE_CALCULATION_IDENTITY, values: realValues, results: calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, realValues) },
  collectRetainedInsights([proposal("a")], [decide("a", "retained")], [manual("Câble usé.", "Constat visuel.")]),
);

test("D5 the prompt adds a readable rendering with catalogue labels, units and French test names, before the unchanged input set", () => {
  const set = realSet();
  const before = canonicalJson(set);
  const prompt = buildSummaryPrompt(set);
  assert.equal(canonicalJson(set), before, "rendering never changes the input set");
  const facts = renderSummaryFacts(set);
  assert.ok(prompt.includes(facts) && prompt.indexOf(facts) < prompt.lastIndexOf(before));
  assert.match(facts, /- En-tête › N° rapport : R-091/);
  assert.match(facts, /- Exactitude de la tension › KV min — kV mesuré \(kV\) : 49,2/);
  assert.match(facts, /- Contrôles visuels › Propreté générale : Non/);
  assert.match(facts, /- Contrôle de sécurité mécanique › Contrôle des freins : N\.A/);
  assert.match(facts, /- Exactitude de la tension : verdict suggéré/);
  assert.match(facts, /- Répétabilité de la tension : verdict suggéré indisponible \(mesure manquante\)/);
  assert.match(facts, /\[Constat issu d’une règle\] Texte a\./);
  assert.match(facts, /\[Constat manuel\] Câble usé\. \(justification : Constat visuel\.\)/);
  assert.ok(!facts.includes("Établissement") && !facts.includes("Technicien Secret"), "blank values and personal sections are omitted");
  for (const heading of SUMMARY_DRAFT_SECTIONS) assert.ok(prompt.includes(heading), heading);
  assert.match(prompt, /sans Markdown/);
  assert.match(SUMMARY_SYSTEM_INSTRUCTION, /conformité globale/);
});

test("D6 the demonstration draft follows the five-part format, is labelled as a demonstration and states no overall conformity", () => {
  const draft = buildSummaryDemoDraft(realSet());
  assert.ok(draft.startsWith("Brouillon de démonstration"));
  let position = -1;
  for (const heading of SUMMARY_DRAFT_SECTIONS) {
    const next = draft.indexOf(`\n${heading}\n`);
    assert.ok(next > position, heading);
    position = next;
  }
  assert.match(draft, /Rapport n° R-091/);
  assert.match(draft, /Points signalés « Non » : propreté générale/);
  assert.match(draft, /Verdict indisponible pour : /);
  assert.match(draft, /Câble à surveiller\./);
  assert.match(draft, /- Câble usé\./);
  assert.ok(!/machine conforme|non conforme|approuv|\*\*|#/i.test(draft), draft);
  assert.ok(!draft.includes("Technicien Secret"));
  assert.equal(buildSummaryDemoDraft(realSet()), draft, "deterministic");
  assert.ok(buildSummaryDemoDraft(buildSummaryInputSet({ identity, values: {}, results }, [])).includes("Aucune donnée renseignée."));
});
