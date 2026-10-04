import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  graphieCalculations,
  GRAPHIE_CALCULATION_IDENTITY,
  GRAPHIE_TOLERANCES,
  TOLERANCE_EPSILON,
  judgeTolerance,
} from "./graphie-calculations.js";
import type { GraphieTolerance, GraphieValue, GraphieVerdict, UnsupportedVersionResult } from "./graphie-calculations.js";
import type { CalculationContext } from "./graphie-identity.js";
import { GRAPHIE_SOURCE_REGRESSION_FIXTURES as fixtures } from "./graphie-calculations.source-regression.js";
import type { SourceRegressionFixture } from "./graphie-calculations.source-regression.js";

const ctx = GRAPHIE_CALCULATION_IDENTITY;

function computed<T>(result: T | UnsupportedVersionResult): T {
  assert.ok(!(result && typeof result === "object" && "reason" in result && result.reason === "unsupported-version"), "expected a computed result");
  return result as T;
}

function num(value: GraphieValue | undefined): number {
  assert.ok(value, "expected a value");
  assert.equal(value.status, "calculated", `expected calculated, got ${JSON.stringify(value)}`);
  return (value as { value: number }).value;
}

const reason = (value: GraphieValue | undefined) => (value?.status === "unavailable" ? value.reason : value?.status);
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} ≈ ${expected}`);
const calc = (value: number): GraphieValue => ({ status: "calculated", value });

const accuracy = (...rows: [number | null, number | null][]) => computed(graphieCalculations.voltageAccuracy(ctx, {
  rows: rows.map(([kvDisplayed, kvMeasured]) => ({ kvDisplayed, kvMeasured })),
}));
const kvRepeatability = (...kvMeasured: (number | null)[]) => computed(graphieCalculations.voltageRepeatability(ctx, { kvMeasured }));
const kermaRepeatability = (...kerma: (number | null)[]) => computed(graphieCalculations.outputRepeatability(ctx, { kerma }));
const linearity = (dfcMeters: number | null, ...rows: [number | null, number | null][]) => computed(graphieCalculations.outputLinearity(ctx, {
  dfcMeters,
  rows: rows.map(([mas, kermaDetector]) => ({ mas, kermaDetector })),
}));
const lightField = (dfrMeters: number | null, ...gapsMm: (number | null)[]) => computed(graphieCalculations.lightFieldCorrespondence(ctx, { dfrMeters, gapsMm }));

const byCell = (cell: string): SourceRegressionFixture => {
  const found = fixtures.find((candidate) => candidate.source.cell === cell);
  assert.ok(found, `fixture ${cell}`);
  return found;
};
const expectFixture = (cell: string, actual: GraphieValue | undefined) => {
  const fixture = byCell(cell);
  if (fixture.match === "exact") assert.equal(num(actual), fixture.expected, cell);
  else near(num(actual), fixture.expected);
};

// ---------------------------------------------------------------- Workbook regression (R1–R5)

test("R1 voltage accuracy reproduces the negated workbook F13:F15 with the paper sign", () => {
  const f = (cell: string, d: string, e: string) => [byCell(cell).inputs[d]!, byCell(cell).inputs[e]!] as [number, number];
  const result = accuracy(f("F13", "D13", "E13"), f("F14", "D14", "E14"), f("F15", "D15", "E15"));
  assert.equal(num(result.values.deviationPercent[0]), -1.5999999999999945);
  assert.equal(num(result.values.deviationPercent[1]), -0.5714285714285796);
  assert.equal(num(result.values.deviationPercent[2]), -0.16666666666666904);
  for (const [index, cell] of ["F13", "F14", "F15"].entries()) expectFixture(cell, result.values.deviationPercent[index]);
  assert.equal(result.test, "voltage-accuracy");
  assert.deepEqual(result.suggestedVerdict, { status: "conforme", tolerance: { comparison: "abs-lte", limitPercent: 10 } });
});

test("R2 voltage repeatability computes mean, MIN and MAX from the readings", () => {
  const inputs = byCell("D26").inputs;
  const result = kvRepeatability(...["C20", "C21", "C22", "C23", "C24"].map((cell) => inputs[cell]!));
  assert.equal(num(result.values.mean), 69.66);
  assert.equal(num(result.values.min), 69.6);
  assert.equal(num(result.values.max), 69.7);
  assert.equal(num(result.values.minDeviationPercent), -0.08613264427218242);
  assert.equal(num(result.values.maxDeviationPercent), 0.057421762848128416);
  expectFixture("D26", result.values.mean);
  expectFixture("B26", result.values.min);
  expectFixture("C26", result.values.max);
  expectFixture("D20", result.values.minDeviationPercent);
  expectFixture("E20", result.values.maxDeviationPercent);
  assert.deepEqual(result.suggestedVerdict, { status: "conforme", tolerance: { comparison: "abs-lte", limitPercent: 5 } });
});

test("R3 output repeatability reproduces Kerma moy N25 and deviations P25:P29", () => {
  const inputs = byCell("N25").inputs;
  const result = kermaRepeatability(...["L25", "L26", "L27", "L28", "L29"].map((cell) => inputs[cell]!));
  assert.equal(num(result.values.kermaMean), 2.7006);
  assert.deepEqual(result.values.deviationPercent.map(num), [
    -0.8738798785455107, 0.27401318225579774, 0.1629267570169577, 0.27401318225579774, 0.1629267570169577,
  ]);
  expectFixture("N25", result.values.kermaMean);
  for (const [index, cell] of ["P25", "P26", "P27", "P28", "P29"].entries()) expectFixture(cell, result.values.deviationPercent[index]);
  assert.deepEqual(result.suggestedVerdict, { status: "conforme", tolerance: { comparison: "abs-lt", limitPercent: 10 } });
});

test("R4 output linearity at DFC 0.70 m reproduces K2 (O40) exactly and P40:P42 approximately", () => {
  const inputs = byCell("O40").inputs;
  const result = linearity(inputs.DFC!, [inputs.K40!, inputs.L40!], [inputs.K41!, inputs.L41!], [inputs.K42!, inputs.L42!]);
  assert.equal(num(result.values.k2), 0.03326283333333333);
  expectFixture("O40", result.values.k2);
  near(num(result.values.deviationPercent[0]), -1.006629020378098);
  near(num(result.values.deviationPercent[1]), -0.2700712005892382);
  near(num(result.values.deviationPercent[2]), 1.2767002209673364);
  for (const [index, cell] of ["P40", "P41", "P42"].entries()) expectFixture(cell, result.values.deviationPercent[index]);
  for (let i = 0; i < 3; i++) {
    const kerma = [inputs.L40!, inputs.L41!, inputs.L42!][i]!;
    const mas = [inputs.K40!, inputs.K41!, inputs.K42!][i]!;
    assert.equal(num(result.values.kermaAt1m[i]), kerma * (0.7 / 1) ** 2);
    assert.equal(num(result.values.k1[i]), kerma * (0.7 / 1) ** 2 / mas);
  }
  assert.deepEqual(result.suggestedVerdict, { status: "conforme", tolerance: { comparison: "abs-lt", limitPercent: 15 } });
});

test("R5 fixtures keep only paper-backed workbook cells", () => {
  const cells = fixtures.map((fixture) => fixture.source.cell);
  for (const removed of ["P14", "O25", "Q40"]) assert.ok(!cells.includes(removed), `${removed} removed`);
  assert.deepEqual(cells, ["F13", "F14", "F15", "D26", "B26", "C26", "D20", "E20", "N25", "P25", "P26", "P27", "P28", "P29", "O40", "P40", "P41", "P42"]);
  for (const fixture of fixtures) {
    assert.equal(fixture.category, "source-regression");
    assert.equal(typeof fixture.expected, "number");
  }
  for (const cell of ["F13", "F14", "F15", "B26", "C26", "D20", "E20", "O40", "P40", "P41", "P42"]) assert.ok(byCell(cell).paperRule, `${cell} has a paperRule note`);
  const fixtureSource = readFileSync(new URL("./graphie-calculations.source-regression.ts", import.meta.url), "utf8");
  assert.doesNotMatch(fixtureSource, /0\.49/);
});

// ---------------------------------------------------------------- Boundary cases (B1–B15) — rule-derived developer checks (printed tolerances, Story 6.6), not CETEM acceptance

test("B1/B2 voltage accuracy exactly ±10 % is conforme (≤)", () => {
  const plus = accuracy([50, 55], [70, 70], [100, 100]);
  assert.equal(num(plus.values.deviationPercent[0]), 10);
  assert.equal(plus.suggestedVerdict.status, "conforme");
  const minus = accuracy([50, 45], [70, 70], [100, 100]);
  assert.equal(num(minus.values.deviationPercent[0]), -10);
  assert.equal(minus.suggestedVerdict.status, "conforme");
});

test("B3 voltage accuracy above 10 % is non-conforme", () => {
  const result = accuracy([100, 110.001], [70, 70], [100, 100]);
  assert.ok(num(result.values.deviationPercent[0]) > 10);
  assert.deepEqual(result.suggestedVerdict, { status: "non-conforme", tolerance: GRAPHIE_TOLERANCES["voltage-accuracy"] });
});

test("B4/B5 voltage repeatability exactly ±5 % is conforme, beyond is non-conforme", () => {
  const atLimit = kvRepeatability(95, 105, 100, 100, 100);
  assert.equal(num(atLimit.values.mean), 100);
  assert.equal(num(atLimit.values.minDeviationPercent), -5);
  assert.equal(num(atLimit.values.maxDeviationPercent), 5);
  assert.equal(atLimit.suggestedVerdict.status, "conforme");
  const beyond = kvRepeatability(94.9, 105, 100, 100, 100.1);
  assert.ok(num(beyond.values.minDeviationPercent) < -5);
  assert.equal(beyond.suggestedVerdict.status, "non-conforme");
});

test("B6/B7 output repeatability exactly ±10 % is non-conforme (<), ±9 % is conforme", () => {
  const atLimit = kermaRepeatability(110, 90, 100, 100, 100);
  assert.deepEqual(atLimit.values.deviationPercent.map(num), [10, -10, 0, 0, 0]);
  assert.equal(atLimit.suggestedVerdict.status, "non-conforme");
  const within = kermaRepeatability(109, 91, 100, 100, 100);
  assert.deepEqual(within.values.deviationPercent.map(num), [9, -9, 0, 0, 0]);
  assert.equal(within.suggestedVerdict.status, "conforme");
});

test("B8/B9 output linearity exactly ±15 % is non-conforme (<), ±14 % is conforme", () => {
  const atLimit = linearity(1, [1, 115], [1, 85], [1, 100]);
  assert.equal(num(atLimit.values.k2), 100);
  assert.deepEqual(atLimit.values.deviationPercent.map(num), [15, -15, 0]);
  assert.equal(atLimit.suggestedVerdict.status, "non-conforme");
  const within = linearity(1, [1, 114], [1, 86], [1, 100]);
  assert.deepEqual(within.values.deviationPercent.map(num), [14.000000000000002, -14.000000000000002, 0]);
  assert.equal(within.suggestedVerdict.status, "conforme");
});

test("B10 light field returns its numbers and is always indisponible / no-tolerance", () => {
  const result = lightField(1, 2, -3, 1, -4);
  assert.equal(num(result.values.sumAbsGapsMm), 10);
  assert.equal(num(result.values.resultPercent), 1);
  assert.deepEqual(result.suggestedVerdict, { status: "indisponible", reason: "no-tolerance" });
  assert.equal(GRAPHIE_TOLERANCES["light-field"], null);
});

test("B11–B14 the verdict helper absorbs floating-point noise only", () => {
  const lte10: GraphieTolerance = { comparison: "abs-lte", limitPercent: 10 };
  const lt10: GraphieTolerance = { comparison: "abs-lt", limitPercent: 10 };
  const status = (value: number, tolerance: GraphieTolerance) => judgeTolerance([calc(value)], tolerance).status;
  assert.equal(TOLERANCE_EPSILON, 1e-9);
  // B11
  assert.equal(status(10.000000000000002, lte10), "conforme");
  assert.equal(status(-10.000000000000002, lte10), "conforme");
  // B12
  assert.equal(status(10, lt10), "non-conforme");
  assert.equal(status(-10, lt10), "non-conforme");
  assert.equal(status(10.000000000000002, lt10), "non-conforme");
  // B13
  assert.equal(status(9.99999999, lt10), "conforme");
  assert.equal(status(9.999999999, lt10), "conforme");
  assert.equal(status(9.999999999, lte10), "conforme");
  assert.equal(status(10, lte10), "conforme");
  // B14
  assert.equal(status(10.001, lte10), "non-conforme");
  assert.equal(status(10.001, lt10), "non-conforme");
});

test("B15 tolerance comparisons are written exactly as the contract expressions", () => {
  const domainSource = readFileSync(new URL("./graphie-calculations.ts", import.meta.url), "utf8");
  assert.ok(domainSource.includes("Math.abs(x) - limit <= TOLERANCE_EPSILON"));
  assert.ok(domainSource.includes("limit - Math.abs(x) > TOLERANCE_EPSILON"));
  assert.ok(!domainSource.includes("limit - TOLERANCE_EPSILON"));
  assert.doesNotMatch(domainSource, /0\.49/);
  assert.ok(!domainSource.includes("unresolved" + "-source-rule"));
  assert.doesNotMatch(domainSource, /Math\.round|toFixed|toPrecision/);
});

// ---------------------------------------------------------------- Unavailable and precedence (U1–U11) — rule-derived developer checks (printed tolerances, Story 6.6), not CETEM acceptance

test("U1/U2 a missing row makes the verdict indisponible even when another row fails", () => {
  const missing = accuracy([50, 49.2], [70, 69.6], [null, 119.8]);
  assert.equal(num(missing.values.deviationPercent[0]), -1.5999999999999945);
  assert.equal(num(missing.values.deviationPercent[1]), -0.5714285714285796);
  assert.equal(reason(missing.values.deviationPercent[2]), "missing-input");
  assert.deepEqual(missing.suggestedVerdict, { status: "indisponible", reason: "missing-input", tolerance: GRAPHIE_TOLERANCES["voltage-accuracy"] });

  const failingAndMissing = accuracy([100, 150], [70, 70], [120, null]);
  assert.equal(num(failingAndMissing.values.deviationPercent[0]), 50);
  assert.equal(failingAndMissing.suggestedVerdict.status, "indisponible");
  assert.equal((failingAndMissing.suggestedVerdict as Extract<GraphieVerdict, { status: "indisponible" }>).reason, "missing-input");

  const zeroThenMissing = accuracy([0, 2], [70, 70], [null, 119.8]);
  assert.deepEqual(zeroThenMissing.suggestedVerdict, { status: "indisponible", reason: "zero-denominator", tolerance: GRAPHIE_TOLERANCES["voltage-accuracy"] });
});

test("U3 a zero kV affiché is a zero denominator, not a throw", () => {
  const result = accuracy([0, 2], [70, 70], [100, 100]);
  assert.equal(reason(result.values.deviationPercent[0]), "zero-denominator");
  assert.equal(num(result.values.deviationPercent[1]), 0);
  assert.deepEqual(result.suggestedVerdict, { status: "indisponible", reason: "zero-denominator", tolerance: GRAPHIE_TOLERANCES["voltage-accuracy"] });
});

test("U4 wrong length or a missing reading makes all repeatability values missing", () => {
  for (const result of [kvRepeatability(1, 2, 3, 4), kvRepeatability(69.7, null, 69.7, 69.6, 69.7)]) {
    for (const value of Object.values(result.values)) assert.equal(reason(value), "missing-input");
    assert.equal(result.suggestedVerdict.status, "indisponible");
  }
  const short = kermaRepeatability(1, 2, 3);
  assert.equal(reason(short.values.kermaMean), "missing-input");
  assert.equal(short.values.deviationPercent.length, 5);
  for (const value of short.values.deviationPercent) assert.equal(reason(value), "missing-input");
  const wrongRows = computed(graphieCalculations.voltageAccuracy(ctx, { rows: [{ kvDisplayed: 50, kvMeasured: 49.2 }] }));
  assert.deepEqual(wrongRows.values.deviationPercent.map(reason), ["missing-input", "missing-input", "missing-input"]);
  // eslint-disable-next-line no-sparse-arrays
  const sparse = computed(graphieCalculations.voltageRepeatability(ctx, { kvMeasured: [1, , 3, 4, 5] as (number | null)[] }));
  for (const value of Object.values(sparse.values)) assert.equal(reason(value), "missing-input");
  const sparseRows = computed(graphieCalculations.voltageAccuracy(ctx, { rows: [{ kvDisplayed: 50, kvMeasured: 49.2 }, , { kvDisplayed: 70, kvMeasured: 70 }] as never }));
  assert.deepEqual(sparseRows.values.deviationPercent.map(reason), ["calculated", "missing-input", "calculated"]);
  const sparseLinearity = computed(graphieCalculations.outputLinearity(ctx, { dfcMeters: 1, rows: [{ mas: 1, kermaDetector: 1 }, , { mas: 1, kermaDetector: 1 }] as never }));
  assert.equal(reason(sparseLinearity.values.k1[1]), "missing-input");
  const wrongGaps = lightField(1, 1, 2, 3);
  assert.equal(reason(wrongGaps.values.sumAbsGapsMm), "missing-input");
  const wrongLinearity = linearity(1, [1, 1], [1, 1]);
  assert.equal(reason(wrongLinearity.values.k2), "missing-input");
});

test("U5 NaN and Infinity readings are invalid input", () => {
  assert.equal(reason(accuracy([50, Number.NaN], [70, 70], [100, 100]).values.deviationPercent[0]), "invalid-input");
  assert.equal(reason(kvRepeatability(1, 2, Number.POSITIVE_INFINITY, 4, 5).values.mean), "invalid-input");
  const kerma = kermaRepeatability(1, 2, 3, 4, Number.NaN);
  assert.equal(reason(kerma.values.kermaMean), "invalid-input");
  assert.deepEqual(kerma.suggestedVerdict, { status: "indisponible", reason: "invalid-input", tolerance: GRAPHIE_TOLERANCES["output-repeatability"] });
  assert.equal(reason(linearity(Number.NaN, [1, 1], [1, 1], [1, 1]).values.k2), "invalid-input");
  assert.equal(reason(lightField(Number.NEGATIVE_INFINITY, 1, 1, 1, 1).values.resultPercent), "invalid-input");
});

test("U6 a missing DFC makes every linearity value unavailable", () => {
  const result = linearity(null, [10, 0.672], [40, 2.708], [160, 11]);
  for (const value of [...result.values.kermaAt1m, ...result.values.k1, result.values.k2, ...result.values.deviationPercent]) {
    assert.equal(reason(value), "missing-input");
  }
  assert.deepEqual(result.suggestedVerdict, { status: "indisponible", reason: "missing-input", tolerance: GRAPHIE_TOLERANCES["output-linearity"] });
});

test("U7 one zero mAs blocks that K1, K2 and the deviations only", () => {
  const result = linearity(1, [1, 1], [0, 2], [3, 3]);
  assert.deepEqual(result.values.kermaAt1m.map(num), [1, 2, 3]);
  assert.equal(num(result.values.k1[0]), 1);
  assert.equal(reason(result.values.k1[1]), "zero-denominator");
  assert.equal(num(result.values.k1[2]), 1);
  assert.equal(reason(result.values.k2), "zero-denominator");
  assert.deepEqual(result.values.deviationPercent.map(reason), ["zero-denominator", "zero-denominator", "zero-denominator"]);
  assert.equal(result.suggestedVerdict.status, "indisponible");
  const zeroK2 = linearity(1, [1, 1], [1, -1], [1, 0]);
  assert.equal(num(zeroK2.values.k2), 0);
  assert.deepEqual(zeroK2.values.deviationPercent.map(reason), ["zero-denominator", "zero-denominator", "zero-denominator"]);
});

test("U8 a zero D.F.R keeps the sum and blocks the result", () => {
  const result = lightField(0, 2, -3, 1, -4);
  assert.equal(num(result.values.sumAbsGapsMm), 10);
  assert.equal(reason(result.values.resultPercent), "zero-denominator");
  assert.deepEqual(result.suggestedVerdict, { status: "indisponible", reason: "no-tolerance" });
  assert.equal(reason(kvRepeatability(0, 0, 0, 0, 0).values.minDeviationPercent), "zero-denominator");
  assert.equal(reason(kermaRepeatability(1, -1, 0, 0, 0).values.deviationPercent[0]), "zero-denominator");
});

test("U9 overflow is invalid input, never Infinity", () => {
  const big = Number.MAX_VALUE;
  const repeatability = kermaRepeatability(big, big, big, big, big);
  assert.equal(reason(repeatability.values.kermaMean), "invalid-input");
  for (const value of repeatability.values.deviationPercent) assert.equal(reason(value), "invalid-input");
  assert.equal(reason(kvRepeatability(big, big, big, big, big).values.mean), "invalid-input");
  assert.equal(reason(accuracy([Number.MIN_VALUE, big], [1, 1], [1, 1]).values.deviationPercent[0]), "invalid-input");
  assert.equal(reason(linearity(big, [1, big], [1, 1], [1, 1]).values.kermaAt1m[0]), "invalid-input");
  assert.equal(reason(lightField(1, big, big, 1, 1).values.sumAbsGapsMm), "invalid-input");
  assert.ok(!JSON.stringify(repeatability).includes("Infinity"));
});

test("U10 non-number readings and missing input shapes are unavailable, never parsed", () => {
  assert.equal(reason(accuracy(["49.2" as never, 50], [70, 70], [100, 100]).values.deviationPercent[0]), "invalid-input");
  assert.equal(reason(kvRepeatability(69.7, "69.6" as never, 69.7, 69.6, 69.7).values.mean), "invalid-input");
  const run = <T>(result: T | UnsupportedVersionResult) => computed(result);
  assert.deepEqual(run(graphieCalculations.voltageAccuracy(ctx, {} as never)).values.deviationPercent.map(reason), ["missing-input", "missing-input", "missing-input"]);
  assert.equal(reason(run(graphieCalculations.voltageRepeatability(ctx, undefined as never)).values.mean), "missing-input");
  assert.equal(reason(run(graphieCalculations.outputRepeatability(ctx, { kerma: undefined } as never)).values.kermaMean), "missing-input");
  assert.equal(reason(run(graphieCalculations.outputLinearity(ctx, { dfcMeters: 0.7, rows: null } as never)).values.k2), "missing-input");
  assert.equal(reason(run(graphieCalculations.lightFieldCorrespondence(ctx, {} as never)).values.resultPercent), "missing-input");
});

test("U11 unavailable values are separate objects, never shared between result slots", () => {
  const overflow = kermaRepeatability(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  assert.notStrictEqual(overflow.values.kermaMean, overflow.values.deviationPercent[0]);
  const kvOverflow = kvRepeatability(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  assert.notStrictEqual(kvOverflow.values.mean, kvOverflow.values.minDeviationPercent);
  const short = kermaRepeatability(1, 2, 3);
  assert.notStrictEqual(short.values.deviationPercent[0], short.values.deviationPercent[1]);
  assert.notStrictEqual(short.values.kermaMean, short.values.deviationPercent[0]);
  const kv = kvRepeatability(null, 2, 3, 4, 5);
  assert.notStrictEqual(kv.values.minDeviationPercent, kv.values.maxDeviationPercent);
  const missingDfc = linearity(null, [10, 0.672], [40, 2.708], [160, 11]);
  assert.notStrictEqual(missingDfc.values.kermaAt1m[0], missingDfc.values.kermaAt1m[1]);
  assert.notStrictEqual(missingDfc.values.k2, missingDfc.values.deviationPercent[0]);
  const noGaps = lightField(1, 1, null, 1, 1);
  assert.notStrictEqual(noGaps.values.sumAbsGapsMm, noGaps.values.resultPercent);
  const verdict = accuracy([50, 49.2], [70, 69.6], [120, 119.8]).suggestedVerdict;
  assert.ok(verdict.tolerance);
  assert.notStrictEqual(verdict.tolerance, GRAPHIE_TOLERANCES["voltage-accuracy"]);
});

test("negative readings are not rejected", () => {
  assert.equal(num(accuracy([-50, -49.2], [70, 70], [100, 100]).values.deviationPercent[0]), -1.5999999999999945);
  assert.equal(num(lightField(-1, 2, -3, 1, -4).values.resultPercent), -1);
});

// ---------------------------------------------------------------- Versioning and provenance (V1–V5) — rule-derived developer checks (printed tolerances, Story 6.6), not CETEM acceptance

const calls = {
  voltageAccuracy: (context: CalculationContext) => graphieCalculations.voltageAccuracy(context, { rows: [{ kvDisplayed: 50, kvMeasured: 49.2 }, { kvDisplayed: 70, kvMeasured: 69.6 }, { kvDisplayed: 120, kvMeasured: 119.8 }] }),
  voltageRepeatability: (context: CalculationContext) => graphieCalculations.voltageRepeatability(context, { kvMeasured: [69.7, 69.6, 69.7, 69.6, 69.7] }),
  outputRepeatability: (context: CalculationContext) => graphieCalculations.outputRepeatability(context, { kerma: [2.677, 2.708, 2.705, 2.708, 2.705] }),
  outputLinearity: (context: CalculationContext) => graphieCalculations.outputLinearity(context, { dfcMeters: 0.7, rows: [{ mas: 10, kermaDetector: 0.672 }, { mas: 40, kermaDetector: 2.708 }, { mas: 160, kermaDetector: 11 }] }),
  lightFieldCorrespondence: (context: CalculationContext) => graphieCalculations.lightFieldCorrespondence(context, { dfrMeters: 1, gapsMm: [2, -3, 1, -4] }),
} as const;

test("V1 every function refuses the old rule tuple and each single mismatched field", () => {
  const contexts: CalculationContext[] = [
    { ...ctx, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" },
    { catalogueId: "graphie-mobile-pov", catalogueVersion: "1.0.0", schemaVersion: 2, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" },
    { ...ctx, catalogueId: "unknown-catalogue" },
    { ...ctx, catalogueVersion: "1.0.0" },
    { ...ctx, schemaVersion: 2 },
    { ...ctx, ruleId: "cetem-workbook-explicit-formulas" },
    { ...ctx, ruleVersion: "1.0.0" },
  ];
  for (const [name, call] of Object.entries(calls)) {
    for (const context of contexts) {
      assert.deepEqual(call(context), { status: "unavailable", reason: "unsupported-version", context }, `${name} ${JSON.stringify(context)}`);
    }
    const current = call(ctx);
    assert.ok("test" in current, `${name} computes under the current tuple`);
  }
});

test("V2 the calculation identity is the paper-form rule on the 5.6 catalogue", () => {
  assert.deepEqual({ ...GRAPHIE_CALCULATION_IDENTITY }, {
    catalogueId: "graphie-mobile-pov",
    catalogueVersion: "2.0.0",
    schemaVersion: 3,
    ruleId: "cetem-paper-form",
    ruleVersion: "2.0.0",
  });
});

test("V3 every result carries paper-form provenance and workbook cells only where an example exists", () => {
  const expected = {
    voltageAccuracy: { test: "voltage-accuracy", page: 2, section: "Exactitude de la tension", photo: "8fe5a363-a465-46e3-85b6-8930e4cd0383(1).jpg", cells: undefined },
    voltageRepeatability: { test: "voltage-repeatability", page: 2, section: "Répétabilité", photo: "8fe5a363-a465-46e3-85b6-8930e4cd0383(1).jpg", cells: ["C20:C24", "D26", "B26", "C26", "D20", "E20"] },
    outputRepeatability: { test: "output-repeatability", page: 3, section: "Reproductibilité et répétabilité", photo: "f9657912-e6db-4487-99d8-3d30155d7263(1).jpg", cells: ["L25:L29", "N25", "P25:P29"] },
    outputLinearity: { test: "output-linearity", page: 3, section: "Linéarité", photo: "f9657912-e6db-4487-99d8-3d30155d7263(1).jpg", cells: ["K40:K42", "L40:L42", "M40:M42", "N40:N42", "O40", "P40:P42"] },
    lightFieldCorrespondence: { test: "light-field", page: 4, section: "Géométrie du faisceau — correspondance champ lumineux / champ de rayons X", photo: "c2805aec-41dd-4ef9-8cfc-4b1ce7b511ce(1).jpg", cells: undefined },
  } as const;
  for (const [name, call] of Object.entries(calls)) {
    const result = computed(call(ctx));
    const want = expected[name as keyof typeof expected];
    const { test: testName, formulaSource, ...rest } = result as typeof result & { test: string };
    assert.equal(testName, want.test);
    assert.equal(formulaSource.ruleId, "cetem-paper-form");
    assert.equal(formulaSource.paperForm.document, "Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie");
    assert.equal(formulaSource.paperForm.page, want.page);
    assert.equal(formulaSource.paperForm.section, want.section);
    assert.ok(formulaSource.paperForm.photo.endsWith(want.photo), formulaSource.paperForm.photo);
    assert.ok(existsSync(new URL(`../../../${formulaSource.paperForm.photo}`, import.meta.url)), `${formulaSource.paperForm.photo} exists in the repository`);
    if (want.cells === undefined) {
      assert.equal(formulaSource.workbookExample, undefined, `${name} has no workbook example`);
    } else {
      assert.deepEqual(formulaSource.workbookExample, {
        workbook: "CALCUL_graphie_01.xls",
        workbookSha256: "C438DCB202ED71A6CD6FCD3E685FF48449EE1F2CAB788A6F8013798005AF49C4",
        sheet: "Feuil1",
        cells: want.cells,
      });
    }
    for (const key of Object.keys(GRAPHIE_CALCULATION_IDENTITY) as (keyof typeof GRAPHIE_CALCULATION_IDENTITY)[]) {
      assert.equal(rest[key], GRAPHIE_CALCULATION_IDENTITY[key]);
    }
  }
});

test("V4/V5 only the 5 paper tests are exported, with no overall verdict", () => {
  assert.deepEqual(Object.keys(graphieCalculations), [
    "voltageAccuracy",
    "voltageRepeatability",
    "outputRepeatability",
    "outputLinearity",
    "lightFieldCorrespondence",
  ]);
  // @ts-expect-error removed workbook-only rule
  assert.equal(graphieCalculations.outputReproducibility, undefined);
  // @ts-expect-error removed workbook-only rule
  assert.equal(graphieCalculations.outputReproducibilityDeviation, undefined);
  // @ts-expect-error removed workbook-only rule
  assert.equal(graphieCalculations.initialLinearity, undefined);
  // @ts-expect-error removed normalized-mean rule
  assert.equal(graphieCalculations.outputRepeatabilityMeans, undefined);
  assert.deepEqual(Object.keys(GRAPHIE_TOLERANCES), ["voltage-accuracy", "voltage-repeatability", "output-repeatability", "output-linearity", "light-field"]);
});
