import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "./graphie-identity.js";
import {
  GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES,
  assertApprovedFixtures,
  graphieAcceptanceStatus,
  runApprovedAcceptanceFixture,
} from "./graphie-calculations.approved-acceptance.js";
import type { AcceptanceCaseKind, ApprovedAcceptanceFixture } from "./graphie-calculations.approved-acceptance.js";
import { GRAPHIE_SOURCE_REGRESSION_FIXTURES } from "./graphie-calculations.source-regression.js";
import type { GraphieTestName } from "./graphie-calculations.js";
import * as domainRoot from "./index.js";

// Test-only samples: built here, never added to GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES, never CETEM data.
const sample = (overrides: Partial<ApprovedAcceptanceFixture> = {}, approval: Partial<ApprovedAcceptanceFixture["approval"]> = {}): ApprovedAcceptanceFixture => ({
  category: "approved-acceptance",
  id: "TEST-ONLY-1",
  test: "voltage-accuracy",
  caseKind: "normal",
  approval: {
    approvedBy: "Signataire de test",
    approvedOn: "2026-10-04",
    documentRef: "TEST-ONLY-DOC",
    ruleId: GRAPHIE_CALCULATION_IDENTITY.ruleId,
    ruleVersion: GRAPHIE_CALCULATION_IDENTITY.ruleVersion,
    ...approval,
  },
  values: {
    "voltage.accuracy.row1.kvDisplayed": "100",
    "voltage.accuracy.row1.kvMeasured": "105",
    "voltage.accuracy.row2.kvDisplayed": "50",
    "voltage.accuracy.row2.kvMeasured": "50",
    "voltage.accuracy.row3.kvDisplayed": "70",
    "voltage.accuracy.row3.kvMeasured": "70",
  },
  expected: { values: { "deviationPercent.0": 5, "deviationPercent.1": 0, "deviationPercent.2": 0 }, verdict: "conforme" },
  match: "approx",
  ...overrides,
});

const PAPER_ORDER: GraphieTestName[] = ["voltage-accuracy", "voltage-repeatability", "output-repeatability", "output-linearity", "light-field"];
const ALL_KINDS: AcceptanceCaseKind[] = ["normal", "abnormal", "invalid", "boundary"];
const kindsFor = (test: GraphieTestName, kinds: AcceptanceCaseKind[], approval: Partial<ApprovedAcceptanceFixture["approval"]> = {}) =>
  kinds.map((caseKind) => sample({ id: `TEST-ONLY-${test}-${caseKind}`, test, caseKind }, approval));

test("A1 the shipped approved-acceptance dataset is empty until CETEM supplies one (DEP-02)", () => {
  assert.ok(Array.isArray(GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES));
  assert.equal(GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES.length, 0);
});

test("A2 source-regression and approved-acceptance categories are disjoint", () => {
  assert.equal(GRAPHIE_SOURCE_REGRESSION_FIXTURES.length, 18);
  const cells = new Set<string>();
  for (const fixture of GRAPHIE_SOURCE_REGRESSION_FIXTURES) {
    assert.equal(fixture.category, "source-regression");
    assert.equal(fixture.source.workbook, "CALCUL_graphie_01.xls");
    assert.match(fixture.source.sha256, /^[0-9A-F]{64}$/);
    assert.equal(fixture.source.sheet, "Feuil1");
    assert.ok(fixture.source.cell && fixture.source.formula);
    assert.ok(!("approval" in fixture), `${fixture.source.cell} carries no approval`);
    assert.ok(!("caseKind" in fixture), `${fixture.source.cell} carries no caseKind`);
    cells.add(fixture.source.cell);
  }
  for (const fixture of GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES) {
    assert.equal(fixture.category, "approved-acceptance");
    assert.ok(!("source" in fixture), `${fixture.id} has no workbook source`);
    assert.ok(!cells.has(fixture.id), `${fixture.id} is not a source-regression cell`);
  }
  const disguised = { ...sample({ id: "F13" }) };
  assert.throws(() => assertApprovedFixtures([disguised]), /source-regression workbook cell/);
  const withSource = { ...sample(), source: { workbook: "CALCUL_graphie_01.xls" } } as unknown as ApprovedAcceptanceFixture;
  assert.throws(() => assertApprovedFixtures([withSource]), /workbook provenance/);
});

test("A3 approval provenance is mandatory, dated, bound to the current rule and uniquely identified", () => {
  assert.doesNotThrow(() => assertApprovedFixtures([sample()]));
  assert.throws(() => assertApprovedFixtures([sample({}, { approvedBy: "  " })]), /approval\.approvedBy is empty/);
  assert.throws(() => assertApprovedFixtures([sample({}, { documentRef: "" })]), /approval\.documentRef is empty/);
  assert.throws(() => assertApprovedFixtures([sample({}, { approvedOn: "04/10/2026" })]), /not an ISO date/);
  assert.throws(() => assertApprovedFixtures([sample({}, { approvedOn: "2026-02-30" })]), /not an ISO date/);
  assert.throws(() => assertApprovedFixtures([sample({}, { ruleVersion: "1.0.0" })]), /re-approved/);
  assert.throws(() => assertApprovedFixtures([sample({}, { ruleId: "cetem-workbook-explicit-formulas" })]), /re-approved/);
  assert.throws(() => assertApprovedFixtures([sample(), sample({ caseKind: "boundary" })]), /duplicate id/);
  assert.throws(() => assertApprovedFixtures([sample({ id: " " })]), /id is empty/);
  assert.throws(() => assertApprovedFixtures([sample({ category: "source-regression" } as unknown as Partial<ApprovedAcceptanceFixture>)]), /category must be approved-acceptance/);
  assert.throws(() => assertApprovedFixtures([sample({ caseKind: "accepted" } as unknown as Partial<ApprovedAcceptanceFixture>)]), /unknown case kind accepted/);
  assert.throws(() => assertApprovedFixtures([sample({ test: "machine" } as unknown as Partial<ApprovedAcceptanceFixture>)]), /unknown test machine/);
  assertApprovedFixtures(GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES);
});

test("A4 the runner accepts a test-only case whose expectations match calculateGraphieResults", () => {
  assert.doesNotThrow(() => runApprovedAcceptanceFixture(sample()));
  const missing = sample({
    values: { "voltage.accuracy.row1.kvDisplayed": "100", "voltage.accuracy.row1.kvMeasured": "105" },
    expected: { values: { "deviationPercent.0": 5, "deviationPercent.1": { unavailable: "missing-input" } }, verdict: "indisponible" },
    caseKind: "invalid",
  });
  assert.doesNotThrow(() => runApprovedAcceptanceFixture(missing));
  assert.doesNotThrow(() => runApprovedAcceptanceFixture(sample({ match: "exact" })));
  assert.doesNotThrow(() => runApprovedAcceptanceFixture(sample({ expected: { values: { "deviationPercent.0": 5 + 1e-12 }, verdict: "conforme" } })));
});

test("A4b the runner checks each paper test against its own calculation", () => {
  for (const name of PAPER_ORDER) {
    const empty = sample({ id: `TEST-ONLY-${name}-empty`, test: name, caseKind: "invalid", values: {}, expected: { values: {}, verdict: "indisponible" } });
    assert.doesNotThrow(() => runApprovedAcceptanceFixture(empty), name);
  }
});

test("A5 the runner reports a wrong expected value, verdict or path", () => {
  assert.throws(() => runApprovedAcceptanceFixture(sample({ expected: { values: { "deviationPercent.0": 6 }, verdict: "conforme" } })), /deviationPercent\.0: expected 6/);
  assert.throws(() => runApprovedAcceptanceFixture(sample({ expected: { values: { "deviationPercent.0": 5 }, verdict: "non-conforme" } })), /verdict: expected non-conforme/);
  assert.throws(() => runApprovedAcceptanceFixture(sample({ expected: { values: { "deviationPercent.0": { unavailable: "missing-input" } }, verdict: "conforme" } })), /expected unavailable/);
  assert.throws(() => runApprovedAcceptanceFixture(sample({ expected: { values: { k2: 1 }, verdict: "conforme" } })), /no value at k2/);
  assert.throws(() => runApprovedAcceptanceFixture(sample({ match: "exact", expected: { values: { "deviationPercent.0": 5.000001 }, verdict: "conforme" } })), /expected 5\.000001/);
  assert.throws(() => runApprovedAcceptanceFixture(sample({ match: "exact", expected: { values: { "deviationPercent.0": 5 + 1e-12 }, verdict: "conforme" } })), /deviationPercent\.0: expected 5\.000000000001/);
  const wrongReason = sample({
    values: { "voltage.accuracy.row1.kvDisplayed": "100", "voltage.accuracy.row1.kvMeasured": "105" },
    expected: { values: { "deviationPercent.1": { unavailable: "invalid-input" } }, verdict: "indisponible" },
  });
  assert.throws(() => runApprovedAcceptanceFixture(wrongReason), /expected unavailable invalid-input/);
  assert.throws(() => runApprovedAcceptanceFixture(sample({}, { ruleVersion: "1.0.0" })), /re-approved/);
});

test("A6 every approved case runs through the shared domain calculation (zero cases today)", () => {
  let checked = 0;
  for (const fixture of GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES) {
    runApprovedAcceptanceFixture(fixture);
    checked += 1;
  }
  assert.equal(checked, GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES.length);
});

test("A7 the shipped dataset leaves all five paper tests blocked with every case kind missing", () => {
  assert.deepEqual(
    graphieAcceptanceStatus(GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES),
    PAPER_ORDER.map((name) => ({ test: name, status: "blocked", missingCaseKinds: ALL_KINDS })),
  );
});

test("A8 a test is covered only by four current-rule case kinds", () => {
  const covered = graphieAcceptanceStatus(kindsFor("voltage-accuracy", ALL_KINDS));
  assert.deepEqual(covered[0], { test: "voltage-accuracy", status: "covered" });
  for (const entry of covered.slice(1)) assert.deepEqual(entry, { test: entry.test, status: "blocked", missingCaseKinds: ALL_KINDS });

  const three = graphieAcceptanceStatus(kindsFor("voltage-accuracy", ["normal", "abnormal", "boundary"]));
  assert.deepEqual(three[0], { test: "voltage-accuracy", status: "blocked", missingCaseKinds: ["invalid"] });

  const stale = graphieAcceptanceStatus(kindsFor("voltage-accuracy", ALL_KINDS, { ruleVersion: "1.0.0" }));
  assert.deepEqual(stale[0], { test: "voltage-accuracy", status: "blocked", missingCaseKinds: ALL_KINDS });
  const unsigned = graphieAcceptanceStatus(kindsFor("voltage-accuracy", ALL_KINDS, { approvedBy: " " }));
  assert.deepEqual(unsigned[0], { test: "voltage-accuracy", status: "blocked", missingCaseKinds: ALL_KINDS });
  for (const entry of [...covered, ...three, ...stale]) assert.notEqual(entry.status, "accepted");
  assert.equal(covered.length, 5);
});

test("A9 light field stays blocked even with four case kinds", () => {
  const status = graphieAcceptanceStatus(kindsFor("light-field", ALL_KINDS));
  assert.deepEqual(status[4], { test: "light-field", status: "blocked", missingCaseKinds: [] });
});

test("A10 fixture modules are reachable only through their subpaths", () => {
  for (const name of ["GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES", "GRAPHIE_SOURCE_REGRESSION_FIXTURES", "graphieAcceptanceStatus", "runApprovedAcceptanceFixture", "assertApprovedFixtures"]) {
    assert.ok(!(name in domainRoot), `root entry does not export ${name}`);
  }
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(index, /approved-acceptance|source-regression/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, string> };
  assert.equal(pkg.exports["./approved-acceptance"], "./src/graphie-calculations.approved-acceptance.ts");
  assert.equal(pkg.exports["./source-regression"], "./src/graphie-calculations.source-regression.ts");
});

test("A11 the fixture categories doc records the blocked acceptance status", () => {
  const doc = new URL("../../../docs/product/graphie-calculation-fixtures.md", import.meta.url);
  assert.ok(existsSync(doc));
  const text = readFileSync(doc, "utf8");
  assert.match(text, /DEP-02/);
  for (const label of [
    "Exactitude de la tension",
    "Répétabilité de la tension",
    "Reproductibilité et répétabilité du rayonnement de sortie",
    "Linéarité du rayonnement de sortie",
    "Correspondance champ lumineux / champ de rayons X",
  ]) {
    assert.ok(text.includes(`| ${label} | blocked (DEP-02`), `${label} is recorded as blocked (DEP-02)`);
  }
});
