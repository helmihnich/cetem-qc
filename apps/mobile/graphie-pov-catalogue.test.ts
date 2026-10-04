import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_CATALOGUE, GRAPHIE_CALCULATION_FIELD_ID_LIST, GRAPHIE_CALCULATION_RULE_ID, GRAPHIE_CALCULATION_RULE_VERSION } from "@cetem-qc/domain";
import { GRAPHIE_RESULT_ORDER, presentGraphieMeasurements } from "@cetem-qc/i18n/graphie-results";
import { GRAPHIE_CATALOGUE_VERSION, GRAPHIE_FORM_SCHEMA_VERSION, GRAPHIE_MOBILE_POV_CATALOGUE, GraphiePayloadCompatibilityError, KERMA_REUSE_HELP_FR, createNewGraphieDraftValues, parseGraphiePayload } from "./graphie-pov-catalogue.js";

const sections = GRAPHIE_MOBILE_POV_CATALOGUE.sections;
const fields = sections.flatMap((section) => section.fields);
const fieldById = new Map(fields.map((field) => [field.id, field]));
const section = (id: string) => sections.find((candidate) => candidate.id === id)!;
const rows = (prefix: string, count: number, columns: readonly string[]) =>
  Array.from({ length: count }, (_, row) => columns.map((column) => `${prefix}.row${row + 1}.${column}`)).flat();

const EXPECTED_FIELD_IDS = [
  "header.reportNumber", "header.etablissement", "header.serviceLieu", "header.interventionNature", "header.refCetembh", "header.refClient",
  ...["equipment", "tube", "generator"].flatMap((unit) => ["brand", "model", "serial", "dms"].map((attribute) => `equipment.${unit}.${attribute}`)),
  ...["kvpMeter", "dosimeter", "tapeMeasure"].flatMap((instrument) => ["brand", "model", "serial"].map((attribute) => `instruments.${instrument}.${attribute}`)),
  "visual.integrity", "visual.cleanliness", "visual.keyboards", "visual.accessories", "visual.connectorsCables",
  "mechanical.brakes", "mechanical.movements",
  ...rows("voltage.accuracy", 3, ["kvDisplayed", "kvMeasured"]), "voltage.accuracy.comments",
  "voltage.repeatability.mas", "voltage.repeatability.maMaxHalf", ...rows("voltage.repeatability", 5, ["kvDisplayed", "kvMeasured", "kerma"]),
  "voltage.repeatability.voltageComments", "voltage.repeatability.outputComments",
  ...rows("output.linearity", 3, ["kvDisplayed", "mas", "kerma"]), "output.linearity.maMaxHalf", "output.linearity.dfc", "output.linearity.comments",
  "lightField.kv", "lightField.mas", "lightField.dfr", "lightField.gap1", "lightField.gap2", "lightField.gap3", "lightField.gap4", "lightField.comments",
  "comments.general",
  "controlPerformedBy.nom", "controlPerformedBy.qualite", "controlPerformedBy.dateControle",
];

const REMOVED_V1_FIELD_IDS = [
  "intervention.date", "intervention.etablissement", "intervention.service", "intervention.technicien", "intervention.contexte", "intervention.commentaires",
  ...[0, 1, 2, 3, 4, 5, 6].map((index) => `equipment.identity.${index}`),
  "instrument.name", "instrument.manufacturer", "instrument.model", "instrument.serial", "instrument.calibration",
  ...[0, 1, 2, 3, 4].map((index) => `qualitative.${index}`), "qualitative.observations",
  "voltage.accuracy", "voltage.reproducibility", "output.reproducibility", "output.linearity", "beam.geometry", "measurement.other",
  "header.conventionNumber",
];

const current = () => ({ catalogueId: GRAPHIE_MOBILE_POV_CATALOGUE.id, catalogueVersion: GRAPHIE_CATALOGUE_VERSION, schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION, ruleId: GRAPHIE_CALCULATION_RULE_ID, ruleVersion: GRAPHIE_CALCULATION_RULE_VERSION });

test("catalogue and calculation identity share one version contract: graphie-mobile-pov 2.0.0 / schema 3", () => {
  assert.deepEqual(
    { catalogueId: GRAPHIE_MOBILE_POV_CATALOGUE.id, catalogueVersion: GRAPHIE_MOBILE_POV_CATALOGUE.version, schemaVersion: GRAPHIE_MOBILE_POV_CATALOGUE.schemaVersion },
    GRAPHIE_CALCULATION_CATALOGUE,
  );
  assert.deepEqual(GRAPHIE_CALCULATION_CATALOGUE, { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3 });
  assert.deepEqual([GRAPHIE_CALCULATION_RULE_ID, GRAPHIE_CALCULATION_RULE_VERSION], ["cetem-paper-form", "2.0.0"]);
});

test("sections follow the paper form order", () => {
  assert.deepEqual(sections.map((candidate) => candidate.id), ["header", "equipment", "instruments", "visual", "mechanical", "voltageAccuracy", "repeatability", "linearity", "lightField", "comments", "controlPerformedBy"]);
  assert.equal(sections.at(-1)!.labelFr, "Contrôle effectué par");
});

test("flattened field IDs are exactly the 84 contract IDs, each unique", () => {
  assert.equal(EXPECTED_FIELD_IDS.length, 84);
  assert.deepEqual(fields.map((field) => field.id), EXPECTED_FIELD_IDS);
  assert.equal(new Set(fields.map((field) => field.id)).size, fields.length);
});

test("every field has a French label, an allowed type and provenance, and no rule metadata", () => {
  for (const candidate of sections) assert.ok(candidate.labelFr.length > 0);
  for (const field of fields) {
    assert.ok(field.labelFr.trim().length > 0, field.id);
    assert.ok(["text", "date", "number", "choice", "textarea"].includes(field.type), field.id);
    assert.ok(field.provenance.includes("CETEM_PAPER_FORM"), field.id);
    assert.ok(field.provenance.every((source) => ["CETEM_PAPER_FORM", "CETEM_WORKBOOK"].includes(source)), field.id);
    assert.equal(field.required, undefined);
    assert.equal(field.min, undefined);
    assert.equal(field.max, undefined);
    assert.equal(field.allowNA, undefined);
  }
  const workbook = fields.filter((field) => field.provenance.includes("CETEM_WORKBOOK")).map((field) => field.id);
  assert.deepEqual(workbook, [
    ...rows("voltage.accuracy", 3, ["kvDisplayed", "kvMeasured"]),
    "voltage.repeatability.mas", ...rows("voltage.repeatability", 5, ["kvMeasured", "kerma"]),
    ...rows("output.linearity", 3, ["mas", "kerma"]),
  ]);
});

test("choice fields offer exactly the paper options", () => {
  const checks = [...section("visual").fields, ...section("mechanical").fields];
  assert.equal(checks.length, 7);
  for (const field of checks) {
    assert.equal(field.type, "choice");
    assert.deepEqual(field.options, ["N.A", "Oui", "Non"]);
  }
  assert.deepEqual(fieldById.get("header.interventionNature")!.options, ["Demande ponctuelle", "Convention"]);
  assert.deepEqual(fields.filter((field) => field.type === "choice").map((field) => field.id), ["header.interventionNature", ...checks.map((field) => field.id)]);
});

test("no v1 options, removed IDs, verdicts or signatures remain in the catalogue", () => {
  const serialized = JSON.stringify(GRAPHIE_MOBILE_POV_CATALOGUE);
  for (const forbidden of ["Conforme", "À signaler", "Non vérifié", "concluant", "Conclusion générale", "Contrôle approuvé par", "ignature"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  for (const removed of REMOVED_V1_FIELD_IDS) assert.equal(fieldById.has(removed), false, removed);
  for (const removedSection of ["intervention", "qualitative", "quantitative"]) assert.equal(sections.some((candidate) => candidate.id === removedSection), false);
});

test("paper defaults are exact and exist only where pre-printed", () => {
  const expected = {
    "header.interventionNature": "Convention",
    "instruments.kvpMeter.brand": "Fluke Biomedical", "instruments.kvpMeter.model": "8000", "instruments.kvpMeter.serial": "105991",
    "instruments.dosimeter.brand": "Fluke Biomedical", "instruments.dosimeter.model": "8000", "instruments.dosimeter.serial": "105991",
    "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row2.kvDisplayed": "70",
    ...Object.fromEntries([1, 2, 3, 4, 5].map((row) => [`voltage.repeatability.row${row}.kvDisplayed`, "70"])),
    ...Object.fromEntries([1, 2, 3].map((row) => [`output.linearity.row${row}.kvDisplayed`, "70"])),
    "output.linearity.row1.mas": "10",
    "lightField.kv": "70", "lightField.mas": "4", "lightField.dfr": "1",
  };
  assert.deepEqual(Object.fromEntries(fields.filter((field) => field.defaultValue !== undefined).map((field) => [field.id, field.defaultValue])), expected);
  assert.deepEqual(createNewGraphieDraftValues(), expected);
  assert.notEqual(createNewGraphieDraftValues(), createNewGraphieDraftValues());
});

test("tables declare explicit rows and every cell is a flattened field", () => {
  const tables = sections.flatMap((candidate) => (candidate.tables ?? []).map((table) => ({ sectionId: candidate.id, table })));
  const bySection = Object.fromEntries(tables.map(({ sectionId, table }) => [sectionId, table]));
  assert.deepEqual(Object.keys(bySection), ["equipment", "instruments", "voltageAccuracy", "repeatability", "linearity"]);
  assert.deepEqual(bySection.voltageAccuracy!.rowLabelsFr, ["KV min", "KV", "KV max"]);
  assert.deepEqual(bySection.repeatability!.rowLabelsFr, ["Mesure 1", "Mesure 2", "Mesure 3", "Mesure 4", "Mesure 5"]);
  assert.deepEqual(bySection.linearity!.rowLabelsFr, ["Mesure 1", "Mesure 2", "Mesure 3"]);
  // Grids are grouped per device (one row per unit or instrument) so a phone shows one group per device.
  assert.deepEqual(bySection.equipment!.rowLabelsFr, ["Équipement", "Tube à rayons X", "Générateur HT"]);
  assert.deepEqual(bySection.equipment!.columnLabelsFr, ["Marque", "Modèle", "N° de série", "D.M.S"]);
  assert.deepEqual(bySection.equipment!.fieldIds[1], ["equipment.tube.brand", "equipment.tube.model", "equipment.tube.serial", "equipment.tube.dms"]);
  assert.deepEqual(bySection.instruments!.fieldIds[1], ["instruments.dosimeter.brand", "instruments.dosimeter.model", "instruments.dosimeter.serial"]);
  assert.deepEqual(bySection.instruments!.rowLabelsFr, ["KVp mètre", "Dosimètre", "Mètre-ruban"]);
  assert.deepEqual(bySection.instruments!.columnLabelsFr, ["Marque", "Modèle", "N° de série"]);
  assert.deepEqual(bySection.repeatability!.fieldIds[1], ["voltage.repeatability.row2.kvDisplayed", "voltage.repeatability.row2.kvMeasured", "voltage.repeatability.row2.kerma"]);
  assert.equal(bySection.repeatability!.helpFr, KERMA_REUSE_HELP_FR);
  const gridCells = [...bySection.equipment!.fieldIds.flat(), ...bySection.instruments!.fieldIds.flat()];
  assert.equal(new Set(gridCells).size, 21);
  for (const { sectionId, table } of tables) {
    assert.equal(table.fieldIds.length, table.rowLabelsFr.length);
    for (const row of table.fieldIds) {
      assert.equal(row.length, table.columnLabelsFr.length);
      for (const id of row) assert.ok(section(sectionId).fields.some((field) => field.id === id), id);
    }
  }
});

test("units, types and labels follow the paper", () => {
  const unitOf = (id: string) => fieldById.get(id)!.unit;
  for (const id of [...rows("voltage.accuracy", 3, ["kvDisplayed", "kvMeasured"]), ...rows("voltage.repeatability", 5, ["kvDisplayed", "kvMeasured"]), ...rows("output.linearity", 3, ["kvDisplayed"]), "lightField.kv"]) assert.equal(unitOf(id), "kV", id);
  for (const id of [...rows("voltage.repeatability", 5, ["kerma"]), ...rows("output.linearity", 3, ["kerma"])]) assert.equal(unitOf(id), "mGy", id);
  for (const id of ["voltage.repeatability.mas", ...rows("output.linearity", 3, ["mas"]), "lightField.mas"]) assert.equal(unitOf(id), "mAs", id);
  for (const id of ["voltage.repeatability.maMaxHalf", "output.linearity.maMaxHalf"]) assert.equal(unitOf(id), "mA", id);
  for (const id of ["output.linearity.dfc", "lightField.dfr"]) assert.equal(unitOf(id), "m", id);
  for (const index of [1, 2, 3, 4]) {
    assert.equal(unitOf(`lightField.gap${index}`), "mm");
    assert.equal(fieldById.get(`lightField.gap${index}`)!.labelFr, `Écart ${index}`);
  }
  for (const field of fields.filter((candidate) => candidate.unit !== undefined)) assert.equal(field.type, "number", field.id);
  assert.equal(fieldById.get("controlPerformedBy.dateControle")!.type, "date");
  assert.deepEqual(section("controlPerformedBy").fields.map((field) => [field.id, field.labelFr, field.type]), [
    ["controlPerformedBy.nom", "Nom et prénom", "text"], ["controlPerformedBy.qualite", "Qualité", "text"], ["controlPerformedBy.dateControle", "Date de contrôle", "date"],
  ]);
  assert.equal(fieldById.get("header.refCetembh")!.labelFr, "Réf. CETEMBH (Convention N°)");
  assert.equal(fieldById.get("header.refClient")!.labelFr, "Réf. Client (N°)");
  assert.equal(fieldById.get("header.etablissement")!.labelFr, "Établissement");
  assert.equal(section("visual").fields.some((field) => field.type === "textarea"), false);
  assert.equal(section("mechanical").fields.some((field) => field.type === "textarea"), false);
  const comments = fields.filter((field) => field.type === "textarea").map((field) => field.id);
  assert.deepEqual(comments, ["voltage.accuracy.comments", "voltage.repeatability.voltageComments", "voltage.repeatability.outputComments", "output.linearity.comments", "lightField.comments", "comments.general"]);
  assert.deepEqual(section("linearity").fields.slice(-3).map((field) => field.id), ["output.linearity.maMaxHalf", "output.linearity.dfc", "output.linearity.comments"]);
  assert.deepEqual(section("repeatability").fields.slice(0, 2).map((field) => field.id), ["voltage.repeatability.mas", "voltage.repeatability.maMaxHalf"]);
  assert.equal(fields.filter((field) => /kerma/i.test(field.id) && field.id.startsWith("voltage.")).length, 5);
});

test("a schema-3 payload with values across all sections round-trips unchanged", () => {
  const values = Object.fromEntries(EXPECTED_FIELD_IDS.map((id, index) => [id, fieldById.get(id)!.type === "choice" ? fieldById.get(id)!.options![index % fieldById.get(id)!.options!.length]! : `${index},5`]));
  values["voltage.repeatability.row2.kvMeasured"] = "69,7";
  values["visual.integrity"] = "";
  const payload = { ...current(), values };
  assert.deepEqual(parseGraphiePayload(payload), payload);
  assert.deepEqual(parseGraphiePayload({ ...payload, legacyContent: "old" }).legacyContent, "old");
});

test("v1 and mixed identity tuples are incompatible", () => {
  for (const tuple of [
    { catalogueVersion: "1.0.0", schemaVersion: 2 },
    { catalogueVersion: "2.0.0", schemaVersion: 2 },
    { catalogueVersion: "1.0.0", schemaVersion: 3 },
  ]) {
    assert.throws(() => parseGraphiePayload({ ...current(), ...tuple, values: {} }), GraphiePayloadCompatibilityError);
  }
  assert.throws(() => parseGraphiePayload({ catalogueId: "graphie-mobile-pov", catalogueVersion: "1.0.0", schemaVersion: 2, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "intervention.contexte": "v1" } }), GraphiePayloadCompatibilityError);
});

test("schema-3 payloads carrying removed v1 fields or v1 options are rejected", () => {
  for (const values of [
    { "voltage.accuracy": "49.2" },
    { "qualitative.0": "Conforme" },
    { "visual.integrity": "Conforme" },
    { "mechanical.brakes": "Non vérifié" },
    { "header.interventionNature": "Autre" },
  ]) assert.throws(() => parseGraphiePayload({ ...current(), values }), GraphiePayloadCompatibilityError);
});

test("legacy Story 5.3 content is preserved and malformed shapes stay rejected", () => {
  assert.equal(parseGraphiePayload({ content: "existing work" }).legacyContent, "existing work");
  assert.deepEqual(parseGraphiePayload({ content: "existing work" }).values, {});
  const supported = { ...current(), values: { "header.etablissement": "CHU" } };
  assert.deepEqual(parseGraphiePayload(supported).values, supported.values);
  for (const payload of [
    { ...supported, schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION + 1 },
    { ...supported, catalogueId: "unknown" },
    { ...supported, ruleId: "unknown-rule" },
    { ...supported, ruleVersion: "1.0.0" },
    { ...supported, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" },
    { catalogueId: supported.catalogueId, catalogueVersion: supported.catalogueVersion, schemaVersion: supported.schemaVersion, values: supported.values },
    { ...supported, schemaVersion: "3" },
    { ...supported, values: ["not", "a", "record"] },
    { ...supported, values: { "header.etablissement": 12 } },
    { ...supported, values: { "future.field": "must not be dropped" } },
    { ...supported, content: "must not be dropped" },
    { ...supported, values: null },
    { ...supported, legacyContent: 4 },
    null,
    [],
  ]) assert.throws(() => parseGraphiePayload(payload), GraphiePayloadCompatibilityError);
});

test("C1 every field ID read by the domain calculation mapping is a catalogue number field", () => {
  assert.equal(GRAPHIE_CALCULATION_FIELD_ID_LIST.length, 28);
  for (const id of GRAPHIE_CALCULATION_FIELD_ID_LIST) {
    assert.equal(fieldById.get(id)?.type, "number", id);
  }
});

test("C2 every measured-value label and unit shown to the Responsable is the catalogue label and unit of that field", () => {
  const readings = GRAPHIE_RESULT_ORDER.flatMap((name) => presentGraphieMeasurements(name, {}).flatMap((line) => line.readings));
  assert.equal(readings.length, GRAPHIE_CALCULATION_FIELD_ID_LIST.length);
  for (const reading of readings) {
    const field = fieldById.get(reading.fieldId);
    assert.ok(field, reading.fieldId);
    assert.deepEqual([reading.label, reading.unit], [field.labelFr, field.unit], reading.fieldId);
  }
});
