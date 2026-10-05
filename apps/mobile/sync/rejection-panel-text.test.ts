import assert from "node:assert/strict";
import test from "node:test";
import { fr } from "@cetem-qc/i18n";
import { GRAPHIE_MOBILE_POV_CATALOGUE } from "../graphie-pov-catalogue.js";
import { correctionLinkLine, fieldIssueTexts, rejectionCodeMessage, rejectionIssueLines } from "./rejection-panel-text.js";

// Story 8.2 correction-ui §3: issue lines « section › champ : texte », never values.

const allFieldIds = GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields.map((field) => field.id));
const sectionOf = (id: string) => GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.fields.some((field) => field.id === id))!;
const labelOf = (id: string) => sectionOf(id).fields.find((field) => field.id === id)!.labelFr;

test("X4 a field path is named « section › champ » and a table cell « section › ligne — champ »", () => {
  const first = allFieldIds[0]!;
  assert.deepEqual(rejectionIssueLines([{ path: `values.${first}`, code: "unknown-option" }]), [
    { fieldId: first, labelFr: `${sectionOf(first).labelFr} › ${labelOf(first)}`, textFr: fr.employeeTasks.issueCodes["unknown-option"] },
  ]);
  const section = GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((item) => (item.tables ?? []).some((table) => table.fieldIds.length > 1))!;
  const table = section.tables!.find((item) => item.fieldIds.length > 1)!;
  const cell = table.fieldIds[1]![0]!;
  assert.equal(rejectionIssueLines([{ path: `values.${cell}`, code: "nul-character" }])[0]!.labelFr, `${section.labelFr} › ${table.rowLabelsFr[1]} — ${labelOf(cell)}`);
});

test("X4 unknown fields and other paths are form-level; unknown codes get the generic text", () => {
  assert.deepEqual(rejectionIssueLines([
    { path: "values.future.field", code: "unknown-field" },
    { path: "legacyContent", code: "legacy-content-on-submit" },
    { path: "", code: "code-inconnu" },
  ]), [
    { fieldId: undefined, labelFr: fr.employeeTasks.issueFormLevel, textFr: fr.employeeTasks.issueCodes["unknown-field"] },
    { fieldId: undefined, labelFr: fr.employeeTasks.issueFormLevel, textFr: fr.employeeTasks.issueCodes["legacy-content-on-submit"] },
    { fieldId: undefined, labelFr: fr.employeeTasks.issueFormLevel, textFr: fr.employeeTasks.issueCodeUnknown },
  ]);
  // Inherited object keys are never treated as known codes.
  assert.equal(rejectionIssueLines([{ path: "", code: "toString" }])[0]!.textFr, fr.employeeTasks.issueCodeUnknown);
  assert.equal(rejectionCodeMessage("constructor"), fr.employeeTasks.rejectionCodeUnknown);
  assert.equal(rejectionCodeMessage(null), fr.employeeTasks.rejectionCodeUnknown);
  assert.equal(rejectionCodeMessage("AUDIT_ALREADY_SUBMITTED"), fr.employeeTasks.rejectionCodes.AUDIT_ALREADY_SUBMITTED);
});

test("X4 lines come in catalogue order, then form-level lines; duplicates are merged", () => {
  const first = allFieldIds[0]!;
  const last = allFieldIds.at(-1)!;
  const lines = rejectionIssueLines([
    { path: "", code: "not-an-object" },
    { path: `values.${last}`, code: "unpaired-surrogate" },
    { path: `values.${first}`, code: "nul-character" },
    { path: `values.${last}`, code: "unpaired-surrogate" },
    { path: "", code: "not-an-object" },
  ]);
  assert.deepEqual(lines.map((line) => line.fieldId), [first, last, undefined]);
  assert.deepEqual(fieldIssueTexts([{ path: `values.${first}`, code: "nul-character" }, { path: `values.${first}`, code: "unknown-option" }, { path: "", code: "x" }]), {
    [first]: `${fr.employeeTasks.issueCodes["nul-character"]} ; ${fr.employeeTasks.issueCodes["unknown-option"]}`,
  });
});

test("X4 the correction link line names the refused attempt's device date and time", () => {
  const at = new Date(2026, 9, 5, 9, 7).getTime();
  assert.equal(correctionLinkLine(at), "Correction de la soumission refusée le 05/10/2026 à 09:07");
  assert.equal(correctionLinkLine(Number.NaN), undefined);
});
