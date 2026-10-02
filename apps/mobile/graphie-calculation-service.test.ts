import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import { GRAPHIE_SOURCE_REGRESSION_FIXTURES } from "@cetem-qc/domain/source-regression";
import { calculateGraphieDraft } from "./graphie-calculation-service.js";
import type { GraphieDraftPayload } from "./local-drafts/model.js";

const draft = (values: Record<string, string> = {}): GraphieDraftPayload => ({
  ...GRAPHIE_CALCULATION_IDENTITY,
  values,
});

test("mobile adapter returns domain outcomes with workbook provenance for enabled and unresolved formula families", () => {
  const calls = [
    ["repeatedVoltageMean", [69.7, 69.6, 69.7, 69.6, 69.7]],
    ["outputReproducibility", { kerma: [1.308, 3.154, 3.128], mas: [40, 40, 40] }],
    ["outputRepeatabilityMeans", { kerma: [2.677, 2.708, 2.705, 2.708, 2.705], mas: [40, 40, 40, 40, 40] }],
    ["outputLinearity", { kerma: [0.672, 2.708, 11], mas: [10, 40, 160] }],
    ["initialLinearity", 0.1, 0.2],
  ] as const;
  for (const [name, ...args] of calls) {
    const mobile = calculateGraphieDraft(draft(), name, ...args as never);
    assert.ok("formulaSource" in mobile && mobile.formulaSource.ruleId === GRAPHIE_CALCULATION_IDENTITY.ruleId);
  }
  assert.equal(GRAPHIE_SOURCE_REGRESSION_FIXTURES.length, 6);
});

test("draft adapter forwards raw numeric text without formatting and rejects incomplete version metadata", () => {
  const exactText = "69.70000000000001";
  const payload = draft({ "input.repeated.1": exactText });
  const parsed = Number(payload.values["input.repeated.1"]);
  const outcome = calculateGraphieDraft(payload, "repeatedVoltageMean", [parsed, 69.6, 69.7, 69.6, 69.7]);
  assert.equal(payload.values["input.repeated.1"], exactText);
  assert.equal(outcome.status, "calculated");
  const unsupported = calculateGraphieDraft({ ...payload, ruleVersion: "0.9.0" }, "voltageAccuracy", 50, 49.2);
  assert.deepEqual([unsupported.status, unsupported.status === "unavailable" && unsupported.reason], ["unavailable", "unsupported-version"]);
});

test("mobile calculation adapter rejects every mismatched or missing identity dimension", () => {
  const mismatches = [
    { catalogueId: "other-catalogue" },
    { catalogueVersion: "2.0.0" },
    { schemaVersion: 3 },
    { ruleId: "other-rules" },
    { ruleVersion: "2.0.0" },
    { ruleVersion: undefined },
  ];

  for (const mismatch of mismatches) {
    const result = calculateGraphieDraft(
      { ...draft(), ...mismatch } as GraphieDraftPayload,
      "voltageAccuracy",
      50,
      49.2,
    );
    assert.deepEqual([result.status, result.status === "unavailable" && result.reason], ["unavailable", "unsupported-version"]);
  }
});

