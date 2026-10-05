import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "./graphie-identity.js";
import { GRAPHIE_MOBILE_POV_CATALOGUE, validateGraphiePayload } from "./graphie-catalogue.js";

const identity = () => ({ ...GRAPHIE_CALCULATION_IDENTITY });
const payload = (values: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ ...identity(), values, ...extra });

test("V1 a catalogue 2.0.0 payload with blank values, unparseable readings and empty choices is valid and unchanged", () => {
  const values = {
    "header.reportNumber": "",
    "voltage.accuracy.row1.kvMeasured": "abc",
    "voltage.repeatability.row1.kvMeasured": "69,7",
    "visual.integrity": "",
    "mechanical.brakes": "Oui",
  };
  for (const kind of ["sync-draft", "submit"] as const) {
    const result = validateGraphiePayload(payload(values), kind);
    assert.deepEqual(result, { ok: true, payload: payload(values) });
  }
  assert.deepEqual(validateGraphiePayload(payload(), "submit"), { ok: true, payload: payload() }, "an empty form is accepted: no required field exists");
});

test("V2 every structural rule gives its code and the offending path, never the value", () => {
  const cases: Array<[unknown, string, string]> = [
    [{ content: "ancien contenu" }, "UNSUPPORTED_PAYLOAD", "content"],
    [payload({}, { catalogueVersion: "1.0.0" }), "UNSUPPORTED_PAYLOAD_VERSION", "catalogueVersion"],
    [payload({}, { catalogueId: "other" }), "UNSUPPORTED_PAYLOAD_VERSION", "catalogueId"],
    [payload({}, { schemaVersion: "3" }), "UNSUPPORTED_PAYLOAD_VERSION", "schemaVersion"],
    [payload({}, { ruleId: "cetem-workbook-explicit-formulas" }), "UNSUPPORTED_PAYLOAD_VERSION", "ruleId"],
    [payload({}, { ruleVersion: "1.0.0" }), "UNSUPPORTED_PAYLOAD_VERSION", "ruleVersion"],
    [{ values: {} }, "UNSUPPORTED_PAYLOAD_VERSION", "catalogueId"],
    [payload({}, { extra: "x" }), "INVALID_PAYLOAD", "extra"],
    [payload({}, { content: "x" }), "INVALID_PAYLOAD", "content"],
    [{ ...identity(), values: ["a"] }, "INVALID_PAYLOAD", "values"],
    [{ ...identity(), values: null }, "INVALID_PAYLOAD", "values"],
    [{ ...identity() }, "INVALID_PAYLOAD", "values"],
    [payload({ "header.reportNumber": 12 }), "INVALID_PAYLOAD", "values.header.reportNumber"],
    [payload({ "future.field": "secret-value" }), "INVALID_PAYLOAD", "values.future.field"],
    [payload({ "visual.integrity": "Conforme" }), "INVALID_PAYLOAD", "values.visual.integrity"],
    [payload({ "header.interventionNature": "Autre" }), "INVALID_PAYLOAD", "values.header.interventionNature"],
    [payload({ "header.reportNumber": "a\u0000b" }), "INVALID_PAYLOAD", "values.header.reportNumber"],
    [payload({}, { legacyContent: "a\u0000b" }), "INVALID_PAYLOAD", "legacyContent"],
    [payload({}, { legacyContent: 4 }), "INVALID_PAYLOAD", "legacyContent"],
    [null, "INVALID_PAYLOAD", ""],
    [[], "INVALID_PAYLOAD", ""],
  ];
  for (const [input, code, path] of cases) {
    const result = validateGraphiePayload(input, "sync-draft");
    assert.equal(result.ok, false, JSON.stringify(input));
    if (result.ok) continue;
    assert.equal(result.code, code, JSON.stringify(input));
    assert.ok(result.issues.some((issue) => issue.path === path), `${JSON.stringify(input)} → ${JSON.stringify(result.issues)}`);
    assert.equal(JSON.stringify(result).includes("secret-value"), false);
  }
});

test("V2 an unknown key with a NUL or an unpaired surrogate is reported under a storable path", () => {
  const cases: Array<[unknown, string]> = [
    [payload({ "x\u0000y": "a" }), "values.x�y"],
    [payload({}, { "k\u0000": 1 }), "k�"],
    [payload({ "x\uD800": "a" }), "values.x�"],
    [payload({ "\uDC00x": "a" }), "values.�x"],
    [payload({ "x😀": "a" }), "values.x😀"],
  ];
  for (const [input, path] of cases) {
    const result = validateGraphiePayload(input, "sync-draft");
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.code, "INVALID_PAYLOAD");
    assert.deepEqual(result.issues.map((issue) => issue.path), [path]);
  }
});

test("V3 legacyContent is kept on a draft synchronization and refused on a submission", () => {
  const withLegacy = payload({ "header.reportNumber": "R1" }, { legacyContent: "ancien" });
  assert.deepEqual(validateGraphiePayload(withLegacy, "sync-draft"), { ok: true, payload: withLegacy });
  assert.deepEqual(validateGraphiePayload(withLegacy, "submit"), { ok: false, code: "INVALID_PAYLOAD", issues: [{ path: "legacyContent", code: "legacy-content-on-submit" }] });
});

test("D1 no required-field, range, unit or tolerance rule is applied (DR-004 business validation stays blocked on DEP-01/02)", () => {
  // When CETEM approves business validations, this test changes together with a new rule or catalogue version.
  const fields = GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields);
  const extreme = Object.fromEntries(fields.filter((field) => field.type === "number").map((field) => [field.id, "-999999999"]));
  assert.equal(validateGraphiePayload(payload(extreme), "submit").ok, true);
  assert.equal(validateGraphiePayload(payload({ "lightField.gap1": "pas un nombre" }), "submit").ok, true);
  for (const field of fields) {
    assert.equal(field.required, undefined, field.id);
    assert.equal(field.min, undefined, field.id);
    assert.equal(field.max, undefined, field.id);
  }
});
