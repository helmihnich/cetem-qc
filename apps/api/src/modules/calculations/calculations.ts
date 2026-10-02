import { graphieCalculations } from "@cetem-qc/domain";
import type { CalculationContext, CalculationResult } from "@cetem-qc/domain";

export type VersionedGraphieCalculation = {
  [TName in keyof typeof graphieCalculations]: Parameters<(typeof graphieCalculations)[TName]> extends [CalculationContext, ...infer TArgs]
    ? { context: CalculationContext; name: TName; args: TArgs }
    : never;
}[keyof typeof graphieCalculations];

/** Internal pure application boundary for authoritative server calculation callers. */
export function calculateGraphie<TInput extends VersionedGraphieCalculation>(input: TInput) {
  const calculation = graphieCalculations[input.name] as (context: CalculationContext, ...args: TInput["args"]) => CalculationResult | (CalculationResult & { value: { rawKermaMean: number; normalizedKermaPerMasMean: number } });
  return calculation(input.context, ...input.args);
}

