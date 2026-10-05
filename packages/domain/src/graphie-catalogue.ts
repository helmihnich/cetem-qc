import {
  GRAPHIE_CALCULATION_RULE_ID,
  GRAPHIE_CALCULATION_RULE_VERSION,
  GRAPHIE_CATALOGUE_ID,
  GRAPHIE_CATALOGUE_VERSION,
  GRAPHIE_FORM_SCHEMA_VERSION,
} from "./graphie-identity.js";

export type CatalogueProvenance = "CETEM_PAPER_FORM" | "CETEM_WORKBOOK" | "IAEA_GUIDANCE" | "AAPM_GUIDANCE" | "PROJECT_POV_DECISION";
export type CatalogueFieldType = "text" | "date" | "number" | "boolean" | "choice" | "textarea";
export type CatalogueField = {
  id: string;
  labelFr: string;
  type: CatalogueFieldType;
  unit?: string;
  provenance: CatalogueProvenance[];
  options?: readonly string[];
  helpFr?: string;
  /** Value pre-printed on the paper form; seeded only into a new draft. */
  defaultValue?: string;
  required?: boolean;
  min?: number;
  max?: number;
  allowNA?: boolean;
};
/** Explicit row grouping of table cells: `fieldIds[r][c]` is the cell of row r, column c. */
export type CatalogueTable = {
  id: string;
  rowLabelsFr: readonly string[];
  columnLabelsFr: readonly string[];
  fieldIds: readonly (readonly string[])[];
  helpFr?: string;
};
/** `fields` is the flattened, ordered list of every field in the section, table cells included. */
export type CatalogueSection = { id: string; labelFr: string; fields: readonly CatalogueField[]; tables?: readonly CatalogueTable[] };

// Structure and wording follow the official CETEM paper form « Rapport de Contrôle de Qualité
// d'un Appareil Mobile de Radiographie ». CETEM_WORKBOOK only marks fields that feed a workbook
// formula; it does not claim CETEM reviewed or approved this catalogue.
const paper = ["CETEM_PAPER_FORM"] as const;
const paperAndWorkbook = ["CETEM_PAPER_FORM", "CETEM_WORKBOOK"] as const;
type Provenance = readonly CatalogueProvenance[];
type FieldExtras = { unit?: string; helpFr?: string; defaultValue?: string; options?: readonly string[] };
const field = (id: string, labelFr: string, type: CatalogueFieldType, provenance: Provenance = paper, extras: FieldExtras = {}): CatalogueField => ({
  id,
  labelFr,
  type,
  provenance: [...provenance],
  ...(extras.unit !== undefined ? { unit: extras.unit } : {}),
  ...(extras.options !== undefined ? { options: [...extras.options] } : {}),
  ...(extras.helpFr !== undefined ? { helpFr: extras.helpFr } : {}),
  ...(extras.defaultValue !== undefined ? { defaultValue: extras.defaultValue } : {}),
});
const text = (id: string, labelFr: string, extras?: FieldExtras) => field(id, labelFr, "text", paper, extras);
const area = (id: string, labelFr: string) => field(id, labelFr, "textarea");
const number = (id: string, labelFr: string, unit: string, provenance: Provenance = paper, defaultValue?: string) =>
  field(id, labelFr, "number", provenance, { unit, ...(defaultValue !== undefined ? { defaultValue } : {}) });
const YES_NO_NA = ["N.A", "Oui", "Non"] as const;
const check = (id: string, labelFr: string) => field(id, labelFr, "choice", paper, { options: YES_NO_NA });

type Column = { key: string; labelFr: string; build: (id: string, row: number) => CatalogueField };
/** Builds an explicit table: one field per row × column, ID `<id>.row<N>.<column>` unless `idOf` is given. */
function table(id: string, rowLabelsFr: readonly string[], columns: readonly Column[], options: { helpFr?: string; idOf?: (row: number, column: Column) => string } = {}) {
  const idOf = options.idOf ?? ((row: number, column: Column) => `${id}.row${row}.${column.key}`);
  const rows = rowLabelsFr.map((_, index) => columns.map((column) => column.build(idOf(index + 1, column), index + 1)));
  const definition: CatalogueTable = {
    id,
    rowLabelsFr: [...rowLabelsFr],
    columnLabelsFr: columns.map((column) => column.labelFr),
    fieldIds: rows.map((row) => row.map((cell) => cell.id)),
    ...(options.helpFr !== undefined ? { helpFr: options.helpFr } : {}),
  };
  return { definition, fields: rows.flat() };
}

// Identification de l'équipement: the paper's rows are attributes and its columns are units. The grid is
// declared per unit so a phone shows one group per device; field IDs stay `equipment.<unit>.<attribute>`.
const equipmentUnits = [
  { key: "equipment", labelFr: "Équipement" },
  { key: "tube", labelFr: "Tube à rayons X" },
  { key: "generator", labelFr: "Générateur HT" },
] as const;
const equipmentAttributes = [
  { key: "brand", labelFr: "Marque" },
  { key: "model", labelFr: "Modèle" },
  { key: "serial", labelFr: "N° de série" },
  { key: "dms", labelFr: "D.M.S" },
] as const;
const equipmentGrid = table("equipment", equipmentUnits.map((unit) => unit.labelFr),
  equipmentAttributes.map((attribute) => ({ key: attribute.key, labelFr: attribute.labelFr, build: (id: string) => text(id, attribute.labelFr) })),
  { idOf: (row, column) => `equipment.${equipmentUnits[row - 1]!.key}.${column.key}` });

// Appareils et outils de contrôle: one multifunction Fluke device is pre-printed for KVp mètre and Dosimètre.
const flukeMultifunction = { brand: "Fluke Biomedical", model: "8000", serial: "105991" } as const;
const instrumentRows = [
  { key: "kvpMeter", labelFr: "KVp mètre", defaults: flukeMultifunction },
  { key: "dosimeter", labelFr: "Dosimètre", defaults: flukeMultifunction },
  { key: "tapeMeasure", labelFr: "Mètre-ruban", defaults: undefined },
] as const;
const instrumentAttributes = [
  { key: "brand", labelFr: "Marque" },
  { key: "model", labelFr: "Modèle" },
  { key: "serial", labelFr: "N° de série" },
] as const;
const instrumentsGrid = table("instruments", instrumentRows.map((row) => row.labelFr),
  instrumentAttributes.map((attribute) => ({
    key: attribute.key,
    labelFr: attribute.labelFr,
    build: (id: string, row: number) => {
      const defaults = instrumentRows[row - 1]!.defaults;
      return text(id, attribute.labelFr, defaults ? { defaultValue: defaults[attribute.key] } : {});
    },
  })),
  { idOf: (row, column) => `instruments.${instrumentRows[row - 1]!.key}.${column.key}` });

const voltageAccuracyDefaults = ["50", "70", undefined] as const;
const voltageAccuracyTable = table("voltage.accuracy", ["KV min", "KV", "KV max"], [
  { key: "kvDisplayed", labelFr: "kV affiché", build: (id, row) => number(id, "kV affiché", "kV", paperAndWorkbook, voltageAccuracyDefaults[row - 1]) },
  { key: "kvMeasured", labelFr: "kV mesuré", build: (id) => number(id, "kV mesuré", "kV", paperAndWorkbook) },
]);

const measurementRows = (count: number) => Array.from({ length: count }, (_, index) => `Mesure ${index + 1}`);
export const KERMA_REUSE_HELP_FR = "La mesure du kerma sera utilisée par la suite pour le contrôle de la reproductibilité et la répétabilité du rayonnement de sortie.";
const repeatabilityTable = table("voltage.repeatability", measurementRows(5), [
  { key: "kvDisplayed", labelFr: "kV affiché", build: (id) => number(id, "kV affiché", "kV", paper, "70") },
  { key: "kvMeasured", labelFr: "kV mesuré", build: (id) => number(id, "kV mesuré", "kV", paperAndWorkbook) },
  { key: "kerma", labelFr: "Kerma", build: (id) => number(id, "Kerma", "mGy", paperAndWorkbook) },
], { helpFr: KERMA_REUSE_HELP_FR });

const linearityTable = table("output.linearity", measurementRows(3), [
  { key: "kvDisplayed", labelFr: "kV affiché", build: (id) => number(id, "kV affiché", "kV", paper, "70") },
  { key: "mas", labelFr: "mAs", build: (id, row) => number(id, "mAs", "mAs", paperAndWorkbook, row === 1 ? "10" : undefined) },
  { key: "kerma", labelFr: "Kerma (dét)", build: (id) => number(id, "Kerma (dét)", "mGy", paperAndWorkbook) },
]);

export const GRAPHIE_MOBILE_POV_CATALOGUE: { id: string; version: string; schemaVersion: number; sections: readonly CatalogueSection[] } = {
  id: GRAPHIE_CATALOGUE_ID,
  version: GRAPHIE_CATALOGUE_VERSION,
  schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION,
  sections: [
    { id: "header", labelFr: "En-tête", fields: [
      text("header.reportNumber", "N° rapport", { helpFr: "N° …/LCQ" }),
      text("header.etablissement", "Établissement"),
      text("header.serviceLieu", "Service / Lieu"),
      field("header.interventionNature", "Nature de l'intervention", "choice", paper, { options: ["Demande ponctuelle", "Convention"], defaultValue: "Convention" }),
      text("header.refCetembh", "Réf. CETEMBH (Convention N°)"),
      text("header.refClient", "Réf. Client (N°)"),
    ] },
    { id: "equipment", labelFr: "Identification de l'équipement", fields: equipmentGrid.fields, tables: [equipmentGrid.definition] },
    { id: "instruments", labelFr: "Appareils et outils de contrôle", fields: instrumentsGrid.fields, tables: [instrumentsGrid.definition] },
    { id: "visual", labelFr: "Contrôles visuels", fields: [
      check("visual.integrity", "Intégrité de l'appareil, bon état des couvercles"),
      check("visual.cleanliness", "Propreté générale"),
      check("visual.keyboards", "Bon état mécanique des claviers"),
      check("visual.accessories", "Bon état des accessoires et des périphériques"),
      check("visual.connectorsCables", "Bon état des connecteurs et des câbles électriques"),
    ] },
    { id: "mechanical", labelFr: "Contrôle de sécurité mécanique", fields: [
      check("mechanical.brakes", "Contrôle des freins"),
      check("mechanical.movements", "Contrôle des mouvements"),
    ] },
    { id: "voltageAccuracy", labelFr: "Exactitude de la tension", fields: [
      ...voltageAccuracyTable.fields,
      area("voltage.accuracy.comments", "Commentaire"),
    ], tables: [voltageAccuracyTable.definition] },
    { id: "repeatability", labelFr: "Répétabilité de la tension", fields: [
      number("voltage.repeatability.mas", "mAs", "mAs", paperAndWorkbook),
      number("voltage.repeatability.maMaxHalf", "mA max/2", "mA"),
      ...repeatabilityTable.fields,
      area("voltage.repeatability.voltageComments", "Commentaire — répétabilité de la tension"),
      area("voltage.repeatability.outputComments", "Commentaire — reproductibilité et répétabilité du rayonnement de sortie"),
    ], tables: [repeatabilityTable.definition] },
    { id: "linearity", labelFr: "Linéarité du rayonnement de sortie", fields: [
      ...linearityTable.fields,
      number("output.linearity.maMaxHalf", "mA max/2", "mA"),
      number("output.linearity.dfc", "DFC (distance foyer–chambre)", "m"),
      area("output.linearity.comments", "Commentaire"),
    ], tables: [linearityTable.definition] },
    { id: "lightField", labelFr: "Géométrie du faisceau de rayons X : correspondance entre le champ lumineux et le champ de rayons X", fields: [
      number("lightField.kv", "kV", "kV", paper, "70"),
      number("lightField.mas", "mAs", "mAs", paper, "4"),
      number("lightField.dfr", "D.F.R (distance foyer–récepteur)", "m", paper, "1"),
      ...[1, 2, 3, 4].map((index) => number(`lightField.gap${index}`, `Écart ${index}`, "mm")),
      area("lightField.comments", "Commentaire"),
    ] },
    { id: "comments", labelFr: "Commentaires généraux", fields: [area("comments.general", "Commentaires généraux")] },
    { id: "controlPerformedBy", labelFr: "Contrôle effectué par", fields: [
      text("controlPerformedBy.nom", "Nom et prénom"),
      text("controlPerformedBy.qualite", "Qualité"),
      field("controlPerformedBy.dateControle", "Date de contrôle", "date"),
    ] },
  ],
};

export type GraphieFormValues = Record<string, string>;

const catalogueFields = GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields);
const supportedFieldIds = new Set(catalogueFields.map((candidate) => candidate.id));
const choiceOptions = new Map(catalogueFields
  .filter((candidate) => candidate.type === "choice")
  .map((candidate) => [candidate.id, candidate.options ?? []] as const));

export type GraphiePayloadKind = "sync-draft" | "submit";
export type GraphiePayloadErrorCode = "UNSUPPORTED_PAYLOAD" | "UNSUPPORTED_PAYLOAD_VERSION" | "INVALID_PAYLOAD";
/** `path` names the offending key (`values.<fieldId>` for a field); it never carries the value. */
export type GraphiePayloadIssue = { path: string; code: string };
export type ValidatedGraphiePayload = {
  catalogueId: string;
  catalogueVersion: string;
  schemaVersion: number;
  ruleId: string;
  ruleVersion: string;
  values: GraphieFormValues;
  legacyContent?: string;
};
export type GraphiePayloadValidation =
  | { ok: true; payload: ValidatedGraphiePayload }
  | { ok: false; code: GraphiePayloadErrorCode; issues: GraphiePayloadIssue[] };

const PAYLOAD_KEYS = ["catalogueId", "catalogueVersion", "schemaVersion", "ruleId", "ruleVersion", "values", "legacyContent"];
const EXPECTED_IDENTITY: ReadonlyArray<readonly [string, string | number]> = [
  ["catalogueId", GRAPHIE_CATALOGUE_ID],
  ["catalogueVersion", GRAPHIE_CATALOGUE_VERSION],
  ["schemaVersion", GRAPHIE_FORM_SCHEMA_VERSION],
  ["ruleId", GRAPHIE_CALCULATION_RULE_ID],
  ["ruleVersion", GRAPHIE_CALCULATION_RULE_VERSION],
];
/** An issue path echoes a client key; NUL and unpaired surrogates are replaced so the stored rejection stays storable as jsonb. */
const issuePath = (key: string) => key.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF\u0000]/g, (match) => match.length === 2 ? match : "�");

/**
 * Structural validation of a catalogue 2.0.0 payload: the same rules as the device's saved-payload parser,
 * plus NUL characters (not storable by PostgreSQL) and legacy content on a submission. Blank, missing and
 * unparseable readings are valid evidence. No required-field, range, unit or tolerance rule exists here:
 * those wait for CETEM approval (DEP-01/02) and would come with a new rule or catalogue version.
 */
export function validateGraphiePayload(payload: unknown, kind: GraphiePayloadKind): GraphiePayloadValidation {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, code: "INVALID_PAYLOAD", issues: [{ path: "", code: "not-an-object" }] };
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.content === "string" && Object.keys(record).length === 1) {
    return { ok: false, code: "UNSUPPORTED_PAYLOAD", issues: [{ path: "content", code: "legacy-payload" }] };
  }
  const versionIssues = EXPECTED_IDENTITY
    .filter(([key, expected]) => record[key] !== expected)
    .map(([key]) => ({ path: key, code: "unsupported-version" }));
  if (versionIssues.length) return { ok: false, code: "UNSUPPORTED_PAYLOAD_VERSION", issues: versionIssues };

  const issues: GraphiePayloadIssue[] = [];
  for (const key of Object.keys(record)) {
    if (!PAYLOAD_KEYS.includes(key)) issues.push({ path: issuePath(key), code: "unknown-key" });
  }
  const values = record.values;
  if (typeof values !== "object" || values === null || Array.isArray(values)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(values))) {
    issues.push({ path: "values", code: "not-an-object" });
  } else {
    for (const [key, value] of Object.entries(values)) {
      const path = `values.${issuePath(key)}`;
      if (!supportedFieldIds.has(key)) issues.push({ path, code: "unknown-field" });
      else if (typeof value !== "string") issues.push({ path, code: "not-a-string" });
      else if (value.includes("\u0000")) issues.push({ path, code: "nul-character" });
      else if (choiceOptions.has(key) && value !== "" && !choiceOptions.get(key)!.includes(value)) issues.push({ path, code: "unknown-option" });
    }
  }
  if (record.legacyContent !== undefined) {
    if (kind === "submit") issues.push({ path: "legacyContent", code: "legacy-content-on-submit" });
    else if (typeof record.legacyContent !== "string") issues.push({ path: "legacyContent", code: "not-a-string" });
    else if (record.legacyContent.includes("\u0000")) issues.push({ path: "legacyContent", code: "nul-character" });
  }
  if (issues.length) return { ok: false, code: "INVALID_PAYLOAD", issues };

  return {
    ok: true,
    payload: {
      catalogueId: record.catalogueId as string,
      catalogueVersion: record.catalogueVersion as string,
      schemaVersion: record.schemaVersion as number,
      ruleId: record.ruleId as string,
      ruleVersion: record.ruleVersion as string,
      values: { ...(values as GraphieFormValues) },
      ...(record.legacyContent !== undefined ? { legacyContent: record.legacyContent as string } : {}),
    },
  };
}
