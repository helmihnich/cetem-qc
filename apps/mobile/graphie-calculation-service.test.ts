import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY, graphieCalculations } from "@cetem-qc/domain";
import { calculateGraphieDraft } from "./graphie-calculation-service.js";
import type { GraphieDraftPayload } from "./local-drafts/model.js";

const draft = (values: Record<string, string> = {}): GraphieDraftPayload => ({
  ...GRAPHIE_CALCULATION_IDENTITY,
  values,
});

const calls = [
  ["voltageAccuracy", { rows: [{ kvDisplayed: 50, kvMeasured: 49.2 }, { kvDisplayed: 70, kvMeasured: 69.6 }, { kvDisplayed: 120, kvMeasured: 119.8 }] }],
  ["voltageRepeatability", { kvMeasured: [69.7, 69.6, 69.7, 69.6, 69.7] }],
  ["outputRepeatability", { kerma: [2.677, 2.708, 2.705, 2.708, 2.705] }],
  ["outputLinearity", { dfcMeters: 0.7, rows: [{ mas: 10, kermaDetector: 0.672 }, { mas: 40, kermaDetector: 2.708 }, { mas: 160, kermaDetector: 11 }] }],
  ["lightFieldCorrespondence", { dfrMeters: 1, gapsMm: [2, -3, 1, -4] }],
] as const;

test("mobile adapter returns the domain outcome for all 5 paper tests", () => {
  assert.deepEqual(calls.map(([name]) => name), Object.keys(graphieCalculations));
  for (const [name, input] of calls) {
    const mobile = calculateGraphieDraft(draft(), name, input as never);
    const domain = (graphieCalculations[name] as (...args: unknown[]) => unknown)(GRAPHIE_CALCULATION_IDENTITY, input);
    assert.ok("formulaSource" in mobile && mobile.formulaSource?.ruleId === GRAPHIE_CALCULATION_IDENTITY.ruleId);
    assert.deepEqual(mobile, domain);
  }
});

test("draft adapter forwards raw numeric values without formatting and rejects incomplete version metadata", () => {
  const exactText = "69.70000000000001";
  const payload = draft({ "voltage.repeatability.row1.kvMeasured": exactText });
  const parsed = Number(payload.values["voltage.repeatability.row1.kvMeasured"]);
  const outcome = calculateGraphieDraft(payload, "voltageRepeatability", { kvMeasured: [parsed, 69.6, 69.7, 69.6, 69.7] });
  assert.equal(payload.values["voltage.repeatability.row1.kvMeasured"], exactText);
  assert.ok("values" in outcome);
  if ("values" in outcome) assert.deepEqual(outcome.values.max, { status: "calculated", value: parsed });
  const unsupported = calculateGraphieDraft({ ...payload, ruleVersion: "0.9.0" }, "voltageAccuracy", { rows: [] });
  assert.deepEqual([unsupported.status, unsupported.status === "unavailable" && unsupported.reason], ["unavailable", "unsupported-version"]);
});

test("a draft stamped with the old workbook rule is refused for every test", () => {
  const oldRule = { ...draft(), ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" };
  for (const [name, input] of calls) {
    const result = calculateGraphieDraft(oldRule, name, input as never);
    assert.deepEqual(result, {
      status: "unavailable",
      reason: "unsupported-version",
      context: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" },
    });
  }
});

test("mobile calculation adapter rejects every mismatched or missing identity dimension", () => {
  const mismatches = [
    { catalogueId: "other-catalogue" },
    { catalogueVersion: "1.0.0" },
    { schemaVersion: 2 },
    { ruleId: "other-rules" },
    { ruleVersion: "1.0.0" },
    { ruleVersion: undefined },
  ];

  for (const mismatch of mismatches) {
    const result = calculateGraphieDraft(
      { ...draft(), ...mismatch } as GraphieDraftPayload,
      "voltageAccuracy",
      { rows: [{ kvDisplayed: 50, kvMeasured: 49.2 }, { kvDisplayed: 70, kvMeasured: 69.6 }, { kvDisplayed: 120, kvMeasured: 119.8 }] },
    );
    assert.deepEqual([result.status, result.status === "unavailable" && result.reason], ["unavailable", "unsupported-version"]);
  }
});
