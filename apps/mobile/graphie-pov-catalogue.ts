import { checkGraphiePayloadStructure, GRAPHIE_CATALOGUE_ID, GRAPHIE_CATALOGUE_VERSION, GRAPHIE_FORM_SCHEMA_VERSION, GRAPHIE_CALCULATION_RULE_ID, GRAPHIE_CALCULATION_RULE_VERSION, GRAPHIE_MOBILE_POV_CATALOGUE } from "@cetem-qc/domain";
import type { GraphieFormValues, ValidatedGraphiePayload } from "@cetem-qc/domain";

export { GRAPHIE_CATALOGUE_ID, GRAPHIE_CATALOGUE_VERSION, GRAPHIE_FORM_SCHEMA_VERSION };
export { GRAPHIE_CALCULATION_RULE_ID, GRAPHIE_CALCULATION_RULE_VERSION };
// The catalogue lives in the domain so the server validates submissions against the same fields and options.
export { GRAPHIE_MOBILE_POV_CATALOGUE, KERMA_REUSE_HELP_FR } from "@cetem-qc/domain";
export type { CatalogueField, CatalogueFieldType, CatalogueProvenance, CatalogueSection, CatalogueTable, GraphieFormValues } from "@cetem-qc/domain";

const catalogueFields = GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields);

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

/**
 * Reads a saved payload. The structural rules are the domain's (one copy shared with the server); only the
 * Story 5.3 legacy mapping lives here. NUL and unpaired surrogates stay readable so such a draft can be corrected.
 */
export function parseGraphiePayload(payload: unknown): ValidatedGraphiePayload {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    // Story 5.3 persisted opaque content. Preserve it as a legacy value; never reinterpret it as form fields.
    if (typeof record.content === "string" && Object.keys(record).length === 1) {
      return { catalogueId: GRAPHIE_CATALOGUE_ID, catalogueVersion: GRAPHIE_CATALOGUE_VERSION, schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION, ruleId: GRAPHIE_CALCULATION_RULE_ID, ruleVersion: GRAPHIE_CALCULATION_RULE_VERSION, values: {}, legacyContent: record.content };
    }
  }
  const structure = checkGraphiePayloadStructure(payload);
  if (!structure.ok) throw new GraphiePayloadCompatibilityError();
  return structure.payload;
}
