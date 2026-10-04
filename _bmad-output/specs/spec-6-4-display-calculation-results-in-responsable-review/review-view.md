# Responsable web review view (`measurement-result`, web)

Suggested file: `apps/web/src/app/graphie-calculation-review.tsx`, component `GraphieCalculationReview`. It is a pure, server-renderable React component: no client hooks, no fetch, no state. `apps/web` adds `@cetem-qc/domain` as a dependency for the result types (and for test fixtures).

## Input

```ts
type GraphieReviewEvidence = {
  identity: CalculationContext;                 // the 5-part identity stored with the accepted audit
  values: Readonly<Record<string, string>>;     // accepted raw form values
  results: GraphieCalculationResults;           // calculation snapshot; the web never computes it
};
```

Story 9.1 supplies this from the server's accepted snapshot (Story 7.3/7.4). The component never calls a calculation function.

## Layout (in order)

1. Heading « Résultats de calcul » and the line « Suggestion : la conformité finale de l'appareil est décidée par le Responsable. » (once).
2. If any result has no `formulaSource` (unsupported identity): an alert « Version de règle non prise en charge — aucun calcul » followed by the stored identity (`catalogueId catalogueVersion`, schéma `schemaVersion`, règle `ruleId ruleVersion`). Measured values are still listed. No result, verdict, tolerance or provenance lines are shown.
3. One `<section>` per test in `GRAPHIE_RESULT_ORDER`, each with:
   1. `<h3>` heading = `presentation.heading` (paper test name).
   2. « Valeurs mesurées » list from `presentGraphieMeasurements`.
   3. « Valeurs calculées » list from `presentGraphieResult(...).lines` (omitted under step 2).
   4. Verdict line = `verdict.text`; its `aria-label` = `verdict.label`.
   5. Tolerance line when present.
   6. Provenance line.

All text comes from the shared presenter and `fr.graphieResults`; the component adds no wording of its own except structure.

## Read-only and no overall conformity

- No `<input>`, `<textarea>`, `<select>`, `<button>`, `<form>` or link that changes data.
- No « Machine conforme », overall verdict, count of passed tests or summary badge. No employee-work approve/reject action.

## Semantics and styling

- Status is carried by the verdict text and its symbol (✓ / ✗ / —). Colour is secondary: CSS classes `result-conforme`, `result-non-conforme`, `result-indisponible` in `globals.css`, with contrast at least that of body text.
- Unavailable values read « Indisponible — <reason> » (shared presenter); never `0`, `N.A`, blank or « Conforme ».
- Lines wrap; nothing is truncated. Sections stack on narrow widths.
