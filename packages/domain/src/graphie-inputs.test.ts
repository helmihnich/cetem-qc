import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY, graphieCalculations } from "./graphie-calculations.js";
import type { GraphieValue, UnsupportedVersionResult } from "./graphie-calculations.js";
import { GRAPHIE_SOURCE_REGRESSION_FIXTURES as fixtures } from "./graphie-calculations.source-regression.js";
import { GRAPHIE_CALCULATION_FIELD_ID_LIST, graphieTestInputsFromValues, isInvalidGraphieReading, parseGraphieReading } from "./graphie-inputs.js";

const ctx = GRAPHIE_CALCULATION_IDENTITY;

// Workbook regression readings typed as the technician would (decimal comma). Source-regression, not CETEM acceptance.
const workbookValues: Readonly<Record<string, string>> = Object.freeze({
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
  // Fields that feed no formula.
  "voltage.repeatability.mas": "20", "voltage.repeatability.maMaxHalf": "100",
  "voltage.repeatability.row1.kvDisplayed": "70", "output.linearity.maMaxHalf": "100",
  "output.linearity.row1.kvDisplayed": "70", "lightField.kv": "70", "lightField.mas": "4",
});

function computed<T>(result: T | UnsupportedVersionResult): T {
  assert.ok(!(result && typeof result === "object" && "reason" in result && result.reason === "unsupported-version"), "expected a computed result");
  return result as T;
}

function num(value: GraphieValue | undefined): number {
  assert.equal(value?.status, "calculated", JSON.stringify(value));
  return (value as { value: number }).value;
}

test("P1 blank readings are missing", () => {
  for (const raw of [undefined, "", "   "]) assert.equal(parseGraphieReading(raw), null, JSON.stringify(raw));
});

test("P2 comma or point decimals, signs, surrounding spaces and leading zeros parse to numbers", () => {
  const cases: [string, number][] = [["49,2", 49.2], ["49.2", 49.2], [" 49,2 ", 49.2], ["-3", -3], ["+0,5", 0.5], ["007", 7]];
  for (const [raw, expected] of cases) {
    assert.equal(parseGraphieReading(raw), expected, raw);
    assert.equal(isInvalidGraphieReading(raw), false, raw);
  }
  assert.ok(Object.is(parseGraphieReading("-0"), -0));
});

test("P3 anything outside the number syntax is an invalid reading", () => {
  for (const raw of ["abc", "1e3", "1 000", "1.000,5", "N.A", "5,", ",5", "1,2,3", "Infinity"]) {
    assert.ok(Number.isNaN(parseGraphieReading(raw)), raw);
    assert.equal(isInvalidGraphieReading(raw), true, raw);
  }
});

test("P4 a blank reading is not invalid", () => {
  assert.equal(isInvalidGraphieReading(""), false);
  assert.equal(isInvalidGraphieReading("  "), false);
  assert.equal(isInvalidGraphieReading(undefined), false);
});

test("G1 the five inputs follow the Story 6.6 source field mapping in row order", () => {
  const values = Object.fromEntries(GRAPHIE_CALCULATION_FIELD_ID_LIST.map((id, index) => [id, String(index + 1)]));
  const at = (id: string) => Number(values[id]);
  assert.deepEqual(graphieTestInputsFromValues(values), {
    voltageAccuracy: { rows: [1, 2, 3].map((row) => ({
      kvDisplayed: at(`voltage.accuracy.row${row}.kvDisplayed`),
      kvMeasured: at(`voltage.accuracy.row${row}.kvMeasured`),
    })) },
    voltageRepeatability: { kvMeasured: [1, 2, 3, 4, 5].map((row) => at(`voltage.repeatability.row${row}.kvMeasured`)) },
    outputRepeatability: { kerma: [1, 2, 3, 4, 5].map((row) => at(`voltage.repeatability.row${row}.kerma`)) },
    outputLinearity: {
      dfcMeters: at("output.linearity.dfc"),
      rows: [1, 2, 3].map((row) => ({ mas: at(`output.linearity.row${row}.mas`), kermaDetector: at(`output.linearity.row${row}.kerma`) })),
    },
    lightFieldCorrespondence: { dfrMeters: at("lightField.dfr"), gapsMm: [1, 2, 3, 4].map((index) => at(`lightField.gap${index}`)) },
  });
  assert.equal(new Set(GRAPHIE_CALCULATION_FIELD_ID_LIST).size, GRAPHIE_CALCULATION_FIELD_ID_LIST.length);
  assert.deepEqual(graphieTestInputsFromValues({}).voltageAccuracy.rows[0], { kvDisplayed: null, kvMeasured: null });
});

test("G2 fields that feed no formula never change the inputs", () => {
  const before = graphieTestInputsFromValues(workbookValues);
  const changed: Record<string, string> = { ...workbookValues };
  for (const id of ["voltage.repeatability.mas", "voltage.repeatability.maMaxHalf", "output.linearity.maMaxHalf", "lightField.kv", "lightField.mas"]) changed[id] = "999";
  for (const row of [1, 2, 3, 4, 5]) changed[`voltage.repeatability.row${row}.kvDisplayed`] = "abc";
  for (const row of [1, 2, 3]) changed[`output.linearity.row${row}.kvDisplayed`] = "-1";
  assert.deepEqual(graphieTestInputsFromValues(changed), before);
  for (const id of Object.keys(changed).filter((key) => !GRAPHIE_CALCULATION_FIELD_ID_LIST.includes(key))) {
    assert.ok(["voltage.repeatability.mas", "voltage.repeatability.maMaxHalf", "output.linearity.maMaxHalf", "lightField.kv", "lightField.mas"].includes(id) || /\.row\d\.kvDisplayed$/.test(id), id);
    assert.ok(!id.startsWith("voltage.accuracy"), id);
  }
});

test("G3 workbook readings typed as comma strings reproduce the Story 6.6 regression values", () => {
  const snapshot = { ...workbookValues };
  const inputs = graphieTestInputsFromValues(workbookValues);
  assert.deepEqual(workbookValues, snapshot, "the raw strings are only read");
  const accuracy = computed(graphieCalculations.voltageAccuracy(ctx, inputs.voltageAccuracy));
  const repeatability = computed(graphieCalculations.voltageRepeatability(ctx, inputs.voltageRepeatability));
  const output = computed(graphieCalculations.outputRepeatability(ctx, inputs.outputRepeatability));
  const linearity = computed(graphieCalculations.outputLinearity(ctx, inputs.outputLinearity));
  const actualByCell: Record<string, number> = {
    F13: num(accuracy.values.deviationPercent[0]), F14: num(accuracy.values.deviationPercent[1]), F15: num(accuracy.values.deviationPercent[2]),
    D26: num(repeatability.values.mean), B26: num(repeatability.values.min), C26: num(repeatability.values.max),
    D20: num(repeatability.values.minDeviationPercent), E20: num(repeatability.values.maxDeviationPercent),
    N25: num(output.values.kermaMean),
    P25: num(output.values.deviationPercent[0]), P26: num(output.values.deviationPercent[1]), P27: num(output.values.deviationPercent[2]),
    P28: num(output.values.deviationPercent[3]), P29: num(output.values.deviationPercent[4]),
    O40: num(linearity.values.k2),
    P40: num(linearity.values.deviationPercent[0]), P41: num(linearity.values.deviationPercent[1]), P42: num(linearity.values.deviationPercent[2]),
  };
  assert.equal(Object.keys(actualByCell).length, fixtures.length);
  for (const fixture of fixtures) {
    const actual = actualByCell[fixture.source.cell]!;
    if (fixture.match === "exact") assert.equal(actual, fixture.expected, fixture.source.cell);
    else assert.ok(Math.abs(actual - fixture.expected) <= 1e-9, `${fixture.source.cell}: ${actual} ≈ ${fixture.expected}`);
  }
  assert.equal(actualByCell.F13, -1.5999999999999945);
  assert.equal(actualByCell.D26, 69.66);
  assert.equal(actualByCell.N25, 2.7006);
  const light = computed(graphieCalculations.lightFieldCorrespondence(ctx, inputs.lightFieldCorrespondence));
  assert.equal(num(light.values.sumAbsGapsMm), 10);
  assert.equal(num(light.values.resultPercent), 1);
  assert.deepEqual(light.suggestedVerdict, { status: "indisponible", reason: "no-tolerance" });
});

test("G4 one blank or unparseable kV mesuré makes only that test unavailable", () => {
  const verdicts = (values: Record<string, string>) => {
    const inputs = graphieTestInputsFromValues(values);
    return {
      accuracy: computed(graphieCalculations.voltageAccuracy(ctx, inputs.voltageAccuracy)),
      repeatability: computed(graphieCalculations.voltageRepeatability(ctx, inputs.voltageRepeatability)).suggestedVerdict,
      output: computed(graphieCalculations.outputRepeatability(ctx, inputs.outputRepeatability)).suggestedVerdict,
      linearity: computed(graphieCalculations.outputLinearity(ctx, inputs.outputLinearity)).suggestedVerdict,
      light: computed(graphieCalculations.lightFieldCorrespondence(ctx, inputs.lightFieldCorrespondence)),
    };
  };
  const baseline = verdicts({ ...workbookValues });
  assert.equal(baseline.accuracy.suggestedVerdict.status, "conforme");
  for (const [raw, reason] of [["", "missing-input"], ["abc", "invalid-input"]] as const) {
    const result = verdicts({ ...workbookValues, "voltage.accuracy.row2.kvMeasured": raw });
    assert.deepEqual(result.accuracy.suggestedVerdict, { status: "indisponible", reason, tolerance: { comparison: "abs-lte", limitPercent: 10 } });
    assert.deepEqual(result.accuracy.values.deviationPercent[1], { status: "unavailable", reason });
    assert.deepEqual(result.accuracy.values.deviationPercent[0], baseline.accuracy.values.deviationPercent[0]);
    assert.deepEqual([result.repeatability, result.output, result.linearity, result.light], [baseline.repeatability, baseline.output, baseline.linearity, baseline.light]);
  }
});
