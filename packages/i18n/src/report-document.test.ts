import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY, GRAPHIE_MOBILE_POV_CATALOGUE, calculateGraphieResults } from "@cetem-qc/domain";
import type { GraphieCalculationResults } from "@cetem-qc/domain";
import { fr } from "./fr.js";
import { buildReportDocument, REPORT_TEMPLATE_ID, REPORT_TEMPLATE_VERSION } from "./report-document.js";
import type { ReportBlock, ReportCell, ReportDocument } from "./report-document.js";

// Story 11.1 (D1–D7): the pure paper-report builder. Synthetic data only.

const fullValues = (): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const section of GRAPHIE_MOBILE_POV_CATALOGUE.sections) {
    for (const field of section.fields) {
      values[field.id] = field.type === "choice" ? field.options![0]! : field.type === "number" ? "1,5" : field.type === "date" ? "2026-10-08" : `Valeur ${field.id}`;
    }
  }
  Object.assign(values, {
    "header.reportNumber": "R-091", "header.interventionNature": "Convention", "header.refCetembh": "C-12", "header.refClient": "K-34",
    "visual.integrity": "Oui", "visual.cleanliness": "Non", "visual.keyboards": "N.A", "mechanical.brakes": "Oui", "mechanical.movements": "Oui",
    "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,5",
    "voltage.accuracy.row2.kvDisplayed": "70", "voltage.accuracy.row2.kvMeasured": "70",
    "voltage.accuracy.row3.kvDisplayed": "100", "voltage.accuracy.row3.kvMeasured": "99",
    "voltage.repeatability.mas": "10", "voltage.repeatability.maMaxHalf": "100",
    "output.linearity.dfc": "1", "output.linearity.maMaxHalf": "100",
    "lightField.dfr": "1", "lightField.gap1": "1", "lightField.gap2": "1", "lightField.gap3": "1", "lightField.gap4": "1",
    "voltage.accuracy.comments": "Premier commentaire\nSeconde ligne",
  });
  [1, 2, 3, 4, 5].forEach((row, index) => {
    values[`voltage.repeatability.row${row}.kvDisplayed`] = "70";
    values[`voltage.repeatability.row${row}.kvMeasured`] = ["69,8", "70,1", "70", "69,9", "70,2"][index]!;
    values[`voltage.repeatability.row${row}.kerma`] = ["2,5", "2,5", "2,6", "2,5", "2,5"][index]!;
  });
  [1, 2, 3].forEach((row, index) => {
    values[`output.linearity.row${row}.kvDisplayed`] = "70";
    values[`output.linearity.row${row}.mas`] = ["10", "20", "40"][index]!;
    values[`output.linearity.row${row}.kerma`] = ["1", "2", "4"][index]!;
  });
  return values;
};

const summaryText = "Première ligne de synthèse.\nSeconde ligne.";
const build = (values: Record<string, string>, outcome: "machine-conforme" | "machine-non-conforme" = "machine-conforme", results?: Partial<GraphieCalculationResults>) =>
  buildReportDocument({ values, results: results ?? calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, values), identity: GRAPHIE_CALCULATION_IDENTITY, summary: { text: summaryText }, decision: { outcome } });

const cellText = (cell: ReportCell): string => cell.kind === "text" ? cell.text : cell.kind === "mark" ? (cell.checked ? "[x]" : "[ ]") : "";
const flatten = (document: ReportDocument): string[] => document.blocks.flatMap((block: ReportBlock) =>
  block.kind === "table" ? block.rows.flatMap((row) => row.map(cellText)) : block.kind === "pageBreak" ? ["<page>"] : [block.text]);
const verdictRows = (document: ReportDocument) => document.blocks.flatMap((block) => block.kind === "table" ? block.rows : [])
  .filter((row) => row.length === 5 && row[1]?.kind === "text" && row[1].text === fr.report.doc.yesLabel)
  .map((row) => ({ label: cellText(row[0]!), yes: row[2] as { checked: boolean }, no: row[4] as { checked: boolean } }));

test("D1 the full fixture reproduces every section, label and table of the paper report in order", () => {
  const document = build(fullValues());
  const texts = flatten(document);
  const d = fr.report.doc;
  const expectedOrder = [
    d.title, "N° R-091/LCQ", d.etablissement, d.interventionNature, d.serviceLieu, d.demandePonctuelle, d.convention, d.refCetembh, d.refClient,
    "Convention N° C-12", "N° K-34", d.equipmentIdentification, d.tube, d.generator, d.brand, d.model, d.serial, d.dms,
    d.instruments, d.designation, d.kvpMeter, d.dosimeter, d.tapeMeasure, d.qualitativeAspects, d.visualControls, d.visualRows[0]!, d.mechanicalSafety, d.mechanicalRows[0]!,
    "<page>", d.performanceHeading, d.accuracyHeading, d.measure, d.kvDisplayedColumn, d.kvMeasuredColumn, d.accuracyDeviationColumn, ...d.accuracyRows, d.accuracyTolerance, d.comment, d.accuracyVerdict,
    d.repeatabilityHeading, d.mas, d.maMaxHalf, d.kermaMgy, d.kvMeasuredMin, d.kvMeasuredMax, d.kvMeasuredMean, d.kvMinDeviation, d.kvMaxDeviation, d.kermaReuseNote, d.repeatabilityTolerance, d.repeatabilityVerdict, d.outputHeading,
    "<page>", d.outputRepeatabilityHeading, d.kermaDeviation, d.kermaMean, d.outputTolerance, d.outputVerdict,
    d.linearityHeading, d.kermaDetector, d.kermaAt1m, d.k1, d.k1Deviation, d.k2, d.linearityNote, "DFC = 1 m", d.linearityTolerance, d.linearityVerdict, d.beamGeometryHeading, d.lightFieldHeading,
    "<page>", d.dfr, d.sumAbsGaps, d.sumAbsGapsOverDfr, d.lightFieldNote, d.lightFieldVerdict, d.generalComments, d.generalConclusion, fr.conformity.conforme,
    "Première ligne de synthèse.", "Seconde ligne.", d.performedBy, d.nameColumn, d.qualityColumn, d.dateColumn, d.signaturesColumn, d.approvedBy, d.signatureColumn,
  ];
  let cursor = 0;
  for (const label of expectedOrder) {
    const found = texts.findIndex((text, index) => index >= cursor && (text === label || text.startsWith(label)));
    assert.ok(found >= 0, `missing or out of order: ${label}`);
    cursor = found;
  }
  assert.equal(document.blocks.filter((block) => block.kind === "pageBreak").length, 3);
  assert.deepEqual([document.templateId, document.templateVersion], [REPORT_TEMPLATE_ID, REPORT_TEMPLATE_VERSION]);
  assert.deepEqual([document.templateId, document.templateVersion], ["cetem-paper-report", "1.0.0"]);
  assert.ok(texts.includes("Valeur header.etablissement") && texts.includes("Valeur equipment.tube.model") && texts.includes("Valeur instruments.dosimeter.serial"));
  assert.ok(texts.includes(`${fr.report.doc.generalComments} Valeur comments.general`) && texts.includes("Valeur controlPerformedBy.nom"));
  assert.ok(texts.includes("Premier commentaire") || texts.some((text) => text === "Commentaire : Premier commentaire"));
  assert.ok(texts.includes("Seconde ligne"), "comment line breaks become paragraphs");
});

test("D2 a sparse fixture gives empty cells, never throws and invents no text", () => {
  const sparse = build({}, "machine-non-conforme", {});
  const texts = flatten(sparse);
  assert.ok(texts.includes("N° ………/LCQ"));
  assert.ok(!texts.some((text) => /undefined|null|NaN/.test(text)));
  const full = flatten(build(fullValues()));
  assert.ok(texts.length <= full.length);
  assert.ok(sparse.blocks.some((block) => block.kind === "table" && block.rows.some((row) => row.some((cell) => cell.kind === "empty"))));
  assert.deepEqual(verdictRows(sparse).map((row) => [row.yes.checked, row.no.checked]), Array(5).fill([false, false]));
  assert.ok(!texts.some((text) => text.startsWith(`${fr.report.doc.unavailable} —`)), "a missing result prints no reason line");
});

test("D3 verdict marks follow the stored verdicts; unavailable prints its reason; light field has no tolerance", () => {
  const values = fullValues();
  const results = calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, values);
  const conforming = verdictRows(build(values));
  assert.deepEqual(conforming.slice(0, 4).map((row) => [row.yes.checked, row.no.checked]), [[true, false], [true, false], [true, false], [true, false]]);
  assert.deepEqual([conforming[4]!.yes.checked, conforming[4]!.no.checked], [false, false], "light field marks neither box");
  assert.ok(flatten(build(values)).includes(`${fr.report.doc.unavailable} — ${fr.report.doc.noTolerance}`));

  const nonConforming = { ...values, "voltage.accuracy.row1.kvMeasured": "20" };
  const marks = verdictRows(build(nonConforming));
  assert.deepEqual([marks[0]!.yes.checked, marks[0]!.no.checked], [false, true]);

  for (const [reason, missing] of [["missing-input", ""], ["invalid-input", "abc"]] as const) {
    const unavailable = { ...values, "voltage.accuracy.row2.kvMeasured": missing };
    const document = build(unavailable);
    assert.deepEqual([verdictRows(document)[0]!.yes.checked, verdictRows(document)[0]!.no.checked], [false, false], reason);
    assert.ok(flatten(document).includes(`${fr.report.doc.unavailable} — ${fr.graphieResults.reasons[reason]}`), reason);
  }
  const zero = build({ ...values, "voltage.accuracy.row2.kvDisplayed": "0" });
  assert.ok(flatten(zero).includes(`${fr.report.doc.unavailable} — ${fr.graphieResults.reasons["zero-denominator"]}`));

  const unsupported = calculateGraphieResults({ ...GRAPHIE_CALCULATION_IDENTITY, ruleVersion: "9.9.9" } as unknown as typeof GRAPHIE_CALCULATION_IDENTITY, values);
  const unsupportedDocument = build(values, "machine-conforme", unsupported);
  assert.ok(flatten(unsupportedDocument).filter((text) => text === `${fr.report.doc.unavailable} — ${fr.report.doc.unsupportedVersion}`).length === 5);
  assert.deepEqual(verdictRows(unsupportedDocument).map((row) => [row.yes.checked, row.no.checked]), Array(5).fill([false, false]));
  const accuracyTable = unsupportedDocument.blocks.find((block) => block.kind === "table" && block.rows[0]?.some((cell) => cell.kind === "text" && cell.text === fr.report.doc.accuracyDeviationColumn));
  assert.ok(accuracyTable && accuracyTable.kind === "table" && accuracyTable.rows.slice(1).every((row) => row[3]!.kind === "empty"), "calculated cells are empty");
  assert.ok(results.voltageAccuracy);
});

test("D4 both decisions print their exact label before the confirmed summary, whatever the verdicts", () => {
  const values = fullValues();
  const permutations = [values, { ...values, "voltage.accuracy.row1.kvMeasured": "20" }, {}];
  for (const outcome of ["machine-conforme", "machine-non-conforme"] as const) {
    const label = outcome === "machine-conforme" ? "Machine conforme" : "Machine non conforme";
    const printed = permutations.map((variant) => {
      const texts = flatten(build(variant, outcome));
      const heading = texts.indexOf(fr.report.doc.generalConclusion);
      assert.deepEqual(texts.slice(heading + 1, heading + 4), [label, "Première ligne de synthèse.", "Seconde ligne."]);
      return texts.slice(heading + 1, heading + 2)[0];
    });
    assert.deepEqual(new Set(printed), new Set([label]));
  }
});

test("D5 signature cells are empty, approver cells are pre-printed, and nothing says candidate or official", () => {
  const document = build(fullValues());
  const tables = document.blocks.filter((block) => block.kind === "table");
  const signature = (header: string) => {
    const table = tables.find((block) => block.kind === "table" && block.rows.some((row) => row.some((cell) => cell.kind === "text" && cell.text === header)))!;
    assert.equal(table.kind, "table");
    if (table.kind !== "table") return [];
    const headerIndex = table.rows.findIndex((row) => row.some((cell) => cell.kind === "text" && cell.text === header));
    return table.rows.slice(headerIndex + 1).map((row) => row[3]!);
  };
  assert.ok(signature(fr.report.doc.signaturesColumn).every((cell) => cell.kind === "empty"));
  assert.ok(signature(fr.report.doc.signatureColumn).every((cell) => cell.kind === "empty"));
  const texts = flatten(document);
  assert.ok(texts.includes("HENIDI Rache") && texts.includes("CHEF DE SERVICE"));
  assert.ok(!texts.some((text) => /candidat|officiel|signature électronique/i.test(text.replace(fr.report.doc.signaturesColumn, "").replace(fr.report.doc.signatureColumn, ""))));
  assert.ok(!JSON.stringify(document).match(/candidat|officiel/i));
});

test("D6 numbers keep full precision with a decimal comma and are never rounded", () => {
  const values = { ...fullValues(), "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,123456789" };
  const results = calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, values);
  const deviation = results.voltageAccuracy;
  assert.ok("values" in deviation);
  const first = deviation.values.deviationPercent[0]!;
  assert.equal(first.status, "calculated");
  const expected = `${String((first as { value: number }).value).replace(".", ",")} %`;
  const texts = flatten(build(values));
  assert.ok(texts.includes(expected), expected);
  assert.ok(texts.includes("49,123456789"), "entered strings are shown verbatim");
  assert.ok(!texts.some((text) => /\d\.\d/.test(text) && !text.includes("…")), "no decimal point is printed");
});

test("D7 the same input twice gives an identical block tree", () => {
  const values = fullValues();
  assert.deepEqual(build(values), build(values));
  assert.equal(JSON.stringify(build(values)), JSON.stringify(build(values)));
});
