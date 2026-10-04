import { GRAPHIE_CALCULATION_IDENTITY, graphieCalculations, graphieTestInputsFromValues } from "@cetem-qc/domain";
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

export type GraphieCalculationResults = { readonly [TName in GraphieCalculationName]: ReturnType<(typeof graphieCalculations)[TName]> };

/** All 5 paper-test results for raw form values. Parsing, mapping and formulas are the domain's; nothing is stored. */
export function calculateGraphieResults(identity: CalculationContext, values: Readonly<Record<string, string>>): GraphieCalculationResults {
  const draft: GraphieDraftPayload = { ...identity, values: {} };
  const inputs = graphieTestInputsFromValues(values);
  return {
    voltageAccuracy: calculateGraphieDraft(draft, "voltageAccuracy", inputs.voltageAccuracy),
    voltageRepeatability: calculateGraphieDraft(draft, "voltageRepeatability", inputs.voltageRepeatability),
    outputRepeatability: calculateGraphieDraft(draft, "outputRepeatability", inputs.outputRepeatability),
    outputLinearity: calculateGraphieDraft(draft, "outputLinearity", inputs.outputLinearity),
    lightFieldCorrespondence: calculateGraphieDraft(draft, "lightFieldCorrespondence", inputs.lightFieldCorrespondence),
  };
}

export function isCurrentGraphieDraft(draft: GraphieDraftPayload): boolean {
  return draft.catalogueId === GRAPHIE_CALCULATION_IDENTITY.catalogueId
    && draft.catalogueVersion === GRAPHIE_CALCULATION_IDENTITY.catalogueVersion
    && draft.schemaVersion === GRAPHIE_CALCULATION_IDENTITY.schemaVersion
    && draft.ruleId === GRAPHIE_CALCULATION_IDENTITY.ruleId
    && draft.ruleVersion === GRAPHIE_CALCULATION_IDENTITY.ruleVersion;
}

