# Test plan

All tests run under `pnpm -r test`. Fixtures are paper-rule / workbook source-regression readings, not CETEM-approved acceptance cases (Story 6.5). No real client names. `@cetem-qc/i18n` gains a `test` script with the same pattern as the other packages.

## Domain — `packages/domain/src/graphie-inputs.test.ts`

| ID | Case | Expect |
|---|---|---|
| D1 | `calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, regression values)` | each of the 5 results deep-equals calling `graphieCalculations[name]` on `graphieTestInputsFromValues(values)` |
| D2 | Old-rule identity (`cetem-workbook-explicit-formulas` 1.0.0) | 5 × `unsupported-version` |

## Shared presenter — `packages/i18n/src/graphie-results.test.ts`

| ID | Case | Expect |
|---|---|---|
| I1 | `presentGraphieResult` on the regression results | the same lines, verdict, tolerance and provenance texts as the 6.3 mobile block (e.g. « KV min — écart : -1,5999999999999945 % », « Règle cetem-paper-form 2.0.0 — formulaire CETEM, page 2, Exactitude de la tension ») |
| I2 | Unsupported-version result | `undefined` |
| I3 | `presentGraphieMeasurements` with `"49,2"`, `"49.2"`, `" 49,2 "` | raw string kept exactly (no trim, no comma conversion) + unit |
| I4 | blank, whitespace, absent | « Non renseigné », no unit |
| I5 | `"abc"` | « abc (valeur numérique invalide) », no unit |
| I6 | Each test | lines in the order and with the labels/units of shared-presentation.md; non-formula fields (`voltage.repeatability.mas`, `lightField.kv`, …) never appear |
| I7 | `GRAPHIE_RESULT_ORDER` | the five names in paper order |

## Mobile — existing suites plus one catalogue check

| ID | Case |
|---|---|
| C2 | `graphie-pov-catalogue.test.ts`: every measured-value label/unit used by `presentGraphieMeasurements` equals the catalogue `labelFr`/`unit` of that field. |
| M | All 6.3 mobile tests (S1–S2, R1–R12, catalogue C1) pass unchanged; the rendered mobile texts are identical. |

## Web render — `apps/web/src/app/graphie-calculation-review-render.test.tsx`

Uses `renderToStaticMarkup`, as in `password-reset-render.test.tsx`. Fixture results are built with the domain `calculateGraphieResults`.

| ID | Case | Expect |
|---|---|---|
| W1 | Full regression readings | 5 sections in paper order; measured values with units; « -1,5999999999999945 % »; « Conforme (suggestion) » where the domain says so; tolerance « \|écart\| ≤ 10 % »; provenance with « cetem-paper-form 2.0.0 » and « page 2 » |
| W2 | One row at 11 % | « ✗ Non conforme (suggestion) » |
| W3 | Light field | always « Verdict indisponible : aucune tolérance imprimée sur le formulaire officiel » |
| W4 | One kV mesuré blank, one `abc` | « Non renseigné »; « abc (valeur numérique invalide) »; that test's values « Indisponible — mesure manquante » / « valeur numérique invalide »; no `0` / `0 %` / `N.A` standing for them |
| W5 | Old-rule identity with old-rule results | « Version de règle non prise en charge — aucun calcul » and the stored identity; measured values listed; no verdict, tolerance or provenance line |
| W6 | Read-only | markup contains no `<input`, `<textarea`, `<select`, `<button`, `<form` |
| W7 | No overall conformity | no « Machine conforme », « Machine non conforme », overall verdict or passed-test count; the « décidée par le Responsable » line appears once |
| W8 | Accessibility | each verdict element has `aria-label` with the full words (« Verdict suggéré : conforme »); each test has an `<h3>` |
| W9 | Text parity | for each test, the calculated lines, verdict, tolerance and provenance in the web markup equal `presentGraphieResult` output |

## Regression

Gates: `pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` (unchanged contract), `git diff --check`.
