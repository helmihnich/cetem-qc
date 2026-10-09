import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "./graphie-identity.js";
import { calculateGraphieResults } from "./graphie-inputs.js";
import { INSIGHT_RULE_REGISTRY, evaluateInsightProposals } from "./insight-rules.js";
import { fr } from "../../i18n/src/fr.js";

// Story 9.2 guard: every rule of the registry needs a fixture test here, named after its rule ID and version.
const FIXTURED_RULES: readonly string[] = [
  "test-outside-paper-tolerance@1",
  "test-within-paper-tolerance@1",
  "test-calculation-unavailable@1",
  "check-answered-no@1",
];

test("I1 guard: every rule in the approved registry has a fixture test", () => {
  const missing = INSIGHT_RULE_REGISTRY.map((rule) => `${rule.ruleId}@${rule.ruleVersion}`).filter((id) => !FIXTURED_RULES.includes(id));
  assert.deepEqual(missing, []);
});

const accuracy = (measured: [string, string, string]) => ({
  "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": measured[0],
  "voltage.accuracy.row2.kvDisplayed": "70", "voltage.accuracy.row2.kvMeasured": measured[1],
  "voltage.accuracy.row3.kvDisplayed": "90", "voltage.accuracy.row3.kvMeasured": measured[2],
});
const proposalsFor = (values: Record<string, string>) => {
  const set = evaluateInsightProposals({ submissionId: "00000000-0000-4000-8000-000000000901", identity: GRAPHIE_CALCULATION_IDENTITY, values, results: calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, values) }, INSIGHT_RULE_REGISTRY, fr.insights.rules);
  assert.equal(set.status, "available");
  return set.proposals;
};
const about = (proposals: ReturnType<typeof proposalsFor>, ruleId: string, key: string) =>
  proposals.filter((proposal) => proposal.ruleId === ruleId && proposal.sourceKeys.some((source) => source.key === key));

test("test-outside-paper-tolerance@1 flags a test whose stored verdict is outside the paper tolerance", () => {
  const proposals = proposalsFor(accuracy(["51", "80", "91"]));
  const [outside] = about(proposals, "test-outside-paper-tolerance", "voltageAccuracy");
  assert.ok(outside);
  assert.equal(outside.statement, "Exactitude de la tension : au moins une valeur dépasse la tolérance du formulaire papier (≤ 10 %). Vérification recommandée avant la décision.");
  assert.equal(about(proposals, "test-within-paper-tolerance", "voltageAccuracy").length, 0);
});

test("test-within-paper-tolerance@1 notes a test whose stored verdict respects the paper tolerance", () => {
  const proposals = proposalsFor(accuracy(["51", "71", "91"]));
  const [within] = about(proposals, "test-within-paper-tolerance", "voltageAccuracy");
  assert.ok(within);
  assert.equal(within.statement, "Exactitude de la tension : toutes les valeurs calculées respectent la tolérance du formulaire papier (≤ 10 %).");
  assert.equal(about(proposals, "test-outside-paper-tolerance", "voltageAccuracy").length, 0);
});

test("test-calculation-unavailable@1 reports missing or unreadable measurements, never a test without a printed tolerance", () => {
  const missing = proposalsFor({});
  assert.match(about(missing, "test-calculation-unavailable", "voltageAccuracy")[0]!.statement, /calcul impossible \(mesures manquantes\)/);
  const unreadable = proposalsFor(accuracy(["51", "abc", "91"]));
  assert.match(about(unreadable, "test-calculation-unavailable", "voltageAccuracy")[0]!.statement, /calcul impossible \(valeurs illisibles\)/);
  const lightField = { "lightField.dfr": "1", "lightField.gap1": "1", "lightField.gap2": "1", "lightField.gap3": "1", "lightField.gap4": "1" };
  assert.equal(about(proposalsFor(lightField), "test-calculation-unavailable", "lightFieldCorrespondence").length, 0, "no printed tolerance is not a missing measurement");
});

test("check-answered-no@1 reports each visual or mechanical check answered « Non » and nothing for Oui or N.A", () => {
  const proposals = proposalsFor({ "visual.integrity": "Non", "visual.cleanliness": "Oui", "mechanical.brakes": "Non", "mechanical.movements": "N.A" });
  const checks = proposals.filter((proposal) => proposal.ruleId === "check-answered-no").map((proposal) => proposal.statement);
  assert.deepEqual(checks.sort(), [
    "Contrôle de sécurité mécanique — « Contrôle des freins » a été déclaré non satisfaisant par le Technicien.",
    "Contrôles visuels — « Intégrité de l'appareil, bon état des couvercles » a été déclaré non satisfaisant par le Technicien.",
  ]);
});
