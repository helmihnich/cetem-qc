import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_MOBILE_POV_CATALOGUE } from "../graphie-pov-catalogue.js";
import { diffGraphieValues } from "./conflict-diff.js";

// Story 8.1 conflict-ui §5: the differing fields, by section and field label, in catalogue order.

const allFieldIds = GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields.map((field) => field.id));

test("Story 8.1 X1 identical values, and a missing value against an empty one, give no difference", () => {
  assert.deepEqual(diffGraphieValues({}, {}), []);
  const empty = Object.fromEntries(allFieldIds.map((id) => [id, ""]));
  assert.deepEqual(diffGraphieValues(empty, {}), []);
  assert.deepEqual(diffGraphieValues({}, empty), []);
  assert.deepEqual(diffGraphieValues({ "header.reportNumber": "R-1" }, { "header.reportNumber": "R-1" }), []);
});

test("Story 8.1 X2 differing fields are listed in catalogue order with « section › champ », values never included", () => {
  const first = allFieldIds[0]!;
  const last = allFieldIds.at(-1)!;
  const differences = diffGraphieValues({ [last]: "valeur-locale" }, { [first]: "valeur-serveur" });
  assert.deepEqual(differences.map((difference) => difference.fieldId), [first, last]);
  const firstSection = GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.fields.some((field) => field.id === first))!;
  const firstField = firstSection.fields.find((field) => field.id === first)!;
  assert.equal(differences[0]!.labelFr, `${firstSection.labelFr} › ${firstField.labelFr}`);
  assert.ok(differences.every((difference) => !difference.labelFr.includes("valeur-")), "values are not shown");
});

test("Story 8.1 X3 a table cell is named with its paper row, so repeated cell labels stay distinct", () => {
  const section = GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((item) => (item.tables ?? []).some((table) => table.fieldIds.length > 1))!;
  assert.ok(section, "the catalogue has a table with several rows");
  const table = section.tables!.find((item) => item.fieldIds.length > 1)!;
  const [rowA, rowB] = [table.fieldIds[0]![0]!, table.fieldIds[1]![0]!];
  const differences = diffGraphieValues({ [rowA]: "1", [rowB]: "2" }, {});
  const labelOf = (id: string) => section.fields.find((field) => field.id === id)!.labelFr;
  assert.deepEqual(differences.map((difference) => difference.labelFr), [
    `${section.labelFr} › ${table.rowLabelsFr[0]} — ${labelOf(rowA)}`,
    `${section.labelFr} › ${table.rowLabelsFr[1]} — ${labelOf(rowB)}`,
  ]);
  assert.notEqual(differences[0]!.labelFr, differences[1]!.labelFr);
});
