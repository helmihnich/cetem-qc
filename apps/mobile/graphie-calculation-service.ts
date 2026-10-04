import { GRAPHIE_CALCULATION_IDENTITY, graphieCalculations } from "@cetem-qc/domain";
import type { CalculationContext } from "@cetem-qc/domain";
import type { GraphieDraftPayload } from "./local-drafts/model";

export type GraphieCalculationName = keyof typeof graphieCalculations;
type CalculationArgs<TName extends GraphieCalculationName> = Parameters<(typeof graphieCalculations)[TName]> extends [CalculationContext, ...infer TArgs] ? TArgs : never;

export function calculateGraphieDraft<TName extends GraphieCalculationName>(
  draft: GraphieDraftPayload,
  name: TName,
  ...args: CalculationArgs<TName>
): ReturnType<(typeof graphieCalculations)[TName]> {
  const context: CalculationContext = {
    catalogueId: draft.catalogueId,
    catalogueVersion: draft.catalogueVersion,
    schemaVersion: draft.schemaVersion,
    ruleId: draft.ruleId,
    ruleVersion: draft.ruleVersion,
  };
  // Runtime validation is deliberately delegated to the domain's versioned boundary.
  const calculate = graphieCalculations[name] as (context: CalculationContext, ...args: unknown[]) => ReturnType<(typeof graphieCalculations)[TName]>;
  return calculate(context, ...args);
}

/** All 5 paper-test results for raw form values: delegated to the domain, which owns parsing, mapping and formulas. Nothing is stored. */
export { calculateGraphieResults } from "@cetem-qc/domain";
export type { GraphieCalculationResults } from "@cetem-qc/domain";

export function isCurrentGraphieDraft(draft: GraphieDraftPayload): boolean {
  return draft.catalogueId === GRAPHIE_CALCULATION_IDENTITY.catalogueId
    && draft.catalogueVersion === GRAPHIE_CALCULATION_IDENTITY.catalogueVersion
    && draft.schemaVersion === GRAPHIE_CALCULATION_IDENTITY.schemaVersion
    && draft.ruleId === GRAPHIE_CALCULATION_IDENTITY.ruleId
    && draft.ruleVersion === GRAPHIE_CALCULATION_IDENTITY.ruleVersion;
}

