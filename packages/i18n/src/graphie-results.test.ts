import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_FIELD_ID_LIST, GRAPHIE_CALCULATION_IDENTITY, calculateGraphieResults } from "@cetem-qc/domain";
import { GRAPHIE_RESULT_ORDER, presentGraphieMeasurements, presentGraphieResult } from "./graphie-results.js";

// Workbook source-regression readings typed with a decimal comma. Not CETEM-approved acceptance cases.
const regressionValues: Readonly<Record<string, string>> = Object.freeze({
  "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,2",
  "voltage.accuracy.row2.kvDisplayed": "70", "voltage.accuracy.row2.kvMeasured": "69,6",
  "voltage.accuracy.row3.kvDisplayed": "120", "voltage.accuracy.row3.kvMeasured": "119,8",
  "voltage.repeatability.row1.kvMeasured": "69,7", "voltage.repeatability.row2.kvMeasured": "69,6",
  "voltage.repeatability.row3.kvMeasured": "69,7", "voltage.repeatability.row4.kvMeasured": "69,6",
  "voltage.repeatability.row5.kvMeasured": "69,7",
  "voltage.repeatability.row1.kerma": "2,677", "voltage.repeatability.row2.kerma": "2,708",
  "voltage.repeatability.row3.kerma": "2,705", "voltage.repeatability.row4.kerma": "2,708",
  "voltage.repeatability.row5.kerma": "2,705",
  "output.linearity.dfc": "0,7",
  "output.linearity.row1.mas": "10", "output.linearity.row1.kerma": "0,672",
  "output.linearity.row2.mas": "40", "output.linearity.row2.kerma": "2,708",
  "output.linearity.row3.mas": "160", "output.linearity.row3.kerma": "11",
  "lightField.dfr": "1",
  "lightField.gap1": "2", "lightField.gap2": "-3", "lightField.gap3": "1", "lightField.gap4": "-4",
  // Fields that feed no formula and must never be shown as measured values.
  "voltage.repeatability.mas": "20", "voltage.repeatability.maMaxHalf": "100",
  "voltage.repeatability.row1.kvDisplayed": "71", "output.linearity.maMaxHalf": "100",
  "output.linearity.row1.kvDisplayed": "72", "lightField.kv": "73", "lightField.mas": "4",
});

const results = calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, regressionValues);
const present = <TName extends keyof typeof results>(name: TName) => {
  const presentation = presentGraphieResult(name, results[name]);
  assert.ok(presentation, name);
  return presentation;
};
const texts = (name: (typeof GRAPHIE_RESULT_ORDER)[number], values: Readonly<Record<string, string>>) =>
  presentGraphieMeasurements(name, values).map((line) => line.text);

test("I1 the shared presenter gives the 6.3 mobile block texts for the regression results", () => {
  const accuracy = present("voltageAccuracy");
  assert.equal(accuracy.heading, "Exactitude de la tension");
  assert.equal(accuracy.lines[0], "KV min — écart : -1,5999999999999945 %");
  assert.equal(accuracy.lines[1], "KV — écart : -0,5714285714285796 %");
  assert.deepEqual(accuracy.verdict, { status: "conforme", text: "✓ Conforme (suggestion)", label: "Verdict suggéré : conforme" });
  assert.equal(accuracy.tolerance, "Tolérance : |écart| ≤ 10 %");
  assert.equal(accuracy.provenance, "Règle cetem-paper-form 2.0.0 — formulaire CETEM, page 2, Exactitude de la tension");

  const voltage = present("voltageRepeatability");
  assert.deepEqual(voltage.lines.slice(0, 4), ["kV mesuré moy : 69,66 kV", "kV mesuré min : 69,6 kV", "kV mesuré max : 69,7 kV", "Écart min / moy : -0,08613264427218242 %"]);
  assert.equal(voltage.tolerance, "Tolérance : |écart| ≤ 5 %");

  const output = present("outputRepeatability");
  assert.equal(output.lines[0], "Kerma moy : 2,7006 mGy");
  assert.equal(output.lines[1], "Mesure 1 — écart : -0,8738798785455107 %");
  assert.equal(output.tolerance, "Tolérance : |écart| < 10 %");
  assert.equal(output.provenance, "Règle cetem-paper-form 2.0.0 — formulaire CETEM, page 3, Reproductibilité et répétabilité");

  const linearity = present("outputLinearity");
  assert.ok(linearity.lines.includes("K2 : 0,03326283333333333 mGy/mAs"), linearity.lines.join("\n"));
  assert.equal(linearity.tolerance, "Tolérance : |écart| < 15 %");

  const light = present("lightFieldCorrespondence");
  assert.deepEqual(light.lines, ["Σ|écarts| : 10 mm", "Résultat : 1 % de la D.F.R"]);
  assert.equal(light.verdict.text, "— Verdict indisponible : aucune tolérance imprimée sur le formulaire officiel");
  assert.equal(light.tolerance, undefined);
});

test("I2 an unsupported-version result is presented as nothing", () => {
  const oldRule = { ...GRAPHIE_CALCULATION_IDENTITY, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" };
  const old = calculateGraphieResults(oldRule, regressionValues);
  for (const name of GRAPHIE_RESULT_ORDER) assert.equal(presentGraphieResult(name, old[name]), undefined, name);
});

test("I3 measured values keep the stored string exactly, with the unit", () => {
  for (const raw of ["49,2", "49.2", " 49,2 "]) {
    const [kvMin] = texts("voltageAccuracy", { "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": raw });
    assert.equal(kvMin, `KV min — kV affiché : 50 kV · kV mesuré : ${raw} kV`, JSON.stringify(raw));
  }
});

test("I4 blank, whitespace-only and absent values read « Non renseigné » without a unit", () => {
  for (const values of [{ "lightField.dfr": "" }, { "lightField.dfr": "   " }, {}] as Record<string, string>[]) {
    assert.equal(texts("lightFieldCorrespondence", values)[0], "D.F.R (distance foyer–récepteur) : Non renseigné", JSON.stringify(values));
  }
});

test("I5 an unparseable value is shown raw and named invalid, without a unit", () => {
  assert.equal(texts("outputRepeatability", { "voltage.repeatability.row2.kerma": "abc" })[1], "Mesure 2 — Kerma : abc (valeur numérique invalide)");
});

test("I6 each test lists its formula inputs only, in paper order, with the paper labels and units", () => {
  assert.deepEqual(texts("voltageAccuracy", regressionValues), [
    "KV min — kV affiché : 50 kV · kV mesuré : 49,2 kV",
    "KV — kV affiché : 70 kV · kV mesuré : 69,6 kV",
    "KV max — kV affiché : 120 kV · kV mesuré : 119,8 kV",
  ]);
  assert.deepEqual(texts("voltageRepeatability", regressionValues), ["69,7", "69,6", "69,7", "69,6", "69,7"].map((value, index) => `Mesure ${index + 1} — kV mesuré : ${value} kV`));
  assert.deepEqual(texts("outputRepeatability", regressionValues), ["2,677", "2,708", "2,705", "2,708", "2,705"].map((value, index) => `Mesure ${index + 1} — Kerma : ${value} mGy`));
  assert.deepEqual(texts("outputLinearity", regressionValues), [
    "DFC (distance foyer–chambre) : 0,7 m",
    "Mesure 1 — mAs : 10 mAs · Kerma (dét) : 0,672 mGy",
    "Mesure 2 — mAs : 40 mAs · Kerma (dét) : 2,708 mGy",
    "Mesure 3 — mAs : 160 mAs · Kerma (dét) : 11 mGy",
  ]);
  assert.deepEqual(texts("lightFieldCorrespondence", regressionValues), [
    "D.F.R (distance foyer–récepteur) : 1 m",
    "Écart 1 : 2 mm", "Écart 2 : -3 mm", "Écart 3 : 1 mm", "Écart 4 : -4 mm",
  ]);
  const shown = GRAPHIE_RESULT_ORDER.flatMap((name) => presentGraphieMeasurements(name, regressionValues).flatMap((line) => line.readings.map((reading) => reading.fieldId)));
  assert.deepEqual(shown, [...GRAPHIE_CALCULATION_FIELD_ID_LIST], "exactly the formula inputs, in mapping order");
  const all = GRAPHIE_RESULT_ORDER.flatMap((name) => texts(name, regressionValues)).join("\n");
  for (const value of ["71", "72", "73", "100", "20"]) assert.doesNotMatch(all, new RegExp(`: ${value} `), value);
});

test("I7 GRAPHIE_RESULT_ORDER lists the five paper tests in paper order", () => {
  assert.deepEqual(GRAPHIE_RESULT_ORDER, ["voltageAccuracy", "voltageRepeatability", "outputRepeatability", "outputLinearity", "lightFieldCorrespondence"]);
});
