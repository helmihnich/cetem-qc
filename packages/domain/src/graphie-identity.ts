/** Shared Graphie payload identity contract used by the catalogue and calculation boundary. */
export const GRAPHIE_CATALOGUE_ID = "graphie-mobile-pov" as const;
export const GRAPHIE_CATALOGUE_VERSION = "2.0.0" as const;
export const GRAPHIE_FORM_SCHEMA_VERSION = 3 as const;

export const GRAPHIE_CALCULATION_RULE_ID = "cetem-workbook-explicit-formulas" as const;
export const GRAPHIE_CALCULATION_RULE_VERSION = "1.0.0" as const;

export const GRAPHIE_CALCULATION_CATALOGUE = {
  catalogueId: GRAPHIE_CATALOGUE_ID,
  catalogueVersion: GRAPHIE_CATALOGUE_VERSION,
  schemaVersion: GRAPHIE_FORM_SCHEMA_VERSION,
} as const;

export const GRAPHIE_CALCULATION_IDENTITY = {
  ...GRAPHIE_CALCULATION_CATALOGUE,
  ruleId: GRAPHIE_CALCULATION_RULE_ID,
  ruleVersion: GRAPHIE_CALCULATION_RULE_VERSION,
} as const;

export type CalculationContext = {
  catalogueId: string;
  catalogueVersion: string;
  schemaVersion: number;
  ruleId: string;
  ruleVersion: string;
};

export type GraphieCalculationIdentity = typeof GRAPHIE_CALCULATION_IDENTITY;
