import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_CATALOGUE } from "@cetem-qc/domain/identity";
import { GRAPHIE_CATALOGUE_VERSION, GRAPHIE_FORM_SCHEMA_VERSION, GRAPHIE_MOBILE_POV_CATALOGUE, GraphiePayloadCompatibilityError, parseGraphiePayload } from "./graphie-pov-catalogue.js";

test("catalogue and calculation identity share one version contract", () => {
  assert.deepEqual(
    {
      catalogueId: GRAPHIE_MOBILE_POV_CATALOGUE.id,
      catalogueVersion: GRAPHIE_MOBILE_POV_CATALOGUE.version,
      schemaVersion: GRAPHIE_MOBILE_POV_CATALOGUE.schemaVersion,
    },
    GRAPHIE_CALCULATION_CATALOGUE,
  );
});

test("catalogue groups French intervention, equipment, instrument, qualitative, measurement and comment fields in order", () => {
  assert.deepEqual(GRAPHIE_MOBILE_POV_CATALOGUE.sections.map((section) => section.id), ["intervention", "equipment", "instruments", "qualitative", "quantitative", "comments"]);
  for (const section of GRAPHIE_MOBILE_POV_CATALOGUE.sections) {
    assert.ok(section.labelFr.length > 0);
    for (const field of section.fields) {
      assert.ok(field.labelFr.length > 0);
      assert.ok(["text", "date", "number", "boolean", "choice", "textarea"].includes(field.type));
      assert.ok(field.provenance.length > 0);
      assert.ok(field.provenance.every((source) => ["CETEM_WORKBOOK", "IAEA_GUIDANCE", "AAPM_GUIDANCE", "PROJECT_POV_DECISION"].includes(source)));
      assert.equal(field.required, undefined);
      assert.equal(field.min, undefined);
      assert.equal(field.max, undefined);
      assert.equal(field.allowNA, undefined);
    }
  }
});

test("legacy Story 5.3 content is preserved without reinterpretation; form payload pins catalogue and schema versions", () => {
  assert.equal(parseGraphiePayload({ content: "existing work" }).legacyContent, "existing work");
  const payload = { catalogueId: GRAPHIE_MOBILE_POV_CATALOGUE.id, catalogueVersion: GRAPHIE_MOBILE_POV_CATALOGUE.version, schemaVersion: GRAPHIE_MOBILE_POV_CATALOGUE.schemaVersion, values: { "intervention.date": "2026-10-01" } };
  assert.deepEqual(parseGraphiePayload(payload).values, payload.values);
  assert.throws(() => parseGraphiePayload({ ...payload, catalogueId: "unknown" }));
});

test("only the supported catalogue/schema pair and plain string records are accepted", () => {
  const supported = { catalogueId: GRAPHIE_MOBILE_POV_CATALOGUE.id, catalogueVersion: GRAPHIE_CATALOGUE_VERSION, schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION, values: { "intervention.contexte": "context" } };
  assert.deepEqual(parseGraphiePayload(supported).values, supported.values);
  for (const payload of [
    { ...supported, catalogueVersion: "2.0.0" },
    { ...supported, schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION + 1 },
    { ...supported, catalogueId: "unknown" },
    { ...supported, schemaVersion: "2" },
    { ...supported, values: ["not", "a", "record"] },
    { ...supported, values: { "intervention.contexte": 12 } },
    { ...supported, values: { "future.field": "must not be dropped" } },
    { ...supported, values: { "qualitative.0": "not a configured option" } },
    { ...supported, content: "must not be dropped" },
    { ...supported, values: null },
  ]) assert.throws(() => parseGraphiePayload(payload), GraphiePayloadCompatibilityError);
});

test("legacy text stays separate from structured context, and beam geometry is project-defined", () => {
  const parsed = parseGraphiePayload({ content: "old notes" });
  assert.equal(parsed.legacyContent, "old notes");
  const payload = { catalogueId: GRAPHIE_MOBILE_POV_CATALOGUE.id, catalogueVersion: GRAPHIE_CATALOGUE_VERSION, schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION, values: { "intervention.contexte": "structured context" }, legacyContent: "old notes" };
  const resumed = parseGraphiePayload(payload);
  assert.equal(resumed.values["intervention.contexte"], "structured context");
  assert.equal(resumed.legacyContent, "old notes");
  const quantitative = GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === "quantitative")!;
  assert.ok(quantitative.fields.find((field) => field.id === "voltage.accuracy")!.provenance.includes("CETEM_WORKBOOK"));
  assert.ok(quantitative.fields.find((field) => field.id === "voltage.reproducibility")!.provenance.includes("CETEM_WORKBOOK"));
  assert.ok(quantitative.fields.find((field) => field.id === "output.reproducibility")!.provenance.includes("CETEM_WORKBOOK"));
  assert.ok(quantitative.fields.find((field) => field.id === "output.linearity")!.provenance.includes("CETEM_WORKBOOK"));
  assert.deepEqual(quantitative.fields.find((field) => field.id === "beam.geometry")!.provenance, ["PROJECT_POV_DECISION"]);
  assert.deepEqual(quantitative.fields.find((field) => field.id === "measurement.other")!.provenance, ["PROJECT_POV_DECISION"]);
});
