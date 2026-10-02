import { GRAPHIE_CATALOGUE_ID, GRAPHIE_CATALOGUE_VERSION, GRAPHIE_FORM_SCHEMA_VERSION } from "@cetem-qc/domain/identity";

export { GRAPHIE_CATALOGUE_ID, GRAPHIE_CATALOGUE_VERSION, GRAPHIE_FORM_SCHEMA_VERSION };

export type CatalogueProvenance = "CETEM_WORKBOOK" | "IAEA_GUIDANCE" | "AAPM_GUIDANCE" | "PROJECT_POV_DECISION";
export type CatalogueFieldType = "text" | "date" | "number" | "boolean" | "choice" | "textarea";
export type CatalogueField = {
  id: string;
  labelFr: string;
  type: CatalogueFieldType;
  unit?: string;
  provenance: CatalogueProvenance[];
  options?: readonly string[];
  helpFr?: string;
  required?: boolean;
  min?: number;
  max?: number;
  allowNA?: boolean;
};
export type CatalogueSection = { id: string; labelFr: string; fields: readonly CatalogueField[] };

// Field labels and groups are product-defined for the PoV. Workbook provenance identifies
// source meaning only; it does not claim CETEM reviewed or approved this catalogue.
const project = ["PROJECT_POV_DECISION"] as const;
const projectAndWorkbook = ["PROJECT_POV_DECISION", "CETEM_WORKBOOK"] as const;
const projectAndGuidance = ["PROJECT_POV_DECISION", "IAEA_GUIDANCE", "AAPM_GUIDANCE"] as const;
const text = (id: string, labelFr: string, provenance: readonly CatalogueProvenance[] = project): CatalogueField => ({ id, labelFr, type: "text", provenance: [...provenance] });
const area = (id: string, labelFr: string, provenance: readonly CatalogueProvenance[] = project): CatalogueField => ({ id, labelFr, type: "textarea", provenance: [...provenance] });
const number = (id: string, labelFr: string, unit: string, provenance: readonly CatalogueProvenance[] = projectAndWorkbook): CatalogueField => ({ id, labelFr, type: "number", unit, provenance: [...provenance] });

export const GRAPHIE_MOBILE_POV_CATALOGUE: { id: string; version: string; schemaVersion: number; sections: readonly CatalogueSection[] } = {
  id: GRAPHIE_CATALOGUE_ID,
  version: GRAPHIE_CATALOGUE_VERSION,
  schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION,
  sections: [
    { id: "intervention", labelFr: "Intervention", fields: [
      { ...text("intervention.date", "Date du contrôle"), type: "date" },
      text("intervention.etablissement", "Établissement"), text("intervention.service", "Service"),
      text("intervention.technicien", "Employé ou technicien"), text("intervention.contexte", "Contexte du contrôle"),
      area("intervention.commentaires", "Commentaires sur l’intervention"),
    ] },
    { id: "equipment", labelFr: "Équipement contrôlé", fields: [
      ...["Fabricant", "Modèle", "Numéro de série", "Type d’équipement", "Identification de l’installation", "Identification du générateur", "Identification du tube à rayons X"].map((label, i) => text(`equipment.identity.${i}`, label)),
    ] },
    { id: "instruments", labelFr: "Instruments de mesure", fields: [
      text("instrument.name", "Instrument de mesure"), text("instrument.manufacturer", "Fabricant"),
      text("instrument.model", "Modèle"), text("instrument.serial", "Numéro de série"), text("instrument.calibration", "Informations d’étalonnage"),
    ] },
    { id: "qualitative", labelFr: "Vérifications qualitatives", fields: [
      ...["État général", "Commandes et affichage", "Câbles et connecteurs", "Déplacement et verrouillage", "Collimateur et concordance du champ lumineux"].map((label, i) => ({ ...text(`qualitative.${i}`, label, projectAndGuidance), type: "choice" as const, options: ["Conforme", "À signaler", "Non vérifié"] })),
      area("qualitative.observations", "Observations qualitatives", projectAndGuidance),
    ] },
    { id: "quantitative", labelFr: "Mesures et contrôles quantitatifs", fields: [
      { id: "voltage.accuracy", labelFr: "Exactitude de la tension", type: "number", unit: "kV", provenance: [...projectAndWorkbook] },
      { id: "voltage.reproducibility", labelFr: "Reproductibilité de la tension", type: "number", unit: "%", provenance: [...projectAndWorkbook] },
      { id: "output.reproducibility", labelFr: "Reproductibilité du rayonnement de sortie", type: "number", unit: "%", provenance: [...projectAndWorkbook] },
      { id: "output.linearity", labelFr: "Linéarité du rayonnement de sortie", type: "number", unit: "%", provenance: [...projectAndWorkbook] },
      { id: "beam.geometry", labelFr: "Géométrie et faisceau", type: "number", unit: "mm", provenance: [...project] },
      number("measurement.other", "Autre mesure", "", project),
    ] },
    { id: "comments", labelFr: "Commentaires généraux", fields: [area("comments.general", "Observations et commentaires")] },
  ],
};

export type GraphieFormValues = Record<string, string>;
const supportedFieldIds = new Set(GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields.map((field) => field.id)));
const choiceOptions = new Map(GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields
  .filter((field) => field.type === "choice")
  .map((field) => [field.id, field.options ?? []] as const)));
export class GraphiePayloadCompatibilityError extends Error {
  constructor() {
    super("Saved Graphie form payload is incompatible with this catalogue version.");
    this.name = "GraphiePayloadCompatibilityError";
  }
}

export function parseGraphiePayload(payload: unknown): { catalogueId: string; catalogueVersion: string; schemaVersion: number; values: GraphieFormValues; legacyContent?: string } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new GraphiePayloadCompatibilityError();
  const record = payload as Record<string, unknown>;
  // Story 5.3 persisted opaque content. Preserve it as a legacy value; never reinterpret it as form fields.
  if (typeof record.content === "string" && Object.keys(record).length === 1) {
    return { catalogueId: GRAPHIE_CATALOGUE_ID, catalogueVersion: GRAPHIE_CATALOGUE_VERSION, schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION, values: {}, legacyContent: record.content };
  }
  if (record.catalogueId !== GRAPHIE_CATALOGUE_ID
    || record.catalogueVersion !== GRAPHIE_CATALOGUE_VERSION
    || record.schemaVersion !== GRAPHIE_FORM_SCHEMA_VERSION
    || Object.keys(record).some((key) => !["catalogueId", "catalogueVersion", "schemaVersion", "values", "legacyContent"].includes(key))
    || typeof record.values !== "object"
    || record.values === null
    || Array.isArray(record.values)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(record.values))
    || Object.entries(record.values).some(([key, value]) => typeof value !== "string"
      || !supportedFieldIds.has(key)
      || (choiceOptions.has(key) && value !== "" && !choiceOptions.get(key)!.includes(value)))
    || (record.legacyContent !== undefined && typeof record.legacyContent !== "string")) throw new GraphiePayloadCompatibilityError();
  const values = record.values as GraphieFormValues;
  return { catalogueId: record.catalogueId, catalogueVersion: record.catalogueVersion, schemaVersion: record.schemaVersion, values: { ...values }, ...(record.legacyContent !== undefined ? { legacyContent: record.legacyContent as string } : {}) };
}
