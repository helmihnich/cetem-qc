import type { CalculationContext, GraphieCalculationResults, GraphieFormValues, GraphieValue, GraphieVerdict } from "@cetem-qc/domain";
import { fr } from "./fr.js";
import { formatNumber } from "./graphie-results.js";

const d = fr.report.doc;
const reasons = fr.graphieResults.reasons;

/** A table cell of the report. Renderer-neutral: no Word types. */
export type ReportCell =
  | { kind: "text"; text: string; bold?: boolean; colSpan?: number }
  | { kind: "mark"; checked: boolean; colSpan?: number }
  | { kind: "empty"; colSpan?: number };

/** A block of the report, in reading order. */
export type ReportBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string; bold?: boolean }
  | { kind: "table"; rows: ReportCell[][] }
  | { kind: "pageBreak" };

/** The paper report as pure data: a logo in the header, a « n/4 » footer and the blocks of the four pages. */
export interface ReportDocument {
  templateId: string;
  templateVersion: string;
  header: { logo: "cetem-logo" };
  footer: { pageNumbering: true; totalPages: 4 };
  blocks: ReportBlock[];
}

export const REPORT_TEMPLATE_ID = "cetem-paper-report";
export const REPORT_TEMPLATE_VERSION = "1.0.0";

export interface ReportDocumentInput {
  values: GraphieFormValues;
  results: Partial<GraphieCalculationResults>;
  identity?: CalculationContext;
  summary: { text: string };
  decision: { outcome: "machine-conforme" | "machine-non-conforme" };
}

const text = (value: string, extra: { bold?: boolean; colSpan?: number } = {}): ReportCell => ({ kind: "text", text: value, ...extra });
const empty = (colSpan?: number): ReportCell => (colSpan ? { kind: "empty", colSpan } : { kind: "empty" });
const mark = (checked: boolean): ReportCell => ({ kind: "mark", checked });
/** A stored string cell: rendered as is, an empty string is an empty cell. */
const stored = (value: string, extra: { colSpan?: number } = {}): ReportCell => (value === "" ? empty(extra.colSpan) : text(value, extra));
const paragraph = (value: string, bold = false): ReportBlock => ({ kind: "paragraph", text: value, ...(bold ? { bold: true } : {}) });
const heading = (level: 1 | 2 | 3, value: string): ReportBlock => ({ kind: "heading", level, text: value });
const table = (rows: ReportCell[][]): ReportBlock => ({ kind: "table", rows });

/** Calculated value at full precision with the decimal comma; empty when unavailable or absent. */
const calculated = (value: GraphieValue | undefined, suffix = ""): string =>
  value && value.status === "calculated" ? `${formatNumber(value.value)}${suffix}` : "";
const calculatedCell = (value: GraphieValue | undefined, suffix = "", colSpan?: number): ReportCell => stored(calculated(value, suffix), colSpan ? { colSpan } : {});

type AnyResult = GraphieCalculationResults[keyof GraphieCalculationResults] | undefined;

function verdictOf(result: AnyResult): GraphieVerdict | undefined {
  return result && "suggestedVerdict" in result ? result.suggestedVerdict : undefined;
}

/** « Test … concluant : OUI ☐ NON ☐ » marked from the stored suggested verdict, with the reason when unavailable. */
function verdictBlocks(label: string, result: AnyResult): ReportBlock[] {
  const verdict = verdictOf(result);
  const row = table([[text(label, { colSpan: 3 }), text(d.yesLabel), mark(verdict?.status === "conforme"), text(d.noLabel), mark(verdict?.status === "non-conforme")]]);
  if (verdict?.status === "indisponible") {
    const reason = verdict.reason === "no-tolerance" ? d.noTolerance : reasons[verdict.reason];
    return [row, paragraph(`${d.unavailable} — ${reason}`)];
  }
  if (!verdict && result) return [row, paragraph(`${d.unavailable} — ${d.unsupportedVersion}`)];
  return [row];
}

const lines = (value: string): string[] => value.split(/\r\n|\r|\n/);

/** « Commentaire : » followed by the stored comment; line breaks become paragraphs. */
function commentBlocks(label: string, value: string): ReportBlock[] {
  const [first = "", ...rest] = lines(value);
  return [paragraph(first === "" ? label : `${label} ${first}`), ...rest.map((line) => paragraph(line))];
}

function reportNumberLine(raw: string): string {
  if (raw === "") return `${d.numberPrefix} ${d.numberPlaceholder}${d.numberSuffix}`;
  return `${d.numberPrefix} ${raw}${raw.endsWith(d.numberSuffix) ? "" : d.numberSuffix}`;
}

/**
 * Builds the paper report « Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie » from the accepted
 * values, the stored server results, the confirmed summary text and the recorded decision. Pure: no clock, no
 * randomness, no recalculation, no AI draft. Missing values are empty cells, never invented ones.
 */
export function buildReportDocument(input: ReportDocumentInput): ReportDocument {
  const { values, results } = input;
  const v = (id: string): string => (Object.prototype.hasOwnProperty.call(values, id) ? values[id]! : "");
  const choice = (id: string, option: string): ReportCell => (v(id) === option ? text("X") : empty());
  const blocks: ReportBlock[] = [];

  // Page 1/4
  blocks.push(heading(1, d.title), paragraph(reportNumberLine(v("header.reportNumber")), true));
  blocks.push(table([
    [text(d.etablissement, { bold: true }), stored(v("header.etablissement")), text(d.interventionNature, { bold: true, colSpan: 2 })],
    [text(d.serviceLieu, { bold: true }), stored(v("header.serviceLieu")), text(d.demandePonctuelle), text(d.convention)],
    [empty(), empty(), v("header.interventionNature") === "Demande ponctuelle" ? text("X") : empty(), v("header.interventionNature") === "Convention" ? text("X") : empty()],
    [text(d.refCetembh, { bold: true, colSpan: 2 }), text(d.refClient, { bold: true, colSpan: 2 })],
    [text(`${d.conventionNumber} ${v("header.refCetembh")}`.trimEnd(), { colSpan: 2 }), text(`${d.clientNumber} ${v("header.refClient")}`.trimEnd(), { colSpan: 2 })],
  ]));
  const equipmentRow = (label: string, attribute: string): ReportCell[] => [
    text(label, { bold: true }),
    stored(v(`equipment.equipment.${attribute}`)), stored(v(`equipment.tube.${attribute}`)), stored(v(`equipment.generator.${attribute}`)),
  ];
  blocks.push(table([
    [empty(), text(d.equipmentIdentification, { bold: true }), text(d.tube, { bold: true }), text(d.generator, { bold: true })],
    equipmentRow(d.brand, "brand"), equipmentRow(d.model, "model"), equipmentRow(d.serial, "serial"), equipmentRow(d.dms, "dms"),
  ]));
  const instrumentRow = (label: string, key: string): ReportCell[] => [
    text(label, { bold: true }), stored(v(`instruments.${key}.brand`)), stored(v(`instruments.${key}.model`)), stored(v(`instruments.${key}.serial`)),
  ];
  blocks.push(heading(2, d.instruments));
  blocks.push(table([
    [text(d.designation, { bold: true }), text(d.brand, { bold: true }), text(d.model, { bold: true }), text(d.serialFull, { bold: true })],
    instrumentRow(d.kvpMeter, "kvpMeter"), instrumentRow(d.dosimeter, "dosimeter"), instrumentRow(d.tapeMeasure, "tapeMeasure"),
  ]));
  const checkRows = (labels: readonly string[], ids: readonly string[]): ReportCell[][] => [
    [empty(), text(d.na, { bold: true }), text(d.yes, { bold: true }), text(d.no, { bold: true })],
    ...labels.map((label, index) => [text(label), choice(ids[index]!, "N.A"), choice(ids[index]!, "Oui"), choice(ids[index]!, "Non")]),
  ];
  blocks.push(heading(2, d.qualitativeAspects), heading(3, d.visualControls));
  blocks.push(table(checkRows(d.visualRows, ["visual.integrity", "visual.cleanliness", "visual.keyboards", "visual.accessories", "visual.connectorsCables"])));
  blocks.push(heading(3, d.mechanicalSafety));
  blocks.push(table(checkRows(d.mechanicalRows, ["mechanical.brakes", "mechanical.movements"])));
  blocks.push({ kind: "pageBreak" });

  // Page 2/4
  const accuracy = results.voltageAccuracy;
  const accuracyValues = accuracy && "values" in accuracy ? accuracy.values : undefined;
  blocks.push(heading(1, d.performanceHeading), heading(2, d.accuracyHeading), paragraph(d.measure, true));
  blocks.push(table([
    [empty(), text(d.kvDisplayedColumn, { bold: true }), text(d.kvMeasuredColumn, { bold: true }), text(d.accuracyDeviationColumn, { bold: true })],
    ...d.accuracyRows.map((label, index): ReportCell[] => [
      text(label, { bold: true }),
      stored(v(`voltage.accuracy.row${index + 1}.kvDisplayed`)), stored(v(`voltage.accuracy.row${index + 1}.kvMeasured`)),
      calculatedCell(accuracyValues?.deviationPercent[index], " %"),
    ]),
  ]));
  blocks.push(paragraph(d.accuracyTolerance), ...commentBlocks(d.comment, v("voltage.accuracy.comments")), ...verdictBlocks(d.accuracyVerdict, accuracy));

  const repeatability = results.voltageRepeatability;
  const repeatabilityValues = repeatability && "values" in repeatability ? repeatability.values : undefined;
  const five = [1, 2, 3, 4, 5];
  const rowOfFive = (label: string, cell: (index: number) => ReportCell): ReportCell[] => [text(label, { bold: true }), ...five.map(cell)];
  blocks.push(heading(2, d.repeatabilityHeading), paragraph(d.measure, true));
  blocks.push(table([
    [text(d.mas, { bold: true }), stored(v("voltage.repeatability.mas"), { colSpan: 2 }), text(d.maMaxHalf, { bold: true }), stored(v("voltage.repeatability.maMaxHalf"), { colSpan: 2 })],
    rowOfFive(d.kvDisplayedColumn, (i) => stored(v(`voltage.repeatability.row${i}.kvDisplayed`))),
    rowOfFive(d.kvMeasuredColumn, (i) => stored(v(`voltage.repeatability.row${i}.kvMeasured`))),
    rowOfFive(d.kermaMgy, (i) => stored(v(`voltage.repeatability.row${i}.kerma`))),
    [text(d.kvMeasuredMin, { bold: true }), calculatedCell(repeatabilityValues?.min, "", 5)],
    [text(d.kvMeasuredMax, { bold: true }), calculatedCell(repeatabilityValues?.max, "", 5)],
    [text(d.kvMeasuredMean, { bold: true }), calculatedCell(repeatabilityValues?.mean, "", 5)],
    [text(d.kvMinDeviation, { bold: true }), calculatedCell(repeatabilityValues?.minDeviationPercent, " %", 5)],
    [text(d.kvMaxDeviation, { bold: true }), calculatedCell(repeatabilityValues?.maxDeviationPercent, " %", 5)],
  ]));
  blocks.push(paragraph(d.kermaReuseNote), paragraph(d.repeatabilityTolerance));
  blocks.push(...commentBlocks(d.comment, v("voltage.repeatability.voltageComments")), ...verdictBlocks(d.repeatabilityVerdict, repeatability));
  blocks.push(heading(2, d.outputHeading));
  blocks.push({ kind: "pageBreak" });

  // Page 3/4
  const output = results.outputRepeatability;
  const outputValues = output && "values" in output ? output.values : undefined;
  blocks.push(heading(2, d.outputRepeatabilityHeading), paragraph(d.measure, true));
  blocks.push(table([
    rowOfFive(d.kv, (i) => stored(v(`voltage.repeatability.row${i}.kvDisplayed`))),
    [text(d.mas, { bold: true }), stored(v("voltage.repeatability.mas"), { colSpan: 5 })],
    [text(d.maMaxHalf, { bold: true }), stored(v("voltage.repeatability.maMaxHalf"), { colSpan: 5 })],
    rowOfFive(d.kerma, (i) => stored(v(`voltage.repeatability.row${i}.kerma`))),
    rowOfFive(d.kermaDeviation, (i) => calculatedCell(outputValues?.deviationPercent[i - 1], " %")),
    [text(d.kermaMean, { bold: true }), calculatedCell(outputValues?.kermaMean, "", 5)],
  ]));
  blocks.push(paragraph(d.outputTolerance), ...commentBlocks(d.comment, v("voltage.repeatability.outputComments")), ...verdictBlocks(d.outputVerdict, output));

  const linearity = results.outputLinearity;
  const linearityValues = linearity && "values" in linearity ? linearity.values : undefined;
  blocks.push(heading(2, d.linearityHeading), paragraph(d.measure, true));
  blocks.push(table([
    [d.kv, d.mas, d.kermaDetector, d.kermaAt1m, d.k1, d.k1Deviation].map((label) => text(label, { bold: true })),
    ...[1, 2, 3].map((i): ReportCell[] => [
      stored(v(`output.linearity.row${i}.kvDisplayed`)), stored(v(`output.linearity.row${i}.mas`)), stored(v(`output.linearity.row${i}.kerma`)),
      calculatedCell(linearityValues?.kermaAt1m[i - 1]), calculatedCell(linearityValues?.k1[i - 1]), calculatedCell(linearityValues?.deviationPercent[i - 1], " %"),
    ]),
    [text(d.maMaxHalf, { bold: true }), stored(v("output.linearity.maMaxHalf")), empty(), empty(), text(d.k2, { bold: true }), calculatedCell(linearityValues?.k2)],
  ]));
  const dfc = v("output.linearity.dfc");
  blocks.push(paragraph(d.linearityNote), paragraph(dfc === "" ? d.dfc : `${d.dfc} ${dfc} m`), paragraph(d.linearityTolerance));
  blocks.push(...commentBlocks(d.comment, v("output.linearity.comments")), ...verdictBlocks(d.linearityVerdict, linearity));
  blocks.push(heading(2, d.beamGeometryHeading), paragraph(d.lightFieldHeading));
  blocks.push({ kind: "pageBreak" });

  // Page 4/4
  const light = results.lightFieldCorrespondence;
  const lightValues = light && "values" in light ? light.values : undefined;
  const dfr = v("lightField.dfr");
  blocks.push(table([
    [d.kv, d.mas, d.dfr, ...[1, 2, 3, 4].map((i) => `${d.gap} ${i}`), d.sumAbsGaps, d.sumAbsGapsOverDfr].map((label) => text(label, { bold: true })),
    [
      stored(v("lightField.kv")), stored(v("lightField.mas")), stored(dfr === "" ? "" : `${dfr} m`),
      ...[1, 2, 3, 4].map((i) => stored(v(`lightField.gap${i}`))),
      calculatedCell(lightValues?.sumAbsGapsMm), calculatedCell(lightValues?.resultPercent, " %"),
    ],
  ]));
  blocks.push(paragraph(d.lightFieldNote), ...commentBlocks(d.comment, v("lightField.comments")), ...verdictBlocks(d.lightFieldVerdict, light));

  blocks.push(...commentBlocks(d.generalComments, v("comments.general")));
  const decisionLabel = input.decision.outcome === "machine-conforme" ? fr.conformity.conforme : fr.conformity.nonConforme;
  blocks.push(heading(2, d.generalConclusion), paragraph(decisionLabel, true), ...lines(input.summary.text).map((line) => paragraph(line)));

  blocks.push(table([
    [text(d.performedBy, { bold: true, colSpan: 4 })],
    [d.nameColumn, d.qualityColumn, d.dateColumn, d.signaturesColumn].map((label) => text(label, { bold: true })),
    [stored(v("controlPerformedBy.nom")), stored(v("controlPerformedBy.qualite")), stored(v("controlPerformedBy.dateControle")), empty()],
  ]));
  blocks.push(table([
    [text(d.approvedBy, { bold: true, colSpan: 4 })],
    [d.nameColumn, d.qualityColumn, d.dateColumn, d.signatureColumn].map((label) => text(label, { bold: true })),
    [text(d.approverName), text(d.approverQuality), empty(), empty()],
  ]));

  return {
    templateId: REPORT_TEMPLATE_ID,
    templateVersion: REPORT_TEMPLATE_VERSION,
    header: { logo: "cetem-logo" },
    footer: { pageNumbering: true, totalPages: 4 },
    blocks,
  };
}
