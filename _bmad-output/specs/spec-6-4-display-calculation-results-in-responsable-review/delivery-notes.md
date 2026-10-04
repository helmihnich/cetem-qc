# Delivery notes

## Files affected

| File | Change |
|---|---|
| `packages/domain/src/graphie-inputs.ts` (+ test) | `calculateGraphieResults`, `GraphieCalculationResults` moved in; D1–D2. |
| `packages/i18n/src/graphie-results.ts` (new, + test) | Presenter moved from mobile, `presentGraphieMeasurements`, `GRAPHIE_RESULT_ORDER`; I1–I7. |
| `packages/i18n/package.json` | `./graphie-results` export, `@cetem-qc/domain` dependency, `test` script. |
| `packages/i18n/src/fr.ts` | Review strings (heading, « Valeurs mesurées », « Valeurs calculées », « Non renseigné », labels, unsupported-identity text). |
| `apps/mobile/graphie-calculation-service.ts` | Delegates to the domain; same exports. |
| `apps/mobile/graphie-test-result.tsx` | Imports the shared presenter; re-exports `presentGraphieResult`. |
| `apps/mobile/graphie-pov-catalogue.test.ts` | C2. |
| `apps/web/package.json` | `@cetem-qc/domain` dependency. |
| `apps/web/src/app/graphie-calculation-review.tsx` (new, + render test) | [review-view.md](review-view.md); W1–W9. |
| `apps/web/src/app/globals.css` | Verdict classes. |

`pnpm-lock.yaml` updates for the two new workspace dependencies.

Untouched: domain formulas and tolerances, catalogue, identity constants, local draft envelope, API, OpenAPI, database, web pages and routes, gate scripts, `.env`.

## Done at spec time

- `epics.md` Story 6.4 gains a traceability pointer to this spec.
- `sprint-status.yaml`: `6-4-display-authorized-calculation-results-in-responsable-review: ready-for-dev`; `epic-6: in-progress`.

## Hand-off to Story 9.1

9.1 renders `GraphieCalculationReview` in W4 with the accepted snapshot (identity, values, results) from the server, logs review access, and enforces team authorization. Nothing in 6.4 needs to change for that.
