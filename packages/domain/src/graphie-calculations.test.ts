import assert from "node:assert/strict";
import test from "node:test";
import { graphieCalculations, GRAPHIE_CALCULATION_IDENTITY } from "./graphie-calculations.js";
import type { CalculationContext } from "./graphie-identity.js";
import { GRAPHIE_SOURCE_REGRESSION_FIXTURES as fixtures } from "./graphie-calculations.source-regression.js";

const value = (result: ReturnType<typeof graphieCalculations.voltageAccuracy>) => {
  assert.equal(result.status, "calculated");
  if (result.status !== "calculated") throw new Error("Expected calculated result");
  return result.value;
};

test("source regression fixtures preserve workbook numerical examples", () => {
  const repeatedVoltage = fixtures[0];
  assert.equal(repeatedVoltage.source.cell, "D26");
  assert.equal(repeatedVoltage.source.formula, "=SUM(C20:C24)/5");
  assert.equal(repeatedVoltage.expected, value(graphieCalculations.repeatedVoltageMean(
    GRAPHIE_CALCULATION_IDENTITY,
    ["C20", "C21", "C22", "C23", "C24"].map((cell) => repeatedVoltage.inputs[cell]!),
  )));

  const reproducibility = fixtures[1];
  assert.equal(reproducibility.source.formula, "= (O14+O15+O16)/3");
  const normalizedReadings = ["O14", "O15", "O16"].map((cell) => reproducibility.inputs[cell]!);
  assert.equal(reproducibility.expected, normalizedReadings.reduce((sum, reading) => sum + reading, 0) / 3);
  const kerma = ["N14", "N15", "N16"].map((cell) => reproducibility.inputs[cell]!);
  const mas = ["K14", "K15", "K16"].map((cell) => reproducibility.inputs[cell]!);
  assert.deepEqual(normalizedReadings, kerma.map((reading, index) => reading / mas[index]!));
  assert.equal(reproducibility.expected, value(graphieCalculations.outputReproducibility(GRAPHIE_CALCULATION_IDENTITY, {
    kerma,
    mas,
  })));

  for (const fixture of [fixtures[2], fixtures[3]]) {
    assert.equal(fixture.source.formula, fixture === fixtures[2]
      ? "=(L25+L26+L27+L28+L29)/5"
      : "=(M25+M26+M27+M28+M29)/5");
    const readings = Object.values(fixture.inputs).filter((reading): reading is number => reading !== null);
    assert.equal(fixture.expected, readings.reduce((sum, reading) => sum + reading, 0) / 5);
  }
  const repeatability = graphieCalculations.outputRepeatabilityMeans(GRAPHIE_CALCULATION_IDENTITY, {
    kerma: Object.values(fixtures[2].inputs) as number[],
    mas: [40, 40, 40, 40, 40],
  });
  assert.equal(repeatability.status, "calculated");
  if (repeatability.status === "calculated") {
    assert.equal(fixtures[2].expected, repeatability.value.rawKermaMean);
    assert.equal(fixtures[3].expected, repeatability.value.normalizedKermaPerMasMean);
  }

  const linearity = fixtures[4];
  assert.equal(linearity.source.formula, "=(N40+N41+N42)/3");
  assert.equal(linearity.expected, value(graphieCalculations.outputLinearity(GRAPHIE_CALCULATION_IDENTITY, {
    kerma: ["L40", "L41", "L42"].map((cell) => linearity.inputs[cell]!),
    mas: ["K40", "K41", "K42"].map((cell) => linearity.inputs[cell]!),
  })));

  const initialLinearity = fixtures[5];
  assert.equal(initialLinearity.source.cell, "Q40");
  assert.equal(initialLinearity.source.formula, "=(O40-O42)/O42*100");
  assert.equal(initialLinearity.inputs.O42, null);
  assert.equal(initialLinearity.expected, "#DIV/0!");
  const blocked = graphieCalculations.initialLinearity(GRAPHIE_CALCULATION_IDENTITY, 0.1, 0.2);
  assert.deepEqual([blocked.status, blocked.status === "unavailable" && blocked.reason], ["unavailable", "unresolved-source-rule"]);
});

test("signed deviations and source denominators are retained", () => {
  assert.equal(1.5999999999999945, value(graphieCalculations.voltageAccuracy(GRAPHIE_CALCULATION_IDENTITY, 50, 49.2)));
  assert.equal(-1.5999999999999945, value(graphieCalculations.voltageAccuracy(GRAPHIE_CALCULATION_IDENTITY, 50, 50.8)));
  assert.ok(value(graphieCalculations.outputReproducibilityDeviation(GRAPHIE_CALCULATION_IDENTITY, 0.0327, 0.06325)) < 0);
  assert.ok(value(graphieCalculations.outputRepeatabilityDeviation(GRAPHIE_CALCULATION_IDENTITY, 2.677, 2.7006)) < 0);
  assert.ok(typeof fixtures[2].expected === "number");
  assert.ok(value(graphieCalculations.outputRepeatabilityDeviation(
    GRAPHIE_CALCULATION_IDENTITY,
    fixtures[2].inputs.L25!,
    fixtures[2].expected,
  )) < 0);
  assert.notEqual(value(graphieCalculations.outputRepeatabilityDeviation(GRAPHIE_CALCULATION_IDENTITY, 2.677, 2.7006)), value(graphieCalculations.outputRepeatabilityDeviation(GRAPHIE_CALCULATION_IDENTITY, 2.677 / 40, 0.067515)));
  assert.equal(-0.08613264427218242, value(graphieCalculations.repeatedVoltageDeviation(GRAPHIE_CALCULATION_IDENTITY, 69.6, 69.66)));
});

test("linearity retains the 0.49 factor and rule/catalogue identity", () => {
  const actual = graphieCalculations.outputLinearity(GRAPHIE_CALCULATION_IDENTITY, { kerma: [0.672, 2.708, 11], mas: [10, 40, 160] });
  assert.equal(actual.status, "calculated");
  if (actual.status === "calculated") {
    assert.equal(actual.value, (0.49 * 0.672 / 10 + 0.49 * 2.708 / 40 + 0.49 * 11 / 160) / 3);
    assert.deepEqual(actual, { ...GRAPHIE_CALCULATION_IDENTITY, formulaSource: actual.formulaSource, status: "calculated", value: actual.value });
  }
  assert.deepEqual(graphieCalculations.repeatedVoltageMean(GRAPHIE_CALCULATION_IDENTITY, [69.7, 69.6, 69.7, 69.6, 69.7]), graphieCalculations.repeatedVoltageMean(GRAPHIE_CALCULATION_IDENTITY, [69.7, 69.6, 69.7, 69.6, 69.7]));
});

test("each calculation result retains its authorized workbook formula family and source cells", () => {
  const cases = [
    ["voltageAccuracy", graphieCalculations.voltageAccuracy(GRAPHIE_CALCULATION_IDENTITY, 50, 49.2), "voltage-accuracy", ["F13", "F14", "F15"]],
    ["repeatedVoltageMean", graphieCalculations.repeatedVoltageMean(GRAPHIE_CALCULATION_IDENTITY, [69.7, 69.6, 69.7, 69.6, 69.7]), "voltage-mean", ["D26"]],
    ["repeatedVoltageDeviation", graphieCalculations.repeatedVoltageDeviation(GRAPHIE_CALCULATION_IDENTITY, 69.6, 69.66), "voltage-deviation", ["D20", "E20"]],
    ["outputReproducibility", graphieCalculations.outputReproducibility(GRAPHIE_CALCULATION_IDENTITY, { kerma: [1.308, 3.154, 3.128], mas: [40, 40, 40] }), "output-reproducibility", ["P14"]],
    ["outputReproducibilityDeviation", graphieCalculations.outputReproducibilityDeviation(GRAPHIE_CALCULATION_IDENTITY, 0.0327, 0.06325), "output-reproducibility", ["Q14"]],
    ["outputRepeatabilityMeans", graphieCalculations.outputRepeatabilityMeans(GRAPHIE_CALCULATION_IDENTITY, { kerma: [2.677, 2.708, 2.705, 2.708, 2.705], mas: [40, 40, 40, 40, 40] }), "output-repeatability", ["N25", "O25"]],
    ["outputRepeatabilityDeviation", graphieCalculations.outputRepeatabilityDeviation(GRAPHIE_CALCULATION_IDENTITY, 2.677, 2.7006), "output-repeatability", ["P25"]],
    ["outputLinearity", graphieCalculations.outputLinearity(GRAPHIE_CALCULATION_IDENTITY, { kerma: [0.672, 2.708, 11], mas: [10, 40, 160] }), "output-linearity", ["O40"]],
    ["outputLinearityDeviation", graphieCalculations.outputLinearityDeviation(GRAPHIE_CALCULATION_IDENTITY, 0.03326283333333333, 0.04), "output-linearity", ["P40"]],
    ["initialLinearity", graphieCalculations.initialLinearity(GRAPHIE_CALCULATION_IDENTITY, 0.1, 0.2), "initial-linearity", ["Q40"]],
  ] as const;
  for (const [name, outcome, family, sourceCells] of cases) {
    assert.ok("formulaSource" in outcome, `${name} includes workbook provenance`);
    if (!("formulaSource" in outcome)) continue;
    assert.equal(outcome.formulaSource.family, family);
    assert.deepEqual(outcome.formulaSource.sourceCells, sourceCells);
  }
});

test("calculation context rejects unsupported catalogue, schema, and rule versions", () => {
  const unsupported = (context: CalculationContext) => ({
    status: "unavailable" as const,
    reason: "unsupported-version" as const,
    context,
  });
  const catalogueIdMismatch = { ...GRAPHIE_CALCULATION_IDENTITY, catalogueId: "unknown-catalogue" };
  const catalogueMismatch = { ...GRAPHIE_CALCULATION_IDENTITY, catalogueVersion: "1.0.0" };
  const schemaMismatch = { ...GRAPHIE_CALCULATION_IDENTITY, schemaVersion: 2 };
  const ruleIdMismatch = { ...GRAPHIE_CALCULATION_IDENTITY, ruleId: "other-calculation-rules" };
  const ruleMismatch = { ...GRAPHIE_CALCULATION_IDENTITY, ruleVersion: "2.0.0" };

  assert.deepEqual(
    graphieCalculations.voltageAccuracy(catalogueIdMismatch, 50, 49.2),
    unsupported(catalogueIdMismatch),
  );
  assert.deepEqual(
    graphieCalculations.voltageAccuracy(catalogueMismatch, 50, 49.2),
    unsupported(catalogueMismatch),
  );
  assert.deepEqual(
    graphieCalculations.repeatedVoltageMean(schemaMismatch, [69.7, 69.6, 69.7, 69.6, 69.7]),
    unsupported(schemaMismatch),
  );
  assert.deepEqual(
    graphieCalculations.outputReproducibility(ruleIdMismatch, { kerma: [1.308, 3.154, 3.128], mas: [40, 40, 40] }),
    unsupported(ruleIdMismatch),
  );
  assert.deepEqual(
    graphieCalculations.outputReproducibility(ruleMismatch, { kerma: [1.308, 3.154, 3.128], mas: [40, 40, 40] }),
    unsupported(ruleMismatch),
  );
  assert.equal(
    graphieCalculations.voltageAccuracy(GRAPHIE_CALCULATION_IDENTITY, 50, 49.2).status,
    "calculated",
  );
});

test("undefined numeric cases remain nonnumeric unavailable results", () => {
  assert.deepEqual([graphieCalculations.voltageAccuracy(GRAPHIE_CALCULATION_IDENTITY, 0, 2).status, graphieCalculations.voltageAccuracy(GRAPHIE_CALCULATION_IDENTITY, 0, 2).status === "unavailable" && graphieCalculations.voltageAccuracy(GRAPHIE_CALCULATION_IDENTITY, 0, 2).reason], ["unavailable", "zero-denominator"]);
  assert.equal(graphieCalculations.repeatedVoltageMean(GRAPHIE_CALCULATION_IDENTITY, [1, 2, 3, 4]).status, "unavailable");
  assert.equal(graphieCalculations.outputLinearity(GRAPHIE_CALCULATION_IDENTITY, { kerma: [1, 2, 3], mas: [1, 0, 3] }).status, "unavailable");
  assert.deepEqual(
    graphieCalculations.outputRepeatabilityMeans(GRAPHIE_CALCULATION_IDENTITY, {
      kerma: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
      mas: [1, 1, 1, 1, 1],
    }),
    { ...GRAPHIE_CALCULATION_IDENTITY, formulaSource: graphieCalculations.outputRepeatabilityMeans(GRAPHIE_CALCULATION_IDENTITY, { kerma: [1, 2, 3, 4, 5], mas: [1, 1, 1, 1, 1] }).formulaSource, status: "unavailable", reason: "invalid-input" },
  );
});
