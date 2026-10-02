import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import { GRAPHIE_SOURCE_REGRESSION_FIXTURES } from "@cetem-qc/domain/source-regression";
import { calculateGraphie } from "./calculations.js";
import type { VersionedGraphieCalculation } from "./calculations.js";
import { calculateGraphieDraft } from "../../../../mobile/graphie-calculation-service.js";

test("server calculation entry point returns the shared source-derived result and provenance", () => {
  const result = calculateGraphie({
    context: GRAPHIE_CALCULATION_IDENTITY,
    name: "outputLinearity",
    args: [{ kerma: [0.672, 2.708, 11], mas: [10, 40, 160] }],
  });
  assert.equal(result.status, "calculated");
  assert.equal(result.value, GRAPHIE_SOURCE_REGRESSION_FIXTURES[4]!.expected);
  assert.equal(result.formulaSource.ruleId, GRAPHIE_CALCULATION_IDENTITY.ruleId);
  assert.deepEqual(result.formulaSource.sourceCells, ["O40"]);
});

test("mobile and server entry points match exactly across every source-backed formula and unresolved rule", () => {
  const linearityFixture = GRAPHIE_SOURCE_REGRESSION_FIXTURES[4]!;
  const linearityKerma = ["L40", "L41", "L42"].map((cell) => linearityFixture.inputs[cell]!);
  const linearityMas = ["K40", "K41", "K42"].map((cell) => linearityFixture.inputs[cell]!);
  const linearityMean = calculateGraphie({ context: GRAPHIE_CALCULATION_IDENTITY, name: "outputLinearity", args: [{ kerma: linearityKerma, mas: linearityMas }] });
  assert.equal(linearityMean.status, "calculated");
  if (linearityMean.status !== "calculated" || typeof linearityMean.value !== "number") throw new Error("Expected the source-backed linearity mean");
  const calls: VersionedGraphieCalculation[] = [
    { name: "voltageAccuracy", args: [50, 49.2] },
    { name: "repeatedVoltageMean", args: [[69.7, 69.6, 69.7, 69.6, 69.7]] },
    { name: "repeatedVoltageDeviation", args: [69.6, 69.66] },
    { name: "outputReproducibility", args: [{ kerma: [1.308, 3.154, 3.128], mas: [40, 40, 40] }] },
    { name: "outputReproducibilityDeviation", args: [0.0327, 0.06325] },
    { name: "outputRepeatabilityMeans", args: [{ kerma: [2.677, 2.708, 2.705, 2.708, 2.705], mas: [40, 40, 40, 40, 40] }] },
    { name: "outputRepeatabilityDeviation", args: [2.677, 2.7006] },
    { name: "outputLinearity", args: [{ kerma: [0.672, 2.708, 11], mas: [10, 40, 160] }] },
    { name: "outputLinearityDeviation", args: [0.49 * linearityKerma[0]! / linearityMas[0]!, linearityMean.value] },
    { name: "initialLinearity", args: [0.1, 0.2] },
  ].map((call) => ({ ...call, context: GRAPHIE_CALCULATION_IDENTITY })) as VersionedGraphieCalculation[];
  for (const call of calls) {
    const mobile = calculateGraphieDraft({ ...GRAPHIE_CALCULATION_IDENTITY, values: {} }, call.name, ...call.args as never);
    const server = calculateGraphie(call);
    assert.deepEqual(mobile, server);
  }
});

test("server calculation refuses unknown and missing context dimensions without fallback", () => {
  const contexts = [
    { ...GRAPHIE_CALCULATION_IDENTITY, catalogueId: "other" },
    { ...GRAPHIE_CALCULATION_IDENTITY, catalogueVersion: "2" },
    { ...GRAPHIE_CALCULATION_IDENTITY, schemaVersion: 99 },
    { ...GRAPHIE_CALCULATION_IDENTITY, ruleId: "other" },
    { ...GRAPHIE_CALCULATION_IDENTITY, ruleVersion: "2" },
    { ...GRAPHIE_CALCULATION_IDENTITY, ruleVersion: undefined },
  ] as unknown as import("@cetem-qc/domain").CalculationContext[];
  for (const context of contexts) {
    const result = calculateGraphie({ context, name: "voltageAccuracy", args: [50, 49.2] });
    assert.equal(result.status, "unavailable");
    if (result.status !== "unavailable") throw new Error("Expected unsupported calculation context");
    assert.deepEqual([result.status, result.reason], ["unavailable", "unsupported-version"]);
  }
});

