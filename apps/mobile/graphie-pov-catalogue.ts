import { GRAPHIE_CATALOGUE_ID, GRAPHIE_CATALOGUE_VERSION, GRAPHIE_FORM_SCHEMA_VERSION, GRAPHIE_CALCULATION_RULE_ID, GRAPHIE_CALCULATION_RULE_VERSION, GRAPHIE_MOBILE_POV_CATALOGUE } from "@cetem-qc/domain";
import type { GraphieFormValues } from "@cetem-qc/domain";

export { GRAPHIE_CATALOGUE_ID, GRAPHIE_CATALOGUE_VERSION, GRAPHIE_FORM_SCHEMA_VERSION };
export { GRAPHIE_CALCULATION_RULE_ID, GRAPHIE_CALCULATION_RULE_VERSION };
// The catalogue lives in the domain so the server validates submissions against the same fields and options.
export { GRAPHIE_MOBILE_POV_CATALOGUE, KERMA_REUSE_HELP_FR } from "@cetem-qc/domain";
export type { CatalogueField, CatalogueFieldType, CatalogueProvenance, CatalogueSection, CatalogueTable, GraphieFormValues } from "@cetem-qc/domain";

const catalogueFields = GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields);
const supportedFieldIds = new Set(catalogueFields.map((field) => field.id));
const choiceOptions = new Map(catalogueFields
  .filter((field) => field.type === "choice")
  .map((field) => [field.id, field.options ?? []] as const));

/** Paper pre-printed values, seeded as editable values only when no draft exists for the task. */
export function createNewGraphieDraftValues(): GraphieFormValues {
  return Object.fromEntries(catalogueFields
    .filter((field) => field.defaultValue !== undefined)
    .map((field) => [field.id, field.defaultValue!]));
}

export class GraphiePayloadCompatibilityError extends Error {
  constructor() {
    super("Saved Graphie form payload is incompatible with this catalogue version.");
    this.name = "GraphiePayloadCompatibilityError";
  }
}

export function parseGraphiePayload(payload: unknown): { catalogueId: string; catalogueVersion: string; schemaVersion: number; ruleId: string; ruleVersion: string; values: GraphieFormValues; legacyContent?: string } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new GraphiePayloadCompatibilityError();
  const record = payload as Record<string, unknown>;
  // Story 5.3 persisted opaque content. Preserve it as a legacy value; never reinterpret it as form fields.
  if (typeof record.content === "string" && Object.keys(record).length === 1) {
    return { catalogueId: GRAPHIE_CATALOGUE_ID, catalogueVersion: GRAPHIE_CATALOGUE_VERSION, schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION, ruleId: GRAPHIE_CALCULATION_RULE_ID, ruleVersion: GRAPHIE_CALCULATION_RULE_VERSION, values: {}, legacyContent: record.content };
  }
  if (typeof record.catalogueId !== "string" || !record.catalogueId
    || typeof record.catalogueVersion !== "string" || !record.catalogueVersion
    || !Number.isSafeInteger(record.schemaVersion)
    || typeof record.ruleId !== "string" || !record.ruleId
    || typeof record.ruleVersion !== "string" || !record.ruleVersion
    || record.catalogueId !== GRAPHIE_CATALOGUE_ID
    || record.catalogueVersion !== GRAPHIE_CATALOGUE_VERSION
    || record.schemaVersion !== GRAPHIE_FORM_SCHEMA_VERSION
    || record.ruleId !== GRAPHIE_CALCULATION_RULE_ID
    || record.ruleVersion !== GRAPHIE_CALCULATION_RULE_VERSION
    || Object.keys(record).some((key) => !["catalogueId", "catalogueVersion", "schemaVersion", "ruleId", "ruleVersion", "values", "legacyContent"].includes(key))
    || typeof record.values !== "object"
    || record.values === null
    || Array.isArray(record.values)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(record.values))
    || Object.entries(record.values).some(([key, value]) => typeof value !== "string"
      || !supportedFieldIds.has(key)
      || (choiceOptions.has(key) && value !== "" && !choiceOptions.get(key)!.includes(value)))
    || (record.legacyContent !== undefined && typeof record.legacyContent !== "string")) throw new GraphiePayloadCompatibilityError();
  const values = record.values as GraphieFormValues;
  return { catalogueId: record.catalogueId as string, catalogueVersion: record.catalogueVersion as string, schemaVersion: record.schemaVersion as number, ruleId: record.ruleId as string, ruleVersion: record.ruleVersion as string, values: { ...values }, ...(record.legacyContent !== undefined ? { legacyContent: record.legacyContent as string } : {}) };
}
