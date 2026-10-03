import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import { GRAPHIE_SOURCE_REGRESSION_FIXTURES } from "@cetem-qc/domain/source-regression";
import { calculateGraphie } from "./calculations.js";
import type { VersionedGraphieCalculation } from "./calculations.js";
import { calculateGraphieDraft } from "../../../../mobile/graphie-calculation-service.js";

const linearityInput = {
  dfcMeters: 0.7,
  rows: [{ mas: 10, kermaDetector: 0.672 }, { mas: 40, kermaDetector: 2.708 }, { mas: 160, kermaDetector: 11 }],
};

test("server calculation entry point returns the shared paper-form result, verdict and provenance", () => {
  const result = calculateGraphie({ context: GRAPHIE_CALCULATION_IDENTITY, name: "outputLinearity", args: [linearityInput] });
  assert.ok("test" in result, "expected a computed result");
  if (!("test" in result)) return;
  const k2 = GRAPHIE_SOURCE_REGRESSION_FIXTURES.find((fixture) => fixture.source.cell === "O40")!;
  assert.deepEqual(result.values.k2, { status: "calculated", value: k2.expected });
  assert.equal(result.formulaSource.ruleId, GRAPHIE_CALCULATION_IDENTITY.ruleId);
  assert.equal(result.formulaSource.paperForm.page, 3);
  assert.deepEqual(result.suggestedVerdict, { status: "conforme", tolerance: { comparison: "abs-lt", limitPercent: 15 } });
});

test("mobile and server entry points match exactly for all 5 paper tests", () => {
  const calls = ([
    { name: "voltageAccuracy", args: [{ rows: [{ kvDisplayed: 50, kvMeasured: 49.2 }, { kvDisplayed: 70, kvMeasured: 69.6 }, { kvDisplayed: 120, kvMeasured: null }] }] },
    { name: "voltageRepeatability", args: [{ kvMeasured: [69.7, 69.6, 69.7, 69.6, 69.7] }] },
    { name: "outputRepeatability", args: [{ kerma: [110, 90, 100, 100, 100] }] },
    { name: "outputLinearity", args: [linearityInput] },
    { name: "lightFieldCorrespondence", args: [{ dfrMeters: 1, gapsMm: [2, -3, 1, -4] }] },
  ] as Omit<VersionedGraphieCalculation, "context">[]).map((call) => ({ ...call, context: GRAPHIE_CALCULATION_IDENTITY })) as VersionedGraphieCalculation[];
  for (const call of calls) {
    const mobile = calculateGraphieDraft({ ...GRAPHIE_CALCULATION_IDENTITY, values: {} }, call.name, ...call.args as never);
    const server = calculateGraphie(call);
    assert.ok("test" in server, `${call.name} computes`);
    assert.deepEqual(mobile, server);
  }
});

test("server calculation refuses the old rule tuple and unknown or missing context dimensions without fallback", () => {
  const contexts = [
    { ...GRAPHIE_CALCULATION_IDENTITY, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" },
    { ...GRAPHIE_CALCULATION_IDENTITY, catalogueId: "other" },
    { ...GRAPHIE_CALCULATION_IDENTITY, catalogueVersion: "2" },
    { ...GRAPHIE_CALCULATION_IDENTITY, schemaVersion: 99 },
    { ...GRAPHIE_CALCULATION_IDENTITY, ruleId: "other" },
    { ...GRAPHIE_CALCULATION_IDENTITY, ruleVersion: "1.0.0" },
    { ...GRAPHIE_CALCULATION_IDENTITY, ruleVersion: undefined },
  ] as unknown as import("@cetem-qc/domain").CalculationContext[];
  for (const context of contexts) {
    const result = calculateGraphie({ context, name: "voltageAccuracy", args: [{ rows: [] }] });
    assert.deepEqual(result, { status: "unavailable", reason: "unsupported-version", context });
  }
});
